import { describe, expect, it } from 'vitest'
import { adjustPercent, applyChanges, cleanNames, fillFromColumn, findReplaceNames } from '../bulk'
import { toCsv } from '../csv'
import { defaultColumnSet } from '../columns'
import { SEED_TIERS } from '../tiers'
import { findDuplicates, rankHits, searchTabRows } from '../search'
import type { PriceRow } from '../types'

// Invented data only.
const cols = defaultColumnSet(SEED_TIERS)
const price = cols[1]!.key
const price2 = cols[2]!.key
const row = (id: string, name: string, idx: number, cells: Record<string, string> = {}): PriceRow => ({ id, tabId: 't1', idx, kind: 'item', nameRuns: name ? [{ t: name }] : [], cells })
const rows = [row('a', 'Acme Widget 1/2', 0, { [price]: '100' }), row('b', 'Acme Widget 3/4', 1, { [price]: '200.5' }), row('c', 'Zed bracket', 2), row('d', '  Spaced   out ', 3, { [price]: '10' })]
const tab = { id: 't1', categoryId: 'c1', name: 'Small' }

describe('Phase 239 search', () => {
  it('needs every word, ignores case, and returns the position in the full tab', () => {
    const h = searchTabRows(tab, rows, 'WIDGET 3/4')
    expect(h.map((x) => x.rowId)).toEqual(['b'])
    expect(h[0]!.rowIndex).toBe(1)
    expect(searchTabRows(tab, rows, 'widget').length).toBe(2)
  })
  it('finds a price and ignores a one-letter query', () => {
    expect(searchTabRows(tab, rows, '200.5').map((x) => x.rowId)).toEqual(['b'])
    expect(searchTabRows(tab, rows, 'a')).toEqual([])
  })
  it('puts name matches before cell-only matches', () => {
    const hits = [...searchTabRows(tab, rows, '10'), ...searchTabRows(tab, rows, 'zed')]
    const ranked = rankHits([...searchTabRows(tab, [row('x', 'Other', 0, { [price2]: 'zed price' })], 'zed'), ...searchTabRows(tab, rows, 'zed')], 'zed')
    expect(ranked[0]!.name).toBe('Zed bracket')
    expect(hits.length).toBeGreaterThan(0)
  })
  it('caps the number of hits', () => {
    const many = Array.from({ length: 300 }, (_, i) => row(`m${i}`, `Item ${i}`, i))
    expect(searchTabRows(tab, many, 'item').length).toBe(100)
  })
})

describe('Phase 239 duplicate warning', () => {
  it('flags the same item typed in another order', () => {
    expect(findDuplicates(rows, '1/2 widget acme', 'zzz').map((d) => d.rowId)).toEqual(['a'])
  })
  it('does not flag a different size, itself, or a blank name', () => {
    expect(findDuplicates(rows, 'Acme Widget 1/4', 'zzz')).toEqual([])
    expect(findDuplicates(rows, 'Acme Widget 1/2', 'a')).toEqual([])
    expect(findDuplicates(rows, '   ')).toEqual([])
  })
})

describe('Phase 239 bulk, clean-up and CSV through the existing pure modules', () => {
  it('adds a percent with decimal maths and skips empty cells', () => {
    const p = adjustPercent(rows, price, '10')
    expect(p.changes.map((c) => [c.rowId, c.after])).toEqual([['a', '110'], ['b', '220.55'], ['d', '11']])
    expect(p.skipped).toBe(1)
    expect(applyChanges(rows, p.changes)[0]!.cells[price]).toBe('110')
  })
  it('limits a bulk change to the chosen rows', () => {
    expect(adjustPercent(rows, price, '-10', { rowIds: new Set(['a']) }).changes.map((c) => c.rowId)).toEqual(['a'])
  })
  it('fills a column once from another and leaves filled cells alone', () => {
    const p = fillFromColumn(rows, price, price2, '5')
    expect(p.changes.map((c) => [c.rowId, c.after])).toEqual([['a', '105'], ['b', '210.53'], ['d', '10.5']])
    expect(fillFromColumn(applyChanges(rows, p.changes), price, price2, '50').changes).toEqual([])
  })
  it('tidies names and replaces literally', () => {
    expect(cleanNames(rows).map((c) => c.rowId)).toEqual(['d'])
    expect(findReplaceNames(rows, 'widget', 'Gadget').map((c) => c.rowId)).toEqual(['a', 'b'])
  })
  it('exports CSV with a header, quoting and a formula guard', () => {
    const csv = toCsv(cols, [row('q', '=SUM(A1), "x"', 0, { [price]: '5' })], { bom: true })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(`"'=SUM(A1), ""x"""`)
    expect(csv.endsWith('\r\n')).toBe(true)
  })
})
