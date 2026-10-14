import { describe, expect, it } from 'vitest'
import { createEmptyBill, deserializeBill, normalizeBill, serializeBill } from '../../billModel'
import { diffBills } from '../../diff/billDiff'
import { sameContent } from '../../sync/conflict'
import {
  canHybrid, computeHybrid, describeHybrid, detachTwinsOf, enterHybrid, isHybrid, isHybridActive, leaveHybrid, makeSecondTable, otherSide,
  primarySide, pruneTwins, recopyTable, setSharedExtra, sideOfRow, tableRows
} from '../hybrid'
import type { Bill, BillRow } from '../../types'

let n = 0
const newId = (): string => `id${++n}`

function row(id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow {
  return { id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra }
}
const adj = (id: string, name: string, amount: string): BillRow => row(id, name, null, null, { totalOverride: amount })

function bill(formatId: 'gst' | 'non_gst', rows: BillRow[], over: Partial<Bill> = {}): Bill {
  const b = createEmptyBill({ branchId: 'br1', formatId, rowCount: 0, newId, now: '2026-10-14T10:00:00.000Z' })
  return { ...b, extraCols: [{ key: 'c1', header: 'Units', kind: 'units' }], rows: rows.map((r, i) => ({ ...r, idx: i })), ...over }
}
const gstBill = (): Bill => bill('gst', [
  row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }),
  row('p2', 'Elbow', '3', '10', { gstRate: '12' }),
  adj('p3', 'Discount', '-10')
])
const nonGstBill = (): Bill => bill('non_gst', [
  row('p1', 'Pipe', '2', '50', { extras: { c1: { text: '5 box' } } }),
  row('p2', 'Elbow', '3', '10'),
  adj('p3', 'Discount', '-10')
])

describe('Phase 150 - makeSecondTable (copy rules 2, 3, 6)', () => {
  it('GST bill -> non-GST second table: names, qty, rate copied as new rows; GST % and the adjustment are not', () => {
    const b = gstBill()
    const s = makeSecondTable(b, newId)!
    expect(s.primary).toBe('gst')
    expect(s.active).toBe(false)
    expect(s.rows).toHaveLength(2)
    expect(s.rows.map((r) => r.nameRuns[0]?.t)).toEqual(['Pipe', 'Elbow'])
    expect(s.rows.map((r) => [r.qty, r.rate, r.gstRate])).toEqual([['2', '50', null], ['3', '10', null]])
    expect(s.rows.some((r) => ['p1', 'p2', 'p3'].includes(r.id))).toBe(false)
    expect(Object.values(s.twins).sort()).toEqual(['p1', 'p2'])
  })
  it('non-GST bill -> GST second table: the same the other way round', () => {
    const s = makeSecondTable(nonGstBill(), newId)!
    expect(s.primary).toBe('non_gst')
    expect(s.rows.map((r) => r.nameRuns[0]?.t)).toEqual(['Pipe', 'Elbow'])
    expect(otherSide(s.primary)).toBe('gst')
  })
  it('a total override and highlights are copied, trailing blank rows are not, the input is never mutated', () => {
    const b = bill('non_gst', [row('a', 'X', '1', '5', { totalOverride: '7', cellStyle: { name: { hl: 1 } } }), row('b', '', null, null)])
    const before = JSON.stringify(b)
    const s = makeSecondTable(b, newId)!
    expect(JSON.stringify(b)).toBe(before)
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0]).toMatchObject({ totalOverride: '7', cellStyle: { name: { hl: 1 } } })
  })
  it('Stock transfer (or any non GST / non-GST bill) cannot be Hybrid', () => {
    const st = createEmptyBill({ branchId: 'b', formatId: 'stock_transfer', newId })
    expect(canHybrid(st)).toBe(false)
    expect(makeSecondTable(st, newId)).toBeNull()
    expect(enterHybrid(st, newId)).toEqual({ bill: st, created: false })
  })
})

