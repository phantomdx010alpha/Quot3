import { describe, expect, it } from 'vitest'
import { buildBillingData, formatHasRate, matchForBilling, nextBillingMode, stripView, tierColumn, tierValue, tiersOfRow } from '../billing'
import { decideFill, freshRowState, onRateTyped } from '../autofill'
import { defaultColumnSet } from '../columns'
import { SEED_TIERS } from '../tiers'
import { newRow } from '../rows'
import { plain } from '../../richtext/runs'
import { tierForFormat, readPriceListSettings } from '../settings'
import { getFormat } from '../../format/registry'
import type { PriceRow, PriceTab } from '../types'

// Invented names only.
const columns = defaultColumnSet(SEED_TIERS)
const priceCols = columns.filter((c) => c.role === 'price')
const tab = (id: string, categoryId = 'c1'): PriceTab => ({ id, categoryId, name: `Tab ${id}`, position: 0, columns })
const withPrices = (r: PriceRow, byTier: Record<string, string>): PriceRow => ({ ...r, cells: Object.fromEntries(priceCols.filter((c) => byTier[c.tier ?? '']).map((c) => [c.key, byTier[c.tier!]!])) })
const item = (id: string, tabId: string, name: string, byTier: Record<string, string>): PriceRow => withPrices(newRow(id, tabId, 0, 'item', name), byTier)
const plainOf = (r: PriceRow): string => plain(r.nameRuns)

const rows = {
  t1: [
    item('r1', 't1', 'ZETA ROUND BOX 1001 (90 CMS)', { cash_wo: '110', cash_gst: '108' }),
    item('r2', 't1', 'ZETA ROUND BOX 1002 (90 CMS)', { cash_wo: '120', cash_gst: '118' }),
    { ...newRow('s1', 't1', 2, 'section', 'SECTION ZETA'), cells: {} },
    item('r3', 't1', 'OMEGA LAMP 5 INCH', { cash_wo: '' })
  ],
  t2: [item('r4', 't2', 'KAPPA LAMP 7 INCH', { cash_wo: '45' })]
}
const data = (excluded: string[] = []) => buildBillingData([tab('t1'), tab('t2', 'c2')], rows, excluded, plainOf)

