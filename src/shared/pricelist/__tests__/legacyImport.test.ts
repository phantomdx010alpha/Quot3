import { describe, expect, it } from 'vitest'
import { cleanLegacyName, legacyKey, planLegacyImport, rowFingerprint, type LegacyInventory, type PlanState } from '../legacyImport'
import { SEED_TIERS } from '../tiers'
import { fromPlain } from '../../richtext/runs'
import type { PriceCategory, PriceRow, PriceTab, PriceTier } from '../types'

// Phase 237 (M23): the pure legacy-import planner. INVENTED names only; no private data.
const tiers: PriceTier[] = SEED_TIERS.map((t, i) => ({ id: `t${i}`, key: t.key, label: t.label, position: i }))
let n = 0
const id = (): string => `n${++n}`
const item = (i: number, tabId: number, rowIndex: number, name: string, p: Partial<Record<'rate' | 'rateWithoutGst' | 'unitQty' | 'qty' | 'qtyWithGst', string>> = {}) =>
  ({ id: i, tabId, rowIndex, name, rate: '', rateWithoutGst: '', unitQty: '', qty: '', qtyWithGst: '', ...p })
const legacy = (): LegacyInventory => ({
  categories: [{ id: 2, name: 'Spices' }, { id: 1, name: 'Fruit' }],
  tabs: [{ id: 11, categoryId: 1, name: 'Apples', position: 1 }, { id: 12, categoryId: 1, name: 'Pears', position: 2 }, { id: 21, categoryId: 2, name: 'Whole', position: 1 }],
  items: [
    item(1, 11, 0, '  Green  Apple\nSmall ', { rate: '110', rateWithoutGst: '109', unitQty: '108', qty: '110.50' }),
    item(2, 11, 1, 'Red Apple'),
    item(3, 11, 3, 'Gala Apple', { rate: 'abc', unitQty: '7' }), // gap in row_index + a non-number
    item(4, 12, 0, 'Conference Pear', { rate: '55' }),
    item(5, 21, 0, '   ', { rate: '1' }), // empty name: skipped
    item(6, 99, 0, 'Lost Item') // belongs to no tab
  ]
})
const empty = (over: Partial<PlanState> = {}): PlanState => ({ tiers, categories: [], tabs: [], rowsByTab: new Map(), map: new Map(), rowById: new Map(), ...over })

describe('cleanLegacyName', () => {
  it('trims, turns line breaks into one space, collapses spaces and reports what it did', () => {
    expect(cleanLegacyName('  A \r\n B   C ')).toEqual({ text: 'A B C', hadLineBreak: true, hadEdgeSpace: true })
    expect(cleanLegacyName('Plain')).toEqual({ text: 'Plain', hadLineBreak: false, hadEdgeSpace: false })
    expect(cleanLegacyName(null).text).toBe('')
  })
})