describe('Phase 150 - separate calculations and independence (rules 4, 5, 6)', () => {
  it('each table has its own totals', () => {
    const { bill: h } = enterHybrid(gstBill(), newId)
    const t = computeHybrid(h)!
    expect(t.primarySide).toBe('gst')
    expect(t.secondSide).toBe('non_gst')
    // GST side: 2x50 + 18% = 118, 3x10 + 12% = 33.60, adjustment -10
    expect(t.primary.itemsAmount).toBe('151.60')
    expect(t.primary.grandTotal).toBe('141.60')
    // non-GST copy: 100 + 30, no adjustment copied
    expect(t.second.itemsTotal).toBe('130.00')
    expect(t.second.adjustmentsTotal).toBe('0.00')
    expect(t.second.grandTotal).toBe('130.00')
  })
  it('editing an item name / qty / rate on one side never changes the other', () => {
    const { bill: h } = enterHybrid(gstBill(), newId)
    const second = h.hybrid!.rows
    const edited: Bill = { ...h, hybrid: { ...h.hybrid!, rows: second.map((r, i) => (i === 0 ? { ...r, qty: '9', nameRuns: [{ t: 'Changed' }], rate: '1' } : r)) } }
    expect(edited.rows[0]).toEqual(h.rows[0])
    const prim: Bill = { ...h, rows: h.rows.map((r, i) => (i === 1 ? { ...r, qty: '99' } : r)) }
    expect(prim.hybrid!.rows).toEqual(h.hybrid!.rows)
    expect(computeHybrid(edited)!.second.itemsTotal).toBe('39.00')
    expect(computeHybrid(edited)!.primary.grandTotal).toBe('141.60')
  })
  it('adjustments are separate per side', () => {
    const { bill: h } = enterHybrid(nonGstBill(), newId)
    const withSecondAdj: Bill = { ...h, hybrid: { ...h.hybrid!, rows: [...h.hybrid!.rows, adj('s-adj', 'Freight', '25')] } }
    const t = computeHybrid(withSecondAdj)!
    expect(t.primary.adjustmentsTotal).toBe('-10.00')
    expect(t.second.adjustmentsTotal).toBe('25.00')
    expect(t.primary.grandTotal).toBe('120.00')
    expect(t.second.grandTotal).toBe('155.00')
  })
  it('round off applies to each grand total on its own', () => {
    const b = bill('non_gst', [row('a', 'X', '1', '10.40')], { roundOff: 1 })
    const { bill: h } = enterHybrid(b, newId)
    const t = computeHybrid({ ...h, hybrid: { ...h.hybrid!, rows: [{ ...h.hybrid!.rows[0]!, rate: '10.60' }] } })!
    expect(t.primary.grandTotal).toBe('10.00')
    expect(t.second.grandTotal).toBe('11.00')
  })
  it('a bill without a second table has no hybrid totals', () => {
    expect(computeHybrid(gstBill())).toBeNull()
  })
})

describe('Phase 150 - switching in and out (rules 1, 10, 11)', () => {
  it('Alt+3 creates the second table once and turns the view on', () => {
    const r = enterHybrid(nonGstBill(), newId)
    expect(r.created).toBe(true)
    expect(isHybrid(r.bill)).toBe(true)
    expect(isHybridActive(r.bill)).toBe(true)
    expect(r.bill.formatId).toBe('non_gst')
  })
  it('a second Alt+3 never overwrites an existing second table', () => {
    const first = enterHybrid(nonGstBill(), newId).bill
    const edited: Bill = { ...first, hybrid: { ...first.hybrid!, rows: first.hybrid!.rows.map((r) => ({ ...r, rate: '777' })) } }
    const left = leaveHybrid(edited)
    expect(isHybridActive(left)).toBe(false)
    const again = enterHybrid({ ...left, rows: left.rows.map((r) => ({ ...r, qty: '5' })) }, newId)
    expect(again.created).toBe(false)
    expect(again.bill.hybrid!.rows.every((r) => r.rate === '777')).toBe(true)
    expect(again.bill.hybrid!.rows.map((r) => r.qty)).toEqual(['2', '3'])
  })
  it('leaving keeps the second table; Alt+1 / Alt+2 only switch the primary layout', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const left = leaveHybrid(h, 'non_gst')
    expect(left.formatId).toBe('non_gst')
    expect(left.rows).toBe(h.rows)
    expect(left.hybrid!.rows).toBe(h.hybrid!.rows)
    expect(left.hybrid!.primary).toBe('gst')
    // coming back puts the primary rows in their own layout again
    expect(enterHybrid(left, newId).bill.formatId).toBe('gst')
  })
  it('leaving a bill that has no second table is the plain format switch', () => {
    expect(leaveHybrid(gstBill(), 'non_gst').formatId).toBe('non_gst')
    const b = gstBill()
    expect(leaveHybrid(b)).toBe(b)
  })
  it('recopy replaces only the chosen table, keeps that table\'s own adjustments', () => {
    const h0 = enterHybrid(nonGstBill(), newId).bill
    const h: Bill = { ...h0, hybrid: { ...h0.hybrid!, rows: [...h0.hybrid!.rows.map((r) => ({ ...r, rate: '1' })), adj('s-adj', 'Freight', '25')] } }
    const second = recopyTable(h, 'gst', newId)
    expect(second.rows).toBe(h.rows)
    expect(second.hybrid!.rows.map((r) => r.rate)).toEqual(['50', '10', null])
    expect(second.hybrid!.rows[2]).toMatchObject({ id: 's-adj', totalOverride: '25' })
    const prim = recopyTable(h, 'non_gst', newId)
    expect(prim.rows.map((r) => r.rate)).toEqual(['1', '1', null])
    expect(prim.rows[2]).toMatchObject({ id: 'p3', totalOverride: '-10' })
    expect(prim.hybrid!.rows).toHaveLength(3)
    const plain = gstBill()
    expect(recopyTable(plain, 'gst', newId)).toBe(plain)
  })
})