describe('Phase 240 - billing data and tiers (pure)', () => {
  it('indexes item rows only (no sections, no blank names) and respects excluded tabs and categories', () => {
    expect(data().index.map((e) => e.rowId).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(data(['t2']).index.some((e) => e.rowId === 'r4')).toBe(false)
    expect(data(['c1']).index.map((e) => e.rowId)).toEqual(['r4'])
  })
  it('finds the tier value by tier KEY in the matched row\'s own tab columns; missing = empty string', () => {
    const d = data()
    expect(tierValue(d, 'r1', 'cash_wo')).toBe('110')
    expect(tierValue(d, 'r1', 'cash_gst')).toBe('108')
    expect(tierValue(d, 'r3', 'cash_wo')).toBe('')
    expect(tierValue(d, 'r1', 'nope')).toBe('')
    expect(tierValue(d, 'zzz', 'cash_wo')).toBe('')
    expect(tierColumn(columns, null)).toBeUndefined()
  })
  it('lists ALL tiers that have a value, in tier order, for the strip', () => {
    const t = tiersOfRow(data(), 'r1', SEED_TIERS.map((x, i) => ({ id: x.key, key: x.key, label: x.label, position: i })))
    expect(t.map((x) => x.value)).toEqual(expect.arrayContaining(['110', '108']))
    expect(t.length).toBe(2)
  })
  it('a format has a rate column by DATA: Non-GST and GST yes, Stock transfer no (no format name in code)', () => {
    expect(formatHasRate(getFormat('non_gst'))).toBe(true)
    expect(formatHasRate(getFormat('gst'))).toBe(true)
    expect(formatHasRate(getFormat('stock_transfer'))).toBe(false)
    expect(formatHasRate(null)).toBe(false)
  })
  it('the format -> tier mapping defaults come from settings data, and a format without an entry gets no tier', () => {
    const s = readPriceListSettings({})
    expect(tierForFormat(s, 'non_gst')).toBe('cash_wo')
    expect(tierForFormat(s, 'gst')).toBe('cash_gst')
    expect(tierForFormat(s, 'brand_new_format')).toBeNull()
  })
  it('cycles the mode Auto -> Suggest -> Off -> Auto', () => {
    expect(nextBillingMode('auto')).toBe('suggest'); expect(nextBillingMode('suggest')).toBe('off'); expect(nextBillingMode('off')).toBe('auto')
  })
})

describe('Phase 240 - the fill decision on real matches', () => {
  const d = data()
  const decide = (name: string, rate: string, tierKey: string | null, state = freshRowState(), mode: 'auto' | 'suggest' | 'off' = 'auto', hasRate = true) => {
    const m = matchForBilling(d, name, 'normal', 5)
    return decideFill(state, { mode, loading: false, formatHasRate: hasRate, tierKey, rateText: rate, nameKey: name.toLowerCase(), match: m, tierValue: m.best ? tierValue(d, m.best.rowId, tierKey) : undefined })
  }
  it('fills the tier of the format on a confident match with an empty rate', () => {
    const r = decide('zeta round box 1001 (90 cms)', '', 'cash_wo')
    expect(r.action).toBe('fill'); if (r.action === 'fill') expect(r.value).toBe('110')
    const g = decide('zeta round box 1001 (90 cms)', '', 'cash_gst')
    if (g.action === 'fill') expect(g.value).toBe('108'); else throw new Error('expected fill')
  })
  it('never fills for a different code or size (protected tokens): 1003 is not 1001', () => {
    expect(decide('zeta round box 1003 (90 cms)', '', 'cash_wo').action).toBe('none')
  })
  it('never fills over a hand-typed rate, after the rate was touched, when the matched tier is empty, or when mode is not auto', () => {
    expect(decide('zeta round box 1001 (90 cms)', '77', 'cash_wo')).toMatchObject({ action: 'none', reason: 'rate_has_value' })
    expect(decide('zeta round box 1001 (90 cms)', '', 'cash_wo', onRateTyped(freshRowState()))).toMatchObject({ action: 'none', reason: 'rate_touched' })
    expect(decide('omega lamp 5 inch', '', 'cash_wo')).toMatchObject({ action: 'none', reason: 'no_tier_value' })
    expect(decide('zeta round box 1001 (90 cms)', '', 'cash_wo', freshRowState(), 'suggest').action).toBe('none')
    expect(decide('zeta round box 1001 (90 cms)', '', 'cash_wo', freshRowState(), 'off').action).toBe('none')
  })
  it('does nothing for a format without a rate column (stock transfer) or without a tier', () => {
    expect(decide('zeta round box 1001 (90 cms)', '', 'cash_wo', freshRowState(), 'auto', false)).toMatchObject({ reason: 'no_rate_column' })
    expect(decide('zeta round box 1001 (90 cms)', '', null)).toMatchObject({ reason: 'no_tier' })
  })
  it('re-fills a rate that still holds exactly the auto-filled value when the name changes to another item', () => {
    const first = decide('zeta round box 1001 (90 cms)', '', 'cash_wo')
    if (first.action !== 'fill') throw new Error('expected fill')
    const again = decide('zeta round box 1002 (90 cms)', first.value, 'cash_wo', first.state)
    expect(again).toMatchObject({ action: 'fill', value: '120', replaced: true })
    // a rate the owner changed after the fill is theirs
    expect(decide('zeta round box 1002 (90 cms)', '130', 'cash_wo', first.state).action).toBe('none')
  })
})

describe('Phase 240 - strip view', () => {
  const d = data()
  const tiers = SEED_TIERS.map((x, i) => ({ id: x.key, key: x.key, label: x.label, position: i }))
  const base = { enabled: true, mode: 'suggest' as const, cellActive: true, hasData: true, typed: 'zeta round box 1001', tierKey: 'cash_wo', tiers, data: d, filled: null }
  it('hides when off, the master is off, no cell is active, or nothing is typed', () => {
    const m = matchForBilling(d, 'zeta round box 1001', 'normal', 5)
    expect(stripView({ ...base, match: m, mode: 'off' }).kind).toBe('hidden')
    expect(stripView({ ...base, match: m, enabled: false }).kind).toBe('hidden')
    expect(stripView({ ...base, match: m, cellActive: false }).kind).toBe('hidden')
    expect(stripView({ ...base, match: m, typed: '  ' }).kind).toBe('hidden')
  })
  it('shows the match with all its tiers; the filled value only in Auto mode; says so when the list is empty', () => {
    const m = matchForBilling(d, 'zeta round box 1001', 'normal', 5)
    const v = stripView({ ...base, match: m })
    expect(v.kind).toBe('match')
    if (v.kind === 'match') { expect(v.candidates[0]!.tiers.length).toBe(2); expect(v.filled).toBeNull() }
    const a = stripView({ ...base, match: m, mode: 'auto', filled: '110' })
    if (a.kind === 'match') expect(a.filled).toBe('110')
    expect(stripView({ ...base, match: null, hasData: false }).kind).toBe('notice')
  })
})
