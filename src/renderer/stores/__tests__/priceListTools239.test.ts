import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultColumnSet } from '@shared/pricelist/columns'
import { SEED_TIERS } from '@shared/pricelist/tiers'
import type { PriceRow, PriceTier } from '@shared/pricelist/types'
import type { PriceTree, SaveRowsInput } from '@shared/pricelist/api'
// The router store reads `window.location` when it is imported, so a minimal window exists before any import runs.
vi.hoisted(() => { (globalThis as unknown as { window: unknown }).window = { location: { hash: '' }, addEventListener: () => undefined, removeEventListener: () => undefined } })
import { applyBulk, applyClean, applyFind, exportCsv, previewBulk, searchAll, jumpToHit } from '../priceListTools'
import { usePriceListStore } from '../priceListStore'

// Invented data only. The bridge is mocked; nothing touches a database.
const tiers: PriceTier[] = SEED_TIERS.map((t, i) => ({ id: `ti${i}`, key: t.key, label: t.label, position: i }))
const columns = defaultColumnSet(SEED_TIERS)
const tree: PriceTree = {
  tiers,
  categories: [{ id: 'c1', name: 'Panna', color: null, position: 0 }],
  tabs: [{ id: 't1', categoryId: 'c1', name: 'Small', position: 0, columns }, { id: 't2', categoryId: 'c1', name: 'Big', position: 1, columns }]
}
const priceKey = columns[1]!.key
const mkRow = (id: string, name: string, idx: number, cells: Record<string, string> = {}): PriceRow => ({ id, tabId: 't1', idx, kind: 'item', nameRuns: name ? [{ t: name }] : [], cells })
let dbRows: PriceRow[]
let saved: SaveRowsInput[]
const st = () => usePriceListStore.getState()

beforeEach(() => {
  dbRows = [mkRow('r1', 'Acme one', 0, { [priceKey]: '10' }), mkRow('r2', 'Acme two', 1), mkRow('r3', ' Acme   three ', 2, { [priceKey]: '30' })]
  saved = []
  vi.stubGlobal('window', {
    location: { hash: '' },
    quot3: {
      pricelist: {
        tree: vi.fn(async () => ({ ok: true, data: tree })),
        rows: vi.fn(async (tabId: string) => ({ ok: true, data: tabId === 't1' ? dbRows : [] })),
        saveRows: vi.fn(async (input: SaveRowsInput) => {
          saved.push(input)
          let n = 0
          return { ok: true, data: { rows: input.rows.map((r) => ({ id: r.id ?? `real-${++n}`, tabId: input.tabId, idx: r.idx ?? 0, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells })), deleted: input.deleteIds?.length ?? 0 } }
        }),
        structure: vi.fn(), columns: vi.fn()
      }
    }
  })
  st().reset()
})
afterEach(() => { st().reset(); vi.unstubAllGlobals() })

const open = async (): Promise<void> => { await st().load() }

describe('Phase 239 - Price List power tools (store level)', () => {
  it('bulk +10% on the tab is ONE undo step and only touches priced rows', async () => {
    await open()
    expect(applyBulk({ mode: 'percent', scope: 'tab', columnKey: priceKey, value: '10', rounding: 'two' })).toBe(2)
    expect(st().rows.map((r) => r.cells[priceKey])).toEqual(['11', undefined, '33'])
    st().undo()
    expect(st().rows.map((r) => r.cells[priceKey])).toEqual(['10', undefined, '30'])
  })

  it('selection scope changes only the selected row', async () => {
    await open()
    st().clickCell(2, 1)
    expect(previewBulk({ mode: 'amount', scope: 'selection', columnKey: priceKey, value: '5', rounding: 'two' }).changes.map((c) => c.rowId)).toEqual(['r3'])
  })

  it('find and replace and name tidy are one undo step each', async () => {
    await open()
    expect(applyFind({ find: 'two', replace: 'TWO', caseSensitive: true, names: true, cells: false })).toBe(1)
    expect(st().rows[1]!.nameRuns.map((r) => r.t).join('')).toBe('Acme TWO')
    expect(applyClean()).toBe(1)
    expect(st().rows[2]!.nameRuns.map((r) => r.t).join('')).toBe('Acme three')
    st().undo(); st().undo()
    expect(st().rows[1]!.nameRuns.map((r) => r.t).join('')).toBe('Acme two')
  })

  it('global search finds rows and jumpToRow clears the filter and moves the cursor', async () => {
    await open()
    st().setFilter({ contains: 'one' })
    const hits = await searchAll('acme thr')
    expect(hits.map((h) => h.rowId)).toEqual(['r3'])
    await jumpToHit(hits[0]!)
    expect(st().filter.contains).toBe('')
    expect(st().nav.row).toBe(2)
  })

  it('duplicate warning appears after a pause, only for item-name cells, and clears on commit', async () => {
    vi.useFakeTimers()
    try {
      await open()
      st().clickCell(1, 0)
      st().setDraft('three acme')
      expect(st().dupWarn).toBe('')
      vi.advanceTimersByTime(350)
      expect(st().dupWarn).toContain('Already in this tab')
      st().commit()
      expect(st().dupWarn).toBe('')
      st().clickCell(1, 1)
      st().setDraft('9')
      vi.advanceTimersByTime(350)
      expect(st().dupWarn).toBe('')
    } finally { vi.useRealTimers() }
  })

  it('CSV export builds a download of the open tab', async () => {
    await open()
    const clicks: string[] = []
    const doc = { createElement: () => ({ click: () => clicks.push('x'), remove: () => undefined, set href(_: string) {}, set download(v: string) { clicks.push(v) } }), body: { appendChild: () => undefined } }
    vi.stubGlobal('document', doc)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    expect(exportCsv()).toBe(true)
    expect(clicks).toContain('Small.csv')
  })
})