describe('Phase 150 - shared extra columns (rule 7)', () => {
  it('a copied row shows the primary row\'s extra cell; the cell is not duplicated', () => {
    const h = enterHybrid(gstBill(), newId).bill
    expect(h.hybrid!.rows[0]!.extras).toEqual({})
    expect(tableRows(h, 'non_gst')[0]!.extras).toEqual({ c1: { text: '5 box' } })
    expect(tableRows(h, 'gst')).toBe(h.rows)
  })
  it('editing the shared cell from either side shows on both', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const secondId = h.hybrid!.rows[0]!.id
    const fromSecond = setSharedExtra(h, secondId, 'c1', { text: '8 box', marked: true })
    expect(fromSecond.rows[0]!.extras.c1).toEqual({ text: '8 box', marked: true })
    expect(tableRows(fromSecond, 'non_gst')[0]!.extras.c1).toEqual({ text: '8 box', marked: true })
    const fromPrimary = setSharedExtra(fromSecond, 'p1', 'c1', null)
    expect(tableRows(fromPrimary, 'non_gst')[0]!.extras).toEqual({})
  })
  it('a row added on the second table keeps its own cells', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const added: Bill = { ...h, hybrid: { ...h.hybrid!, rows: [...h.hybrid!.rows, row('s-new', 'Extra', '1', '1')] } }
    const w = setSharedExtra(added, 's-new', 'c1', { text: 'x' })
    expect(w.hybrid!.rows[2]!.extras.c1).toEqual({ text: 'x' })
    expect(w.rows.every((r) => r.extras.c1?.text !== 'x')).toBe(true)
  })
  it('deleting a primary row first detaches its twin, so no cell is lost', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const d = detachTwinsOf(h, ['p1'])
    const after: Bill = { ...d, rows: d.rows.filter((r) => r.id !== 'p1') }
    expect(tableRows(after, 'non_gst')[0]!.extras).toEqual({ c1: { text: '5 box' } })
    expect(Object.values(after.hybrid!.twins)).toEqual(['p2'])
    const orphan: Bill = { ...h, rows: h.rows.filter((r) => r.id !== 'p2') }
    expect(Object.values(pruneTwins(orphan).hybrid!.twins)).toEqual(['p1'])
  })
  it('sideOfRow says which table a row is on', () => {
    const h = enterHybrid(gstBill(), newId).bill
    expect(sideOfRow(h, 'p1')).toBe('gst')
    expect(sideOfRow(h, h.hybrid!.rows[0]!.id)).toBe('non_gst')
    expect(sideOfRow(h, 'nope')).toBeNull()
    expect(primarySide(h)).toBe('gst')
  })
})

