import { describe, expect, it } from 'vitest'
import { addTier, removeTier, renameTier, reorderTier, SEED_TIERS, tierKeyFromLabel, uniqueTierKey } from '../tiers'
import { addColumn, defaultColumnSet, moveColumn, priceColumnForTier, removeColumn, sanitizeColumns, nextColumnKey, updateColumn } from '../columns'
import { addCategory, addTab, duplicateTab, moveTabToCategory, renameTab, reorderTab, uniqueName } from '../structure'
import { deleteRows, filterRows, hasNoPrice, insertRow, moveRows, newRow, sanitizeCell, sanitizeRow, setCell, sortRows } from '../rows'
import { adjustAmount, adjustPercent, applyChanges, cleanNames, fillFromColumn, findReplaceCells, findReplaceNames } from '../bulk'
import { buildIndex, match } from '../match'
import { decideFill, freshRowState, onRateTyped, onFillUndone } from '../autofill'
import { effectiveFlags, flagsToStore, isAllowed, requiredFlags } from '../perms'
import { describeEntry, makeLogEntry, retentionCutoff, isExpired } from '../logEntry'
import { csvField, toCsv } from '../csv'
import { PRICELIST_DEFAULTS, PRICELIST_KEYS, isPriceListSettingValue, readPriceListSettings, billingActive, tierForFormat } from '../settings'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../../settings'
import type { PriceColumn, PriceRow, PriceTab, PriceTier } from '../types'

const tiers: PriceTier[] = SEED_TIERS.map((t, i) => ({ id: `t${i}`, key: t.key, label: t.label, position: i }))
const cols = defaultColumnSet(SEED_TIERS)
const row = (id: string, idx: number, name: string, cells: Record<string, string> = {}): PriceRow => ({ ...newRow(id, 'tab1', idx, 'item', name), cells })

describe('tiers', () => {
  it('keys come from labels, are unique and never reused', () => {
    expect(tierKeyFromLabel('cash+GST')).toBe('cash_plus_gst')
    expect(tierKeyFromLabel('9 retail')).toBe('t_9_retail')
    expect(uniqueTierKey('cash w/o', new Set(['cash_w_o']))).toBe('cash_w_o_2')
    const r = addTier(tiers, 'Dealer', 'x1', new Set(['dealer']))
    expect(r.ok && r.tier.key).toBe('dealer_2')
  })
  it('rename keeps the key; duplicates / empty / limit refused', () => {
    const r = renameTier(tiers, 'cash_wo', 'Cash only')
    expect(r.ok && r.tier.key).toBe('cash_wo')
    expect(renameTier(tiers, 'cash_wo', ' WHOLESALE w/o ').ok).toBe(false)
    expect(addTier(tiers, '  ', 'z').ok).toBe(false)
    expect(addTier(tiers, 'CASH W/O', 'z')).toEqual({ ok: false, reason: 'duplicate' })
  })
  it('remove and reorder renumber positions', () => {
    expect(removeTier(tiers, 'cash_wo').map((t) => t.position)).toEqual([0, 1, 2])
    expect(reorderTier(tiers, 'credit_gst', 0).map((t) => t.key)[0]).toBe('credit_gst')
  })
})

