import { describe, expect, it } from 'vitest'
import { PRINT_FIXTURE_IDS, printFixture } from '../../__fixtures__/printBills'
import { LEGACY_ITEMS_TOTAL } from '../../__fixtures__/bills'
import { resolveFormat } from '../../format/registry'
import { simplePaperDecision } from '../../paper/paperTypes'
import { PRINT_WIDTH_TOTAL } from '../printConstants'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS, formatPrintDate, PLACEHOLDER_COMPANY, printColumnShares, resolveCompany, printRowName, type PrintModel } from '../printModel'

const rough = (id: Parameters<typeof printFixture>[0], paper: 'A5' | 'A4' = 'A5'): PrintModel =>
  buildPrintModel(printFixture(id), 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision(paper))
const text = (m: PrintModel, r: PrintModel['body'][number], k: string): string => r.cells[k]?.text ?? ''

describe('Phase 33 - column widths', () => {
  it('always sum to exactly 100% for 0..12 extra columns, in both formats', () => {
    for (const id of ['non_gst', 'gst']) for (let n = 0; n <= 12; n++) {
      const s = printColumnShares(resolveFormat(id), n)
      expect(s).toHaveLength(resolveFormat(id).columns.length + n)
      expect(s.reduce((a, b) => a + b, 0)).toBe(PRINT_WIDTH_TOTAL)
      expect(Math.min(...s)).toBeGreaterThan(0)
    }
  })
  it('the name column absorbs leftover width and is the widest column with no extras', () => {
    const s = printColumnShares(resolveFormat('non_gst'), 0)
    expect(s[1]).toBe(5300)
  })
  it('two extras pay from the name column only (other columns keep their registry share)', () => {
    const s = printColumnShares(resolveFormat('non_gst'), 2)
    expect(s).toEqual([700, 3100, 1200, 1200, 1600, 1100, 1100])
  })
})

