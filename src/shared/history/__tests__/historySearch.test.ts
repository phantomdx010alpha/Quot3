import { describe, expect, it } from 'vitest'
import { rankBills, searchTokens, type SearchCandidate } from '../historySearch'
import { effectiveTargets, historyRowsToTsv, rangeIds, describeBills } from '../historyList'

const c = (n: number, party: string, total: string, itemText = '', date = '2026-10-06'): SearchCandidate => ({
  id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: date, partyName: party, grandTotal: total, branchId: 'local', revision: 1, itemText
})
const ids = (q: string, list: SearchCandidate[], limit?: number): string[] => rankBills(list, q, limit).hits.map((h) => h.id)

const data = [
  c(9, 'Ms Smart Bums', '7150', 'Cotton shirt blue'),
  c(8, 'Lakshmi Cloth Center', '6350', 'Silk saree red'),
  c(7, 'Zakers Clothing', '1250.50', 'Denim jeans'),
  c(6, 'Brothers Thread House- THALASSERY', '1234567.5', 'Thread 40s'),
  c(5, 'Smart Traders', '980', 'Pen box'),
  c(12, 'Ruby Traders', '5000', 'Notebook')
]

describe('rankBills', () => {
  it('a blank query matches nothing; words are split and lower-cased', () => {
    expect(rankBills(data, '   ').hits).toEqual([])
    expect(searchTokens('  Smart   BUMS ')).toEqual(['smart', 'bums'])
  })

  it('PO number: exact beats prefix beats contains; a bare number matches the sequence', () => {
    expect(ids('q3-0007', data)).toEqual(['b7'])
    expect(ids('12', data)[0]).toBe('b12') // sequence 12 outranks a stray substring
    expect(ids('q3-000', data)).toHaveLength(5) // prefix of every single-digit PO; Q3-0012 only contains "q3-00"
  })

  it('party: exact > prefix > word-start > contains; ties keep the newest-first order of the input', () => {
    expect(ids('smart', data)).toEqual(['b5', 'b9']) // name prefix (Smart Traders) outranks a later word (Ms Smart Bums)
    expect(ids('smart', [c(1, 'Smart A', '1'), c(2, 'Smart B', '1')])).toEqual(['b1', 'b2']) // equal scores keep the input (newest first) order
    expect(ids('traders', data)).toEqual(['b5', 'b12'])
    expect(ids('thread', data)[0]).toBe('b6')
  })

  it('party typos are matched fuzzily, but only after literal matches', () => {
    expect(ids('lakshmy', data)).toEqual(['b8'])
    expect(ids('smert', data)).toContain('b9')
    expect(ids('qqqq', data)).toEqual([])
  })

  it('item text via name_plain (word start outranks inside a word)', () => {
    expect(ids('denim', data)).toEqual(['b7'])
    expect(ids('hirt', data)).toEqual(['b9'])
    const r = rankBills([c(1, 'A', '1', 'tshirt'), c(2, 'B', '1', 'shirt')], 'shirt')
    expect(r.hits.map((h) => h.id)).toEqual(['b2', 'b1'])
    expect(r.hits[0]!.matchedOn).toEqual(['item'])
  })

  it('amount: exact value (₹ and commas ignored) or the whole-rupee part', () => {
    expect(ids('7150', data)).toEqual(['b9'])
    expect(ids('₹1,250.50', data)).toEqual(['b7'])
    expect(ids('1250', data)).toEqual(['b7']) // 1250.50 truncated
    expect(ids('1250.5', data)).toEqual(['b7'])
    expect(ids('12345', data)).toEqual([]) // never a prefix match
    expect(rankBills(data, '7150').hits[0]!.matchedOn).toContain('amount')
  })

  it('every word must match: "smart traders" -> only the bill that has both', () => {
    expect(ids('smart traders', data)).toEqual(['b5'])
    expect(ids('ruby 5000', data)).toEqual(['b12'])
    expect(ids('ruby 7150', data)).toEqual([])
  })

  it('limit caps the result and reports truncation; the cap is clamped to 1..1000', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(i + 1, 'Smart Party', '1'))
    const r = rankBills(many, 'smart', 10)
    expect(r.hits).toHaveLength(10)
    expect(r.truncated).toBe(true)
    expect(rankBills(many, 'smart', 0).hits).toHaveLength(1)
    expect(rankBills(many, 'smart').truncated).toBe(false)
  })

  it('hits never carry the item text', () => {
    expect('itemText' in rankBills(data, 'smart').hits[0]!).toBe(false)
  })
})

describe('selection + export helpers', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  it('rangeIds is inclusive, order-independent, and tolerant of unknown ids', () => {
    expect(rangeIds(list, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(list, 'd', 'b')).toEqual(['b', 'c', 'd'])
    expect(rangeIds(list, null, 'c')).toEqual(['c'])
    expect(rangeIds(list, 'zz', 'c')).toEqual(['c'])
    expect(rangeIds(list, 'a', 'zz')).toEqual([])
  })
  it('effectiveTargets prefers the selection', () => {
    expect(effectiveTargets(['a', 'b'], 'c')).toEqual(['a', 'b'])
    expect(effectiveTargets([], 'c')).toEqual(['c'])
    expect(effectiveTargets([], null)).toEqual([])
  })
  it('historyRowsToTsv: header + DD-MM-YY + plain totals, quoting tabs/quotes/newlines', () => {
    const tsv = historyRowsToTsv([c(1, 'Ruby "R" Traders', '1250.50'), c(2, 'Tab\tName', '9')])
    expect(tsv.split('\r\n')).toEqual(['Bill No\tDate\tParty\tTotal', 'Q3-0001\t06-10-26\t"Ruby ""R"" Traders"\t1250.50', 'Q3-0002\t06-10-26\t"Tab\tName"\t9'])
  })
  it('describeBills', () => {
    expect(describeBills([{ poNumber: 'Q3-0001', partyName: 'Ruby' }])).toBe('bill Q3-0001 (Ruby)')
    expect(describeBills([{ poNumber: 'Q3-0001', partyName: '' }])).toBe('bill Q3-0001')
    expect(describeBills([{ poNumber: 'a', partyName: '' }, { poNumber: 'b', partyName: '' }])).toBe('2 bills')
  })
})