describe('columns', () => {
  it('sanitise forces a name column first, drops junk and duplicates, caps at 12', () => {
    const c = sanitizeColumns([{ key: 'c1', label: 'A', role: 'price', tier: 'cash_wo' }, { key: 'c1', label: 'dup' }, { key: 'bad key' }, 5, null])
    expect(c[0]!.role).toBe('name')
    expect(c.map((x) => x.key)).toEqual(['name', 'c1'])
    expect(c[1]!.type).toBe('number')
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, label: `L${i}` }))
    expect(sanitizeColumns(many)).toHaveLength(12)
    expect(sanitizeColumns('nope')).toHaveLength(1)
  })
  it('add / remove / move / update; the name column is protected; keys are not reused', () => {
    let c = defaultColumnSet(SEED_TIERS)
    const a = addColumn(c, { label: 'Unit', role: 'unit' }, ['c5', 'c6'])
    expect(a.ok && a.column!.key).toBe('c7')
    c = a.ok ? a.columns : c
    expect(removeColumn(c, 'name')).toEqual({ ok: false, reason: 'name_column' })
    const rm = removeColumn(c, 'c7')
    expect(rm.ok).toBe(true)
    expect(nextColumnKey(rm.ok ? rm.columns : [], ['c5', 'c6', 'c7'])).toBe('c8')
    const mv = moveColumn(c, 'c3', 0)
    expect(mv.ok && mv.columns[0]!.key).toBe('name')
    const up = updateColumn(c, 'name', { hidden: true })
    expect(up.ok && up.columns[0]!.hidden).toBe(false)
    let full = c
    for (let i = 0; i < 20; i++) { const r = addColumn(full, { label: `X${i}` }); if (r.ok) full = r.columns }
    expect(full).toHaveLength(12)
    expect(addColumn(full, { label: 'more' })).toEqual({ ok: false, reason: 'limit' })
  })
  it('finds the column for a tier', () => {
    expect(priceColumnForTier(cols, 'cash_gst')?.key).toBe('c3')
    expect(priceColumnForTier(cols, 'nope')).toBeNull()
  })
})

describe('structure', () => {
  it('unique names are case / space-insensitive', () => {
    expect(uniqueName('Panna', ['  panna '])).toBe('Panna (2)')
    const r = addCategory([], 'Tiles', 'c1')
    expect(r.ok).toBe(true)
    expect(addCategory(r.ok ? r.value : [], ' tiles', 'c2')).toEqual({ ok: false, reason: 'duplicate' })
  })
  it('tabs: add, rename clash, reorder inside category, move category', () => {
    let tabs: PriceTab[] = []
    for (const [id, name] of [['a', 'Small'], ['b', 'Big'], ['c', 'Mid']] as const) { const r = addTab(tabs, 'cat1', name, id, cols); tabs = r.ok ? r.value : tabs }
    tabs = addTab(tabs, 'cat2', 'Other', 'z', cols).ok ? (addTab(tabs, 'cat2', 'Other', 'z', cols) as { value: PriceTab[] }).value : tabs
    expect(renameTab(tabs, 'a', 'BIG')).toEqual({ ok: false, reason: 'duplicate' })
    const re = reorderTab(tabs, 'c', 0)
    expect(re.filter((t) => t.categoryId === 'cat1').sort((x, y) => x.position - y.position).map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(re.find((t) => t.id === 'z')!.position).toBe(0)
    const mv = moveTabToCategory(tabs, 'a', 'cat2')
    expect(mv.find((t) => t.id === 'a')).toMatchObject({ categoryId: 'cat2', position: 1 })
    expect(mv.filter((t) => t.categoryId === 'cat1').map((t) => t.position).sort()).toEqual([0, 1])
  })
  it('duplicate tab copies rows with fresh ids', () => {
    const tabs: PriceTab[] = [{ id: 'a', categoryId: 'c', name: 'Small', position: 0, columns: cols }, { id: 'b', categoryId: 'c', name: 'Big', position: 1, columns: cols }]
    let n = 0
    const d = duplicateTab(tabs, [{ ...row('r1', 0, 'ALPHA 1'), tabId: 'a' }], 'a', 'a2', () => `n${++n}`)!
    expect(d.tab).toMatchObject({ id: 'a2', name: 'Small (2)', position: 1 })
    expect(d.tabs.find((t) => t.id === 'b')!.position).toBe(2)
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ id: 'n1', tabId: 'a2' })
    expect(duplicateTab(tabs, [], 'nope', 'x', () => 'y')).toBeNull()
  })
})