describe('planLegacyImport', () => {
  it('maps categories by id, tabs by (category, position), rows by row_index (compacted), with the four tier columns + a hidden Unit/Qty', () => {
    const p = planLegacyImport(legacy(), empty(), id)
    expect(p.categories.map((c) => c.name)).toEqual(['Fruit', 'Spices'])
    expect(p.tabs.map((t) => t.name)).toEqual(['Apples', 'Pears', 'Whole'])
    const cols = p.tabs[0]!.columns
    expect(cols.map((c) => [c.role, c.tier ?? null, c.hidden])).toEqual([['name', null, false], ['price', 'cash_wo', false], ['price', 'wholesale_wo', false], ['price', 'cash_gst', false], ['price', 'credit_gst', false], ['unit', null, true]])
    const apples = p.rows.filter((r) => r.row.tabId === p.tabs[0]!.id)
    expect(apples.map((r) => [r.row.idx, r.row.nameRuns.map((x) => x.t).join('')])).toEqual([[0, 'Green Apple Small'], [1, 'Red Apple'], [2, 'Gala Apple']])
    expect(apples[0]!.row.cells).toEqual({ c1: '110', c2: '109', c3: '108', c4: '110.5' }) // canonical decimal strings
    expect(apples[2]!.row.cells).toEqual({ c3: '7' }) // "abc" dropped
  })

  it('counts what it cleaned, skipped and dropped (preview only)', () => {
    const pv = planLegacyImport(legacy(), empty(), id).preview
    expect(pv.categories).toEqual({ total: 2, added: 2, existing: 0 })
    expect(pv.tabs.total).toBe(3)
    expect(pv.items).toMatchObject({ total: 4, withPrice: 3, nameOnly: 1, added: 4, unchanged: 0, changed: 0 })
    expect(pv.cleaned).toEqual({ lineBreaks: 1, edgeSpaces: 1 })
    expect(pv.skipped).toEqual({ emptyName: 1, orphanTab: 0, orphanItem: 1 })
    expect(pv.tabsWithGap).toBe(1)
    expect(pv.droppedValues).toBe(1)
    expect(pv.columns.map((c) => c.label)).toEqual(['cash w/o', 'wholesale w/o', 'cash+GST', 'credit gst', 'Unit/Qty'])
  })

  it('a tier the Price List no longer has is reported and its column and values are not imported', () => {
    const pv = planLegacyImport(legacy(), empty({ tiers: tiers.filter((t) => t.key !== 'credit_gst') }), id)
    expect(pv.preview.missingTiers).toEqual(['credit_gst'])
    expect(pv.tabs[0]!.columns.some((c) => c.tier === 'credit_gst')).toBe(false)
    expect(pv.preview.unmappedValues).toBe(1)
  })

  it('Unit/Qty is shown when any item has a value', () => {
    const l = legacy(); l.items[1]!.qtyWithGst = '12 pcs'
    const p = planLegacyImport(l, empty(), id)
    expect(p.tabs[0]!.columns.find((c) => c.role === 'unit')!.hidden).toBe(false)
    expect(Object.values(p.rows.find((r) => r.row.nameRuns[0]!.t === 'Red Apple')!.row.cells)).toEqual(['12 pcs'])
  })

  it('never writes the same legacy key twice (a repeated name in one tab gets its own key)', () => {
    const l = legacy(); l.items.push(item(7, 11, 4, 'red  apple', { rate: '3' }))
    const p = planLegacyImport(l, empty(), id)
    const keys = p.rows.map((r) => r.legacyKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(legacyKey('Fruit', 'Apples', 'Red Apple', 2))
  })

  // ---- re-run states
  const imported = () => {
    const first = planLegacyImport(legacy(), empty(), id)
    const categories: PriceCategory[] = first.categories.map((c) => ({ id: c.id, name: c.name, color: null, position: c.position }))
    const tabs: PriceTab[] = first.tabs.map((t) => ({ id: t.id, categoryId: t.categoryId, name: t.name, position: t.position, columns: t.columns }))
    const rowsByTab = new Map<string, PriceRow[]>()
    const rowById = new Map<string, { row: PriceRow; deleted: boolean }>()
    const map = new Map<string, { legacyKey: string; rowId: string; fingerprint: string }>()
    for (const op of first.rows) {
      rowsByTab.set(op.row.tabId, [...(rowsByTab.get(op.row.tabId) ?? []), op.row])
      rowById.set(op.row.id, { row: op.row, deleted: false })
      map.set(op.legacyKey, { legacyKey: op.legacyKey, rowId: op.row.id, fingerprint: op.fingerprint })
    }
    return { categories, tabs, rowsByTab, rowById, map }
  }

  it('a re-run of an unchanged source is a no-op', () => {
    const p = planLegacyImport(legacy(), empty(imported()), id)
    expect(p.empty).toBe(true)
    expect(p.preview.items).toMatchObject({ added: 0, changed: 0, unchanged: 4, editedHere: 0, removedHere: 0 })
    expect(p.preview.categories.existing).toBe(2)
  })

  it('a source change updates only rows not edited here; an edited row is reported and kept; a deleted one is not brought back', () => {
    const st = imported()
    const l = legacy()
    l.items[0]!.rate = '120' // Green Apple: changed at the source, untouched here -> update
    l.items[3]!.rate = '60' // Conference Pear: changed at the source AND edited here -> reported
    l.items[2]!.rate = '9' // Gala Apple: changed at the source, but deleted here -> not brought back
    const pear = [...st.rowById.values()].find((r) => r.row.nameRuns[0]!.t === 'Conference Pear')!
    st.rowById.set(pear.row.id, { row: { ...pear.row, cells: { c1: '70' } }, deleted: false })
    const gala = [...st.rowById.values()].find((r) => r.row.nameRuns[0]!.t === 'Gala Apple')!
    st.rowById.set(gala.row.id, { row: gala.row, deleted: true })
    const p = planLegacyImport(l, empty(st), id)
    expect(p.preview.items).toMatchObject({ changed: 1, editedHere: 1, removedHere: 1, added: 0 })
    expect(p.rows).toHaveLength(1)
    const up = p.rows[0]!
    expect(up.op).toBe('update')
    expect(up.row.cells.c1).toBe('120')
    expect(up.row.id).toBe([...st.rowById.values()].find((r) => r.row.nameRuns[0]!.t === 'Green Apple Small')!.row.id) // same row, same place
  })

  it('a new item in an existing tab is appended after the existing rows; same name typed by hand is left alone', () => {
    const st = imported()
    const l = legacy()
    l.items.push(item(8, 11, 9, 'Fuji Apple', { rate: '5' }))
    const apples = st.tabs.find((t) => t.name === 'Apples')!
    const typed: PriceRow = { id: 'hand', tabId: apples.id, idx: 3, kind: 'item', nameRuns: fromPlain('Granny Smith'), cells: {} }
    st.rowsByTab.set(apples.id, [...st.rowsByTab.get(apples.id)!, typed])
    l.items.push(item(9, 11, 10, 'granny  smith', { rate: '6' }))
    const p = planLegacyImport(l, empty(st), id)
    expect(p.preview.items).toMatchObject({ added: 1, alreadyThere: 1 })
    expect(p.rows[0]!.row.idx).toBe(4)
  })

  it('rowFingerprint ignores ids and positions, not content', () => {
    const a: PriceRow = { id: 'a', tabId: 't', idx: 0, kind: 'item', nameRuns: fromPlain('X'), cells: { c1: '1' } }
    expect(rowFingerprint(a)).toBe(rowFingerprint({ ...a, ...{ id: 'b', idx: 5 } } as PriceRow))
    expect(rowFingerprint(a)).not.toBe(rowFingerprint({ ...a, cells: { c1: '2' } }))
  })
})
