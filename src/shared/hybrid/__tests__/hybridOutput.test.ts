import { describe, expect, it } from 'vitest'
import { createEmptyBill } from '../../billModel'
import { billToRows, billToTsv } from '../../tsv/billTsv'
import type { Bill, BillRow } from '../../types'
import { enterHybrid, leaveHybrid } from '../hybrid'
import { billForSide, needsSidePick, sideLabel, sidePickKey, sidePickTitle } from '../hybridOutput'

const row = (id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

/** GST primary (Pipe, Elbow) + a second non-GST table whose items were renamed NG-... so the two sides are told apart in any output. */
function hybridBill(): Bill {
  const base: Bill = {
    ...createEmptyBill({ branchId: 'b', formatId: 'gst', rowCount: 0 }),
    party: { name: 'Ruby', phone: '', address: '', transport: '' },
    extraCols: [{ key: 'c1', header: 'Units', kind: 'units' }],
    rows: [row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }), row('p2', 'Elbow', '3', '10', { gstRate: '12' })].map((r, i) => ({ ...r, idx: i })),
    footerExtras: { finalTotal: { c1: { text: 'foot' } } } as Bill['footerExtras'],
    tailRows: [{ extras: { c1: { text: 'tail' } } }] as Bill['tailRows']
  }
  let n = 0
  const { bill } = enterHybrid(base, () => `n${++n}`)
  const h = bill.hybrid!
  return { ...bill, hybrid: { ...h, rows: h.rows.map((r) => ({ ...r, nameRuns: [{ t: `NG-${r.nameRuns.map((x) => x.t).join('')}` }] })) } }
}
const names = (rows: readonly BillRow[]): string[] => rows.filter((r) => r.nameRuns.length > 0).map((r) => r.nameRuns.map((x) => x.t).join(''))

describe('Phase 152 - Hybrid output: which side', () => {
  it('asks only while the Hybrid view is on', () => {
    const b = hybridBill()
    expect(needsSidePick(b)).toBe(true)
    expect(needsSidePick(leaveHybrid(b))).toBe(false) // second table kept, view off: outputs the primary table as today
    expect(needsSidePick({})).toBe(false)
  })

  it('GST side = a normal GST bill with the primary rows only', () => {
    const out = billForSide(hybridBill(), 'gst')
    expect(out.hybrid).toBeUndefined()
    expect(out.formatId).toBe('gst')
    expect(names(out.rows)).toEqual(['Pipe', 'Elbow'])
    expect(out.tailRows?.length).toBe(1)
  })

  it('non-GST side = a normal non-GST bill with the second table only, shared extra cells, no tail rows', () => {
    const b = hybridBill()
    const out = billForSide(b, 'non_gst')
    expect(out.hybrid).toBeUndefined()
    expect(out.formatId).toBe('non_gst')
    expect(names(out.rows)).toEqual(['NG-Pipe', 'NG-Elbow'])
    expect(out.rows[0]!.extras['c1']?.text).toBe('5 box') // shared extra column
    expect(out.tailRows).toBeUndefined()
    expect(out.footerExtras).toEqual(b.footerExtras)
    expect(out.party.name).toBe('Ruby')
  })

  it('works when the bill was started non-GST (primary = non-GST)', () => {
    const base = { ...createEmptyBill({ branchId: 'b', formatId: 'non_gst', rowCount: 0 }), rows: [row('a', 'Cup', '1', '5')] }
    const { bill } = enterHybrid(base, () => 'x1')
    expect(billForSide(bill, 'non_gst').formatId).toBe('non_gst')
    expect(billForSide(bill, 'gst').formatId).toBe('gst')
    expect(names(billForSide(bill, 'gst').rows)).toEqual(['Cup'])
  })

  it('a bill without a second table is returned unchanged', () => {
    const plain = { ...createEmptyBill({ branchId: 'b', rowCount: 0 }) }
    expect(billForSide(plain, 'gst')).toBe(plain)
  })

  it('text (TSV) output of a side contains nothing of the other side', () => {
    const b = hybridBill()
    const gst = JSON.stringify(billToRows(billForSide(b, 'gst')))
    const ng = JSON.stringify(billToRows(billForSide(b, 'non_gst')))
    expect(gst.includes('Pipe')).toBe(true)
    expect(gst.includes('NG-')).toBe(false)
    expect(ng.includes('NG-Pipe')).toBe(true)
    expect(ng.includes('"Elbow"')).toBe(false)
    expect(billToTsv(billForSide(b, 'non_gst')).text.includes('5 box')).toBe(true) // shared extra column printed on both
    expect(billToTsv(billForSide(b, 'gst')).text.includes('5 box')).toBe(true)
  })

  it('keys: G / N / Esc; modifiers are not ours', () => {
    expect(sidePickKey({ key: 'g' })).toBe('gst')
    expect(sidePickKey({ key: 'G' })).toBe('gst')
    expect(sidePickKey({ key: 'n' })).toBe('non_gst')
    expect(sidePickKey({ key: 'Escape' })).toBe('cancel')
    expect(sidePickKey({ key: 'g', ctrlKey: true })).toBeNull()
    expect(sidePickKey({ key: 'x' })).toBeNull()
  })

  it('labels', () => {
    expect(sideLabel('gst')).toBe('GST')
    expect(sideLabel('non_gst')).toBe('Non-GST')
    expect(sidePickTitle('pdf')).toBe('Save PDF of which side?')
  })
})
