import { describe, expect, it } from 'vitest'
import { parseSentence } from '../sentenceQuery'
import { chipSource, filterBills, isSentenceSearch, mergeRange, pickPartyText, rangeWords, removeChipText, replaceSpan, rerankIds, searchPlan } from '../sentenceSearch'
import type { BillListItem } from '../../history/historyList'

const TODAY = '2026-11-12'
const customers = [{ id: 'p1', name: 'Invented Traders' }, { id: 'p2', name: 'Sample Stores' }, { id: 'p3', name: 'Sample Sweets' }]
const bill = (id: string, party: string, date: string, total: string): BillListItem => ({ id, poNumber: id, poSeq: 1, billDate: date, partyName: party, grandTotal: total, branchId: 'b', revision: 1 })
const parse = (t: string) => parseSentence(t, { today: TODAY, customers })

describe('sentenceSearch (Phase 229)', () => {
  it('only a sentence with a structured part is a sentence search; plain words keep the old search', () => {
    expect(isSentenceSearch(parse('ruby tomato'))).toBe(false)
    expect(isSentenceSearch(parse(''))).toBe(false)
    expect(isSentenceSearch(parse('ruby tomato last month'))).toBe(true)
    expect(isSentenceSearch(parse('above 5000'))).toBe(true)
  })

  it('plans the fetch: item words, else the party name, else the lists; the History From / To box narrows the sentence range', () => {
    expect(searchPlan(parse('ruby tomato last month').query)).toMatchObject({ mode: 'text', text: 'ruby tomato', from: '2026-10-01', to: '2026-10-31' })
    expect(searchPlan(parse('for Invented Traders').query)).toMatchObject({ mode: 'party', text: 'Invented Traders' })
    expect(searchPlan(parse('above 5000').query)).toMatchObject({ mode: 'lists', text: '' })
    expect(searchPlan(parse('ruby last month').query, { from: '2026-10-15', to: '2026-12-31' })).toMatchObject({ from: '2026-10-15', to: '2026-10-31' })
    expect(mergeRange({}, {})).toEqual({})
    expect(mergeRange({ from: '2026-01-01' }, { to: '2026-02-01' })).toEqual({ from: '2026-01-01', to: '2026-02-01' })
  })

  it('filters by party, dates (inclusive), amount (strict) and format', () => {
    const bills = [
      bill('a', 'Invented Traders', '2026-10-01', '6000'), bill('b', 'invented  traders', '2026-10-31', '5000'),
      bill('c', 'Invented Traders', '2026-09-30', '9000'), bill('d', 'Sample Stores', '2026-10-10', '9000'), bill('e', 'Invented Traders', '2026-10-15', '')
    ]
    const q = parse('for Invented Traders last month above 5000').query
    expect(filterBills(bills, q).map((b) => b.id)).toEqual(['a'])
    expect(filterBills(bills, parse('under 6000').query).map((b) => b.id)).toEqual(['b'])
    const gst = parse('gst last month').query
    const fmt = (id: string) => (id === 'a' ? 'gst' as const : id === 'b' ? 'nongst' as const : undefined)
    expect(filterBills(bills, gst, fmt).map((b) => b.id)).toEqual(['a', 'd', 'e']) // unknown format is kept, never hidden by a guess
    expect(filterBills(bills, gst).map((b) => b.id)).toEqual(['a', 'b', 'd', 'e']) // no format answer at all: nothing filtered by format
  })

  it('an ambiguous party keeps every candidate until the owner picks one', () => {
    const p = parse('for Sample')
    expect(p.query.party?.candidates?.length).toBeGreaterThan(1)
    const bills = [bill('x', 'Sample Stores', '2026-10-01', '1'), bill('y', 'Sample Sweets', '2026-10-01', '1'), bill('z', 'Invented Traders', '2026-10-01', '1')]
    expect(filterBills(bills, p.query).map((b) => b.id)).toEqual(['x', 'y'])
  })

  it('editing a chip rewrites the sentence and the parser reads it back', () => {
    const text = 'ruby tomato for Invented Traders last month above 5000'
    const p = parse(text)
    const date = p.chips.find((c) => c.kind === 'date')!
    const amount = p.chips.find((c) => c.kind === 'amount')!
    expect(chipSource(text, date)).toBe('last month')
    const noDate = removeChipText(text, date)
    expect(noDate).toBe('ruby tomato for Invented Traders above 5000')
    expect(parse(noDate).query.dateRange).toBeUndefined()
    expect(parse(noDate).query.party?.id).toBe('p1')
    const edited = replaceSpan(text, amount, 'under 100')
    expect(parse(edited).query.amount).toEqual({ op: 'lt', value: '100' })
    expect(parse(replaceSpan(text, date, rangeWords('2026-10-01', '2026-10-15'))).query.dateRange).toEqual({ from: '2026-10-01', to: '2026-10-15' })
    expect(rangeWords('2026-10-05', '2026-10-05')).toBe('05/10/2026')
    expect(replaceSpan(text, { span: { start: 5, end: 999 } }, 'x')).toBe(text) // a bad span never corrupts the text
  })

  it('picking a party choice rewrites the party words to that customer', () => {
    const text = 'ruby for Sample'
    const chip = parse(text).chips.find((c) => c.kind === 'party')!
    const picked = pickPartyText(text, chip, 'Sample Sweets')
    expect(parse(picked).query.party).toMatchObject({ id: 'p3' })
    expect(parse(picked).query.party?.candidates).toBeUndefined()
  })

  it('re-rank is a pure permutation: the identity without scores, a strong score lifts a bill, ties keep the order', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(rerankIds(ids, {})).toEqual(ids)
    expect(rerankIds(ids, { d: 1 })).toEqual(['d', 'a', 'b', 'c'])
    expect(rerankIds(ids, { c: 0.2 })).toEqual(['a', 'b', 'c', 'd'])
    expect(rerankIds(ids, { a: 1, b: 1, c: 1, d: 1 })).toEqual(ids)
    const out = rerankIds(ids, { c: Number.NaN, d: 5, zz: 1 })
    expect([...out].sort()).toEqual([...ids].sort())
    expect(rerankIds(['only'], { only: 1 })).toEqual(['only'])
  })
})