describe('rows', () => {
  const price = cols[1]!
  it('cells: decimals are canonical strings, bad input refused', () => {
    expect(sanitizeCell(price, '110.00')).toBe('110')
    expect(sanitizeCell(price, '1,250.50')).toBe('1250.5')
    expect(sanitizeCell(price, 'abc')).toBeNull()
    expect(sanitizeCell(price, '1e5')).toBeNull()
    expect(sanitizeCell(price, '  ')).toBe('')
    expect(sanitizeCell({ type: 'choice', role: 'other', choices: ['Box', 'Pcs'] }, 'pcs')).toBe('Pcs')
    expect(sanitizeCell({ type: 'choice', role: 'other', choices: ['Box'] }, 'zzz')).toBeNull()
  })
  it('setCell keeps identity when unchanged and deletes on empty', () => {
    const r = row('r', 0, 'X', { c1: '5' })
    expect(setCell(r, price, '5')).toBe(r)
    expect(setCell(r, price, '')!.cells).toEqual({})
    expect(setCell(r, price, 'x')).toBeNull()
  })
  it('sanitizeRow drops prices from section rows', () => {
    const s = sanitizeRow({ ...row('s', 0, 'BIG PANNA', { c1: '5' }), kind: 'section' }, cols)
    expect(s.cells).toEqual({})
  })
  it('insert / move / delete renumber idx; moves stop at the edge', () => {
    let rows = [row('a', 0, 'A'), row('b', 1, 'B'), row('c', 2, 'C')]
    rows = insertRow(rows, row('n', 9, 'N'), 1)
    expect(rows.map((r) => `${r.id}${r.idx}`)).toEqual(['a0', 'n1', 'b2', 'c3'])
    expect(moveRows(rows, new Set(['a']), -1).map((r) => r.id)).toEqual(['a', 'n', 'b', 'c'])
    expect(moveRows(rows, new Set(['n', 'b']), 1).map((r) => r.id)).toEqual(['a', 'c', 'n', 'b'])
    expect(deleteRows(rows, new Set(['n'])).map((r) => r.idx)).toEqual([0, 1, 2])
  })
  it('no-price filter and contains filter; sections never count as no-price', () => {
    const rows = [row('a', 0, 'ALPHA', { c1: '10' }), row('b', 1, 'BETA'), { ...row('s', 2, 'HEAD'), kind: 'section' as const }]
    expect(hasNoPrice(rows[1]!, cols)).toBe(true)
    expect(hasNoPrice(rows[2]!, cols)).toBe(false)
    expect(filterRows(rows, cols, { noPrice: true }).map((r) => r.id)).toEqual(['b'])
    expect(filterRows(rows, cols, { contains: 'alp' }).map((r) => r.id)).toEqual(['a'])
  })
  it('sort: numeric, blanks last, sections stay put', () => {
    const rows = [row('a', 0, 'A', { c1: '100' }), row('b', 1, 'B', { c1: '9' }), { ...row('s', 2, 'SEC'), kind: 'section' as const }, row('c', 3, 'C'), row('d', 4, 'D', { c1: '50' })]
    expect(sortRows(rows, price, 'asc').map((r) => r.id)).toEqual(['b', 'a', 's', 'd', 'c'])
    expect(sortRows(rows, price, 'desc').map((r) => r.id)).toEqual(['a', 'b', 's', 'd', 'c'])
  })
})