describe('Phase 33 - buildPrintModel', () => {
  it('legacy bill: 18 items, the screenshot total, extras after the format columns, Rough header', () => {
    const m = rough('legacy')
    expect(m.header).toEqual({ kind: 'rough', party: { name: 'Ruby Traders', phone: '98450 12345', transport: 'SRS Travels' } })
    expect(m.columns.map((c) => c.key)).toEqual(['slNo', 'name', 'qty', 'rate', 'total', 'ruby', 'tomato'])
    expect(m.body).toHaveLength(18)
    expect(m.rowCount).toBe(18)
    expect(text(m, m.body[0]!, 'name')).toBe('ruby gold belt roll big')
    expect(text(m, m.body[0]!, 'slNo')).toBe('1')
    expect(text(m, m.body[0]!, 'total')).toBe('900.00')
    expect(text(m, m.body[0]!, 'ruby')).toBe('11.5-1')
    expect(m.footer).toHaveLength(1)
    expect(m.footer[0]).toMatchObject({ kind: 'grandTotal', label: 'Total', cells: { total: { text: `₹${LEGACY_ITEMS_TOTAL}` } } })
  })
  it('Rough carries no company, address, PO or date anywhere in the model', () => {
    const json = JSON.stringify(rough('legacy'))
    expect(json).not.toContain('Market Road')
    expect(json).not.toContain('Q3-0007')
    expect(json).not.toContain('2026-10-08')
    expect(json).not.toContain('08 Oct')
    expect(json).not.toContain('company')
  })
  it('0.1.6: hideAdjustmentsTotal drops only the Adjustments total row (adjustment rows and final total stay)', () => {
    const m = buildPrintModel(printFixture('adjustment'), 'rough', { ...DEFAULT_PRINT_SETTINGS, hideAdjustmentsTotal: true }, simplePaperDecision('A5'))
    expect(m.footer.map((r) => r.kind)).toEqual(['itemsTotal', 'adjustment', 'adjustment', 'grandTotal'])
  })

  it('adjustments: items total, adjustment rows, adjustments total, final total - in that order', () => {
    const m = rough('adjustment')
    expect(m.body).toHaveLength(3)
    expect(m.footer.map((r) => r.kind)).toEqual(['itemsTotal', 'adjustment', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    expect(m.footer.map((r) => r.label ?? printRowName(r))).toEqual(['Items total', 'Discount', 'Packing', 'Adjustments total', 'Final total'])
    // 12*45 + 5*99.99 + 2*250.75 = 540 + 499.95 + 501.50 = 1541.45 ; -100 + 35.50 = -64.50 ; final 1476.95
    expect(m.footer[0]!.cells['total']!.text).toBe('1541.45')
    expect(m.footer[1]!.cells['total']!.text).toBe('-100.00')
    expect(m.footer[3]!.cells['total']!.text).toBe('-64.50')
    expect(m.footer[4]!.cells['total']!.text).toBe('₹1476.95')
    expect(m.rowCount).toBe(5)
  })
  it('GST: one Total row (total, GST amt, amount) with the rupee sign on the Amount only', () => {
    const m = rough('gst')
    expect(m.columns.map((c) => c.key)).toEqual(['slNo', 'name', 'qty', 'rate', 'total', 'gstRate', 'gstAmt', 'amount'])
    expect(m.body).toHaveLength(4)
    const last = m.footer[m.footer.length - 1]!
    expect(last.kind).toBe('grandTotal')
    expect(Object.keys(last.cells)).toEqual(['total', 'gstAmt', 'amount'])
    expect(last.cells['total']!.text).not.toContain('\u20B9')
    expect(last.cells['amount']!.text.startsWith('\u20B9')).toBe(true)
  })
  it('GST with an adjustment: adjustment and final total live in the Amount column only', () => {
    const b = printFixture('gst')
    b.rows.push({ ...b.rows[0]!, id: 'adj', idx: 4, nameRuns: [{ t: 'Discount' }], qty: null, rate: null, gstRate: null, totalOverride: '-50', extras: {} })
    const m = buildPrintModel(b, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'))
    expect(m.footer.map((r) => r.kind)).toEqual(['itemsTotal', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    expect(Object.keys(m.footer[3]!.cells)).toEqual(['amount'])
    expect(m.footer[1]!.cells['amount']!.text).toBe('-50.00')
    expect(m.footer[1]!.cells['total']!.text).toBe('')
  })
  it('extra-column model: marks are not printed as text; extras keep their text', () => {
    const m = rough('extraCols')
    expect(m.columns.filter((c) => c.isExtra).map((c) => c.label)).toEqual(['ruby', 'tomato'])
    expect(text(m, m.body[1]!, 'c1')).toBe('12.5-1')
  })
  it('styled names keep their runs; unstyled names carry none; cell highlight is kept', () => {
    const m = rough('styled')
    expect(m.body[0]!.cells['name']!.runs?.some((r) => r.r && r.b)).toBe(true)
    expect(m.body[1]!.cells['name']!.runs).toBeUndefined()
    expect(m.body[1]!.cells['name']!.hl).toBe(1)
    expect(m.body[2]!.cells['name']!.runs).toHaveLength(3)
  })
  it('blank rows are dropped; a row with only extra-column text is kept', () => {
    const b = printFixture('extraCols')
    const blank = { ...b.rows[0]!, id: 'blank1', nameRuns: [], qty: null, rate: null, extras: {} }
    const noteOnly = { ...b.rows[0]!, id: 'note1', nameRuns: [], qty: null, rate: null, extras: { c1: { text: 'note' } } }
    b.rows = [b.rows[0]!, blank, noteOnly, b.rows[1]!]
    const m = buildPrintModel(b, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'))
    expect(m.body).toHaveLength(3)
    expect(m.body[1]!.cells['c1']!.text).toBe('note')
  })
  it('party lines only when filled; rupee prefix is optional and respects a negative total', () => {
    const b = printFixture('legacy'); b.party = { name: 'X', phone: '', address: '', transport: '' }
    b.rows = [{ ...b.rows[0]!, qty: '1', rate: '100' }, { ...b.rows[1]!, nameRuns: [{ t: 'Credit' }], qty: null, rate: null, totalOverride: '-500' }]
    const m = buildPrintModel(b, 'rough', { ...DEFAULT_PRINT_SETTINGS, rupeeOnTotal: true }, simplePaperDecision('A5'))
    expect(m.header).toEqual({ kind: 'rough', party: { name: 'X', phone: '', transport: '' } })
    expect(m.footer[m.footer.length - 1]!.cells['total']!.text).toBe('-₹400.00')
    const plain = buildPrintModel(b, 'rough', { ...DEFAULT_PRINT_SETTINGS, rupeeOnTotal: false }, simplePaperDecision('A5'))
    expect(plain.footer[plain.footer.length - 1]!.cells['total']!.text).toBe('-400.00')
  })
  it('paper decision passes through; the model never mutates the bill; same input gives an identical model', () => {
    const b = printFixture('adjustment'); const before = JSON.stringify(b)
    const a = buildPrintModel(b, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A4', 2))
    expect(JSON.stringify(b)).toBe(before)
    expect(a.paper).toMatchObject({ size: 'A4', pages: 2 })
    expect(buildPrintModel(b, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A4', 2))).toEqual(a)
  })
  it('professional model carries the data Phase 34 needs (company, address, PO, date)', () => {
    const m = buildPrintModel(printFixture('legacy'), 'professional', { ...DEFAULT_PRINT_SETTINGS, company: { logo: '', name: 'Acme', phone: '1', address: 'Addr' } }, simplePaperDecision('A5'))
    expect(m.header).toMatchObject({ kind: 'professional', poNumber: 'Q3-0007', billDate: '08 Oct 2026', company: { name: 'Acme' }, party: { address: '12, Market Road, Bengaluru' } })
  })
  it('formatPrintDate and resolveCompany', () => {
    expect(formatPrintDate('2026-10-08')).toBe('08 Oct 2026')
    expect(formatPrintDate('2026-12-31')).toBe('31 Dec 2026')
    expect(formatPrintDate('bad')).toBe('bad')
    expect(resolveCompany(null)).toBe(PLACEHOLDER_COMPANY)
    expect(resolveCompany({ logo: '', name: '  ', phone: '', address: '' })).toBe(PLACEHOLDER_COMPANY)
  })
  it('every fixture builds, and the 40-row fixture counts 40 item/adjustment rows', () => {
    for (const id of PRINT_FIXTURE_IDS) expect(() => rough(id)).not.toThrow()
    expect(rough('rows40').rowCount).toBe(40)
  })
  it('snapshot: adjustment + extraCols models (guards accidental layout/data drift)', () => {
    expect(rough('adjustment')).toMatchSnapshot()
    expect(rough('extraCols')).toMatchSnapshot()
    expect(rough('gst')).toMatchSnapshot()
  })
})
