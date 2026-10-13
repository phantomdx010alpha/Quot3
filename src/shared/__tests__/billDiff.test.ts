import { describe, expect, it } from 'vitest'
import { describeDiff, diffBills, sameNumber } from '../diff/billDiff'
import { previousRevision } from '../revisions'
import { blankRow, row } from '../__fixtures__/bills'
import type { Bill, BillRow } from '../types'

const bill = (rows: BillRow[], over: Partial<Bill> = {}): Bill => ({
  id: 'b1', branchId: 'local', poSeq: 1, poNumber: 'Q3-0001', partyId: null,
  party: { name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' },
  formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-08', rows: rows.map((r, i) => ({ ...r, idx: i })),
  revision: 1, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z', deletedAt: null, syncState: 'local_only', ...over
})
const withId = (id: string, r: BillRow): BillRow => ({ ...r, id })

describe('diffBills', () => {
  const a = withId('r1', row('Pen', '10', '9'))
  const b = withId('r2', row('Book', '2', '45.50'))

  it('identical bills (trailing blank padding ignored)', () => {
    const d = diffBills(bill([a, b]), bill([a, b, withId('x', blankRow()), withId('y', blankRow())]))
    expect(d.identical).toBe(true)
    expect(d.rows).toEqual([])
    expect(describeDiff(d)).toBe('No changes')
  })

  it('added row', () => {
    const c = withId('r3', row('Ink', '1', '5'))
    const d = diffBills(bill([a, b]), bill([a, b, c]))
    expect(d.identical).toBe(false)
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ kind: 'added', rowId: 'r3', beforeNo: null, afterNo: 3, name: 'Ink' })
    expect(d.counts).toEqual({ added: 1, removed: 0, changed: 0, moved: 0 })
  })

  it('removed row (later rows are not reported as moved)', () => {
    const c = withId('r3', row('Ink', '1', '5'))
    const d = diffBills(bill([a, b, c]), bill([a, c]))
    expect(d.rows).toHaveLength(1)
    expect(d.rows[0]).toMatchObject({ kind: 'removed', rowId: 'r2', beforeNo: 2, afterNo: null, name: 'Book' })
  })

  it('changed row: qty, rate, name, total override, gst - decimals compare by value', () => {
    const a2 = withId('r1', row('Pen blue', '12', '9.00', { total: '120', gst: '18' }))
    const d = diffBills(bill([a, b]), bill([a2, b]))
    expect(d.rows).toHaveLength(1)
    const r = d.rows[0]!
    expect(r.kind).toBe('changed')
    expect(r.changes.map((c) => c.field)).toEqual(['name', 'qty', 'total', 'gstRate'])
    expect(r.changes.find((c) => c.field === 'qty')).toMatchObject({ before: '10', after: '12' })
    // "9" vs "9.00" is NOT a change
    expect(r.changes.some((c) => c.field === 'rate')).toBe(false)
  })

  it('formatting-only change of the item name', () => {
    const a2: BillRow = { ...a, nameRuns: [{ t: 'Pen', b: 1 }] }
    const d = diffBills(bill([a]), bill([a2]))
    expect(d.rows[0]!.changes).toEqual([expect.objectContaining({ field: 'nameStyle' })])
  })

  it('moved row (same content, different order)', () => {
    const d = diffBills(bill([a, b]), bill([b, a]))
    expect(d.rows.every((r) => r.kind === 'moved')).toBe(true)
    expect(d.counts.moved).toBeGreaterThan(0)
  })

  it('extra column: added / removed / renamed, and a cell or mark change', () => {
    const colA = { key: 'c1', header: 'ruby', kind: 'units' as const }
    const base = bill([{ ...a, extras: { c1: { text: '(125-5)' } } }], { extraCols: [colA] })
    const next = bill([{ ...a, extras: { c1: { text: '(125-6)', marked: true } } }], { extraCols: [{ ...colA, header: 'amber' }, { key: 'c2', header: 'new', kind: 'units' }] })
    const d = diffBills(base, next)
    expect(d.extraCols.map((c) => c.label)).toEqual(['Extra column renamed', 'Extra column added'])
    const ch = d.rows[0]!.changes
    expect(ch).toContainEqual(expect.objectContaining({ field: 'extra:c1', before: '(125-5)', after: '(125-6)', label: 'amber' }))
    expect(ch).toContainEqual(expect.objectContaining({ field: 'mark:c1', before: 'not marked', after: 'marked' }))
    const gone = diffBills(next, bill([a], { extraCols: [] }))
    expect(gone.extraCols.map((c) => c.label)).toEqual(['Extra column removed', 'Extra column removed'])
  })

  it('party change', () => {
    const d = diffBills(bill([a]), bill([a], { party: { name: 'Ruby Traders Pvt', phone: '98450 11001', address: '2 Main Rd', transport: 'VRL' } }))
    expect(d.party.map((c) => c.field)).toEqual(['party.name', 'party.address'])
    expect(d.party[0]).toMatchObject({ before: 'Ruby Traders', after: 'Ruby Traders Pvt', label: 'Party name' })
    expect(describeDiff(d)).toBe('party')
  })

  it('format, date and paper change (rows untouched)', () => {
    const d = diffBills(bill([a]), bill([a], { formatId: 'gst', billDate: '2026-10-09', paperOverride: 'A4' }))
    expect(d.bill.map((c) => c.field)).toEqual(['billDate', 'formatId', 'paperOverride'])
    expect(d.bill[1]).toMatchObject({ before: 'Non-GST', after: 'GST' })
    expect(d.rows).toEqual([])
    expect(d.bill[2]).toMatchObject({ before: 'Automatic', after: 'A4' })
  })

  it('describeDiff summarises rows and the other parts', () => {
    const c = withId('r3', row('Ink', '1', '5'))
    const d = diffBills(bill([a, b]), bill([withId('r1', row('Pen', '11', '9')), c], { party: { name: 'X', phone: '', address: '', transport: '' } }))
    expect(describeDiff(d)).toBe('1 changed, 1 added, 1 removed rows - party')
  })

  it('never mutates its inputs', () => {
    const o = bill([a, b])
    const n = bill([b])
    const snap = JSON.stringify([o, n])
    diffBills(o, n)
    expect(JSON.stringify([o, n])).toBe(snap)
  })
})

describe('sameNumber / previousRevision', () => {
  it('compares by value, null and blank are equal', () => {
    expect(sameNumber('1.0', '1')).toBe(true)
    expect(sameNumber('1', '2')).toBe(false)
    expect(sameNumber(null, '')).toBe(true)
    expect(sameNumber(null, '0')).toBe(false)
  })
  it('previousRevision skips gaps and returns null for the oldest', () => {
    const l = [{ revision: 9 }, { revision: 7 }, { revision: 3 }]
    expect(previousRevision(l, 9)).toBe(7)
    expect(previousRevision(l, 7)).toBe(3)
    expect(previousRevision(l, 3)).toBeNull()
  })
})