describe('bulk (decimal.js only)', () => {
  const rows = [row('a', 0, 'A', { c1: '110', c2: '' }), row('b', 1, 'B', { c1: '99.99' }), row('c', 2, 'C'), { ...row('s', 3, 'SEC', { c1: '5' }), kind: 'section' as const }]
  it('+% preview rounds half up, skips blanks and sections, never mutates', () => {
    const p = adjustPercent(rows, 'c1', '10')
    expect(p.changes.map((c) => c.after)).toEqual(['121', '109.99'])
    expect(p.skipped).toBe(1)
    expect(rows[0]!.cells.c1).toBe('110')
    expect(adjustPercent(rows, 'c1', '-200').changes.map((c) => c.after)).toEqual(['0', '0'])
    expect(adjustPercent(rows, 'c1', '10', {}, 'whole').changes.map((c) => c.after)).toEqual(['121', '110'])
  })
  it('amount and selection scope', () => {
    expect(adjustAmount(rows, 'c1', '2.5', { rowIds: new Set(['b']) }).changes).toEqual([{ rowId: 'b', columnKey: 'c1', before: '99.99', after: '102.49' }])
  })
  it('fill from column: only empty targets unless overwrite', () => {
    const r2 = [row('a', 0, 'A', { c1: '100', c2: '50' }), row('b', 1, 'B', { c1: '200' })]
    expect(fillFromColumn(r2, 'c1', 'c2', '5').changes.map((c) => [c.rowId, c.after])).toEqual([['b', '210']])
    expect(fillFromColumn(r2, 'c1', 'c2', '5', { overwrite: true }).changes).toHaveLength(2)
  })
  it('apply writes changes into a new array and keeps other rows', () => {
    const out = applyChanges(rows, adjustPercent(rows, 'c1', '10').changes)
    expect(out[0]!.cells.c1).toBe('121')
    expect(out[2]).toBe(rows[2])
  })
  it('find / replace is literal and case-insensitive by default', () => {
    const noteCol: PriceColumn = { key: 'c9', label: 'Note', type: 'text', role: 'note', widthPx: 100, align: 'left', hidden: false, frozen: false }
    const r = [row('a', 0, 'A', { c9: 'a.b (x) A.B' })]
    expect(findReplaceCells(r, [...cols, noteCol], 'a.b', 'Z')[0]!.after).toBe('Z (x) Z')
    expect(findReplaceCells(r, [...cols, noteCol], '', 'Z')).toEqual([])
    expect(findReplaceNames([row('n', 0, 'Tile (2.5)')], '(2.5)', '[2.5]')[0]!.after).toEqual([{ t: 'Tile [2.5]' }])
  })
  it('clean names trims and collapses and keeps styles', () => {
    const r = { ...row('a', 0, ''), nameRuns: [{ t: '  AB\u00A0 ', b: 1 as const }, { t: ' CD\n', r: 1 as const }] }
    const ch = cleanNames([r, row('ok', 1, 'FINE')])
    expect(ch).toHaveLength(1)
    expect(ch[0]!.after).toEqual([{ t: 'AB ', b: 1 }, { t: 'CD', r: 1 }])
  })
})

describe('match (deterministic)', () => {
  const idx = buildIndex([
    { rowId: '1', tabId: 't', name: 'ACME 1001 SMALL PANNA (90 CMS)' },
    { rowId: '2', tabId: 't', name: 'ACME 1002 SMALL PANNA' },
    { rowId: '3', tabId: 't', name: 'ZETA BIG WHEEL 12 INCH' },
    { rowId: '4', tabId: 't', name: 'ZETA BIG WHEEL 18 INCH' },
    { rowId: '5', tabId: 't', name: 'LOADING CHARGES' }
  ])
  it('same item in another word order / case / note is confident', () => {
    const m = match('small panna acme 1001', idx)
    expect(m.confident).toBe(true)
    expect(m.best!.rowId).toBe('1')
  })
  it('a different code is never confident even when words match', () => {
    const m = match('ACME 1003 SMALL PANNA', idx)
    expect(m.confident).toBe(false)
    expect(m.reason).toBe('protected_differs')
  })
  it('sizes are protected tokens', () => {
    expect(match('zeta big wheel 12 inch', idx).best!.rowId).toBe('3')
    expect(match('zeta big wheel 16 inch', idx).confident).toBe(false)
  })
  it('empty, non-product and unknown give no fill', () => {
    expect(match('', idx).reason).toBe('empty')
    expect(match('transport charges', idx).reason).toBe('non_product')
    expect(match('qqq www', idx).reason).toBe('no_match')
  })
  it('two identical items on two tabs are ambiguous', () => {
    const dup = buildIndex([{ rowId: 'a', tabId: 't1', name: 'OMEGA 5 PIPE' }, { rowId: 'b', tabId: 't2', name: 'OMEGA 5 PIPE' }])
    expect(match('omega 5 pipe', dup).reason).toBe('ambiguous')
  })
  it('a partial name is low-score under strict, found under loose; results are deterministic', () => {
    const i2 = buildIndex([{ rowId: 'a', tabId: 't', name: 'KAPPA TILE GLOSSY WHITE' }])
    expect(match('kappa tile', i2, 'strict').confident).toBe(false)
    expect(match('kappa tile', i2, 'loose').confident).toBe(true)
    expect(match('kappa tile', i2, 'loose')).toEqual(match('kappa tile', i2, 'loose'))
  })
  it('prefix typing (3+ letters) counts as a partial hit', () => {
    expect(match('acme 1002 small pan', idx).best!.rowId).toBe('2')
  })
  it('caps candidates', () => {
    expect(match('zeta', idx, 'normal', 1).candidates).toHaveLength(1)
  })
})