describe('Phase 150 - normalize, serialize, deserialize', () => {
  it('round trip keeps both tables, the pairing and the view flag', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const ser = serializeBill(h)
    expect(JSON.parse(ser.bill.secondTableJson!)).toMatchObject({ v: 1, primary: 'gst', active: true })
    const back = deserializeBill(ser.bill, ser.rows)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.data.hybrid).toEqual(normalizeBill(h).hybrid)
    expect(back.data.rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3'])
    expect(computeHybrid(back.data)!.second.grandTotal).toBe('130.00')
  })
  it('the primary table alone feeds bill_rows, the totals cache and the item count (no double counting)', () => {
    const base = gstBill()
    const h = enterHybrid(base, newId).bill
    const ser = serializeBill(h)
    const plain = serializeBill(base)
    expect(ser.rows).toEqual(plain.rows)
    expect(ser.bill.totalsJson).toBe(plain.bill.totalsJson)
    expect(ser.bill.itemRowCount).toBe(plain.bill.itemRowCount)
    expect(ser.bill.secondTableJson).not.toBe('')
  })
  it('a bill with no second table stores an empty string and reads back without one', () => {
    const ser = serializeBill(gstBill())
    expect(ser.bill.secondTableJson).toBe('')
    const back = deserializeBill(ser.bill, ser.rows)
    expect(back.ok && back.data.hybrid).toBeFalsy()
    const old = { ...ser.bill }
    delete old.secondTableJson
    expect(deserializeBill(old, ser.rows).ok).toBe(true)
  })
  it('junk second-table JSON is refused, not guessed', () => {
    const ser = serializeBill(enterHybrid(gstBill(), newId).bill)
    expect(deserializeBill({ ...ser.bill, secondTableJson: '{nope' }, ser.rows).ok).toBe(false)
    expect(deserializeBill({ ...ser.bill, secondTableJson: JSON.stringify({ v: 2 }) }, ser.rows).ok).toBe(false)
  })
  it('normalize repairs ids that clash with the primary rows, prunes twins, and is idempotent', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const broken: Bill = {
      ...h,
      hybrid: { ...h.hybrid!, rows: [{ ...h.hybrid!.rows[0]!, id: 'p1', qty: ' 4. ' }, h.hybrid!.rows[1]!], twins: { ...h.hybrid!.twins, ghost: 'p2', [h.hybrid!.rows[1]!.id]: 'missing' } }
    }
    const fixed = normalizeBill(broken, newId)
    const ids = [...fixed.rows.map((r) => r.id), ...fixed.hybrid!.rows.map((r) => r.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(fixed.hybrid!.rows[0]!.qty).toBe('4')
    expect(Object.keys(fixed.hybrid!.twins).includes('ghost')).toBe(false)
    expect(Object.values(fixed.hybrid!.twins).includes('missing')).toBe(false)
    expect(normalizeBill(fixed, newId)).toEqual(fixed)
  })
  it('an unknown primary side drops the second table; the view forces formatId = primary', () => {
    const h = enterHybrid(gstBill(), newId).bill
    expect(normalizeBill({ ...h, hybrid: { ...h.hybrid!, primary: 'x' as never } }, newId).hybrid).toBeUndefined()
    expect(normalizeBill({ ...h, formatId: 'non_gst' }, newId).formatId).toBe('gst')
    const off = leaveHybrid(h)
    expect(normalizeBill({ ...off, formatId: 'non_gst' }, newId).formatId).toBe('non_gst')
  })
  it('a text qty in a copied row survives (Stock transfer rule is untouched)', () => {
    const b = bill('non_gst', [row('a', 'X', '1', '5')])
    const h = enterHybrid(b, newId).bill
    expect(normalizeBill(h, newId).hybrid!.rows[0]!.qty).toBe('1')
  })
})

describe('Phase 150 - sync content, diff, description', () => {
  it('sameContent sees a second-table edit', () => {
    const h = enterHybrid(gstBill(), newId).bill
    const a = serializeBill(h)
    const edited: Bill = { ...h, hybrid: { ...h.hybrid!, rows: h.hybrid!.rows.map((r, i) => (i === 0 ? { ...r, rate: '51' } : r)) } }
    const b = serializeBill(edited)
    expect(sameContent(a, a)).toBe(true)
    expect(sameContent(a, b)).toBe(false)
    expect(sameContent(serializeBill(gstBill()), a)).toBe(false)
  })
  it('diffBills reports the second table as one bill-level change', () => {
    const plain = gstBill()
    const h = enterHybrid(plain, newId).bill
    const d = diffBills(plain, h)
    expect(d.bill.some((c) => c.field === 'hybrid')).toBe(true)
    expect(d.rows).toHaveLength(0)
    const edited: Bill = { ...h, hybrid: { ...h.hybrid!, rows: h.hybrid!.rows.map((r, i) => (i === 0 ? { ...r, qty: '9' } : r)) } }
    expect(diffBills(h, edited).bill.some((c) => c.field === 'hybrid')).toBe(true)
    expect(diffBills(h, h).identical).toBe(true)
  })
  it('describeHybrid', () => {
    expect(describeHybrid(undefined)).toBe('none')
    expect(describeHybrid(enterHybrid(gstBill(), newId).bill.hybrid)).toBe('GST + Non-GST (2 rows on the second table), view on')
  })
})