describe('autofill state machine', () => {
  const m = match('acme 1001 small panna', buildIndex([{ rowId: '1', tabId: 't', name: 'ACME 1001 SMALL PANNA' }]))
  const base = { mode: 'auto' as const, loading: false, formatHasRate: true, tierKey: 'cash_wo', rateText: '', nameKey: 'K1', match: m, tierValue: '110' }
  it('fills an empty untouched rate on a confident match', () => {
    const d = decideFill(freshRowState(), base)
    expect(d).toMatchObject({ action: 'fill', value: '110', replaced: false })
  })
  it('never when off / suggest / loading / no rate column / no tier', () => {
    for (const patch of [{ mode: 'off' }, { mode: 'suggest' }, { loading: true }, { formatHasRate: false }, { tierKey: null }] as const)
      expect(decideFill(freshRowState(), { ...base, ...patch }).action).toBe('none')
  })
  it('never over a typed / loaded rate, and typing locks the row for good', () => {
    expect(decideFill(freshRowState(), { ...base, rateText: '95' })).toMatchObject({ action: 'none', reason: 'rate_has_value' })
    const touched = onRateTyped(freshRowState())
    expect(decideFill(touched, base)).toMatchObject({ action: 'none', reason: 'rate_touched' })
  })
  it('re-fills only when the rate still equals the auto value and the name changed', () => {
    const filled = decideFill(freshRowState(), base)
    const st = filled.state
    expect(decideFill(st, { ...base, rateText: '110' })).toMatchObject({ action: 'none', reason: 'same_name' })
    const m2 = match('acme 1002 small panna', buildIndex([{ rowId: '2', tabId: 't', name: 'ACME 1002 SMALL PANNA' }]))
    const re = decideFill(st, { ...base, rateText: '110', nameKey: 'K2', match: m2, tierValue: '120' })
    expect(re).toMatchObject({ action: 'fill', value: '120', replaced: true })
    expect(decideFill(st, { ...base, rateText: '111', nameKey: 'K2', match: m2, tierValue: '120' })).toMatchObject({ action: 'none', reason: 'rate_has_value' })
    expect(decideFill(st, { ...base, rateText: '110', nameKey: 'K2', match: match('zz', []), tierValue: '120' })).toMatchObject({ action: 'none', reason: 'no_confident_match' })
  })
  it('no fill for a missing / non-numeric tier value or a non-confident match; undo forgets the fill', () => {
    expect(decideFill(freshRowState(), { ...base, tierValue: '' })).toMatchObject({ reason: 'no_tier_value' })
    expect(decideFill(freshRowState(), { ...base, tierValue: 'abc' })).toMatchObject({ reason: 'no_tier_value' })
    expect(decideFill(freshRowState(), { ...base, match: match('qqq', []) })).toMatchObject({ reason: 'no_confident_match' })
    const st = decideFill(freshRowState(), base).state
    expect(onFillUndone(st)).toEqual({ rateTouched: false, autoFilledValue: null, autoFilledForNameKey: null })
  })
})

describe('perms', () => {
  const row0 = { kind: 'price_row' as const, rowKind: 'item' as const, idx: 0, name: 'A', cells: { c1: '10' } }
  it('required flag from the old / new payload', () => {
    expect(requiredFlags(null, row0)).toEqual(['add'])
    expect(requiredFlags(row0, { ...row0, name: 'B' })).toEqual(['edit'])
    expect(requiredFlags(row0, { ...row0, cells: { c1: '10', c2: '5' } })).toEqual(['edit'])
    expect(requiredFlags(row0, { ...row0, cells: { c1: '11' } })).toEqual(['overwrite'])
    expect(requiredFlags(row0, { ...row0, cells: {} })).toEqual(['overwrite'])
    expect(requiredFlags(row0, { ...row0, deleted: true })).toEqual(['delete'])
    expect(requiredFlags({ ...row0, deleted: true }, row0)).toEqual(['add'])
    expect(requiredFlags(row0, row0)).toEqual([])
    expect(requiredFlags(row0, { ...row0, name: 'B', cells: { c1: '12' } }).sort()).toEqual(['edit', 'overwrite'])
  })
  it('structure for tiers, categories, tabs', () => {
    const tab = { kind: 'price_tab' as const, name: 'S', position: 0, columnsKey: 'a' }
    expect(requiredFlags(null, tab)).toEqual(['structure'])
    expect(requiredFlags(tab, { ...tab, columnsKey: 'b' })).toEqual(['structure'])
    expect(requiredFlags(tab, tab)).toEqual([])
    expect(requiredFlags(tab, { ...tab, deleted: true })).toEqual(['delete'])
  })
  it('seat 1 and no-sync have full rights; others only what was granted; hostile flags ignored', () => {
    expect(effectiveFlags(1, {}, true).structure).toBe(true)
    expect(effectiveFlags(3, {}, false).delete).toBe(true)
    expect(effectiveFlags(3, { add: true, edit: 'yes' }, true)).toEqual({ add: true, edit: false, overwrite: false, delete: false, structure: false })
    expect(effectiveFlags(null, { add: true }, true).add).toBe(false)
    expect(flagsToStore(1, { add: false }).add).toBe(true)
    expect(isAllowed(effectiveFlags(3, { add: true }, true), ['add', 'edit'])).toBe(false)
  })
})

describe('log entries', () => {
  it('caps values, drops no-op changes, builds a path and a plain line', () => {
    const e = makeLogEntry({ now: new Date('2026-11-12T10:00:00Z'), seatNo: 2, branchId: 'b1', deviceKind: 'phone', entity: 'row', entityId: 'r1', op: 'overwrite', path: ['Panna', 'Small', 'ACME 1001'], changes: [{ column: 'cash w/o', before: '110', after: '120' }, { column: 'x', before: 'a', after: 'a' }, { column: 'long', before: 'y'.repeat(500), after: '' }] })
    expect(e.path).toBe('Panna \u203A Small \u203A ACME 1001')
    expect(e.changes).toHaveLength(2)
    expect(Array.from(e.changes![1]!.before)).toHaveLength(200)
    expect(describeEntry(e, 'Branch A')).toBe('Seat 2 (Branch A, phone) changed cash w/o: 110 \u2192 120 in Panna \u203A Small \u203A ACME 1001')
    expect(makeLogEntry({ now: new Date(0), seatNo: null, branchId: '', deviceKind: 'pc', entity: 'list', entityId: 'l', op: 'import', path: [], count: 0 }).count).toBe(1)
  })
  it('retention is clamped and expiry compares instants', () => {
    const now = new Date('2026-11-12T00:00:00Z')
    expect(retentionCutoff(now, 1).toISOString()).toBe('2026-10-13T00:00:00.000Z')
    expect(isExpired({ at: '2025-01-01T00:00:00Z' }, retentionCutoff(now, 365))).toBe(true)
    expect(isExpired({ at: '2026-11-01T00:00:00Z' }, retentionCutoff(now, 365))).toBe(false)
  })
})

describe('csv', () => {
  it('quotes, neutralises formulas, keeps numbers, skips hidden columns', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('-5', true)).toBe('-5')
    const hidden = cols.map((c) => (c.key === 'c4' ? { ...c, hidden: true } : c))
    const out = toCsv(hidden, [row('a', 1, '=BAD, "x"', { c1: '110' }), row('b', 0, 'GOOD', { c3: '108' })], { bom: true })
    expect(out).toBe('\uFEFFItem,cash w/o,wholesale w/o,cash+GST\r\nGOOD,,,108\r\n' + '"\'=BAD, ""x""",110,,\r\n')
  })
})

describe('settings', () => {
  it('keys are valid setting keys and defaults are in SETTING_DEFAULTS', () => {
    for (const k of Object.values(PRICELIST_KEYS)) { expect(SETTING_KEY_RE.test(k)).toBe(true); expect(SETTING_DEFAULTS[k]).toEqual(PRICELIST_DEFAULTS[k]) }
    expect(Object.values(PRICELIST_KEYS)).toHaveLength(11)
  })
  it('defaults match the contract [A]', () => {
    const s = readPriceListSettings(SETTING_DEFAULTS as Record<string, unknown>)
    expect(s).toMatchObject({ enabled: true, mode: 'auto', strictness: 'normal', maxSuggestions: 5, markAutoFilled: true, fillName: false, excludedTabs: [], logVisible: false, logRetentionDays: 365 })
    expect(s.formatTier).toEqual({ non_gst: 'cash_wo', gst: 'cash_gst' })
    expect(s.defaultColumns.map((c) => c.role)).toEqual(['name', 'price', 'price', 'price', 'price'])
  })
  it('bad stored values fall back; formatTier merges over defaults; null means no tier', () => {
    const s = readPriceListSettings({ [PRICELIST_KEYS.mode]: 'turbo', [PRICELIST_KEYS.maxSuggestions]: 99, [PRICELIST_KEYS.logRetentionDays]: 5, [PRICELIST_KEYS.formatTier]: { gst: null, hybrid: 'credit_gst' }, [PRICELIST_KEYS.defaultColumns]: 'x', [PRICELIST_KEYS.enabled]: 'no' })
    expect(s.mode).toBe('auto')
    expect(s.maxSuggestions).toBe(5)
    expect(s.logRetentionDays).toBe(365)
    expect(s.enabled).toBe(true)
    expect(tierForFormat(s, 'gst')).toBeNull()
    expect(tierForFormat(s, 'hybrid')).toBe('credit_gst')
    expect(tierForFormat(s, 'unknown')).toBeNull()
    expect(s.defaultColumns).toHaveLength(5)
  })
  it('schema accepts good values and rejects bad ones; billing switch rules', () => {
    expect(isPriceListSettingValue(PRICELIST_KEYS.mode, 'suggest')).toBe(true)
    expect(isPriceListSettingValue(PRICELIST_KEYS.mode, 'x')).toBe(false)
    expect(isPriceListSettingValue(PRICELIST_KEYS.maxSuggestions, 3.5)).toBe(false)
    expect(isPriceListSettingValue('pricelist.unknown', true)).toBe(false)
    expect(billingActive({ enabled: false, mode: 'auto' })).toBe(false)
    expect(billingActive({ enabled: true, mode: 'off' })).toBe(false)
    expect(billingActive({ enabled: true, mode: 'suggest' })).toBe(true)
  })
})
