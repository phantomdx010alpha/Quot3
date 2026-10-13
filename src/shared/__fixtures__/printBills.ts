import { createEmptyBill } from '../billModel'
import type { Bill, BillRow } from '../types'
import { bigGridBill, legacyGridBill, longTextGridBill } from './gridBills'

/**
 * Phase 33 - named print fixtures (legacy, GST, adjustment, extra-columns, long text, styled names, 40 rough rows).
 * Used by the model snapshot tests and the /dev/print-preview page. Deterministic; each call returns a fresh bill.
 */
export type PrintFixtureId = 'legacy' | 'gst' | 'adjustment' | 'extraCols' | 'longText' | 'styled' | 'rows40' | 'rows30' | 'name60' | 'name120' | 'header40' | 'gstExtra3' | 'rows81' | 'rows150'


export const PRINT_FIXTURE_IDS: readonly PrintFixtureId[] = ['legacy', 'gst', 'adjustment', 'extraCols', 'longText', 'styled', 'rows40', 'rows30', 'name60', 'name120', 'header40', 'gstExtra3', 'rows81', 'rows150']

const party = { name: 'Ruby Traders', phone: '98450 12345', address: '12, Market Road, Bengaluru', transport: 'SRS Travels' }
let seq = 0
const mk = (name: string, qty: string | null, rate: string | null, over: Partial<BillRow> = {}): BillRow => ({
  id: `pf-${++seq}`, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...over
})
const base = (formatId: string, rows: BillRow[], extraCols: Bill['extraCols'] = []): Bill => {
  const b = createEmptyBill({ branchId: 'dev', formatId, billDate: '2026-10-08', now: '2026-10-08T00:00:00.000Z', newId: () => `pb-${++seq}`, rowCount: 0 })
  b.party = { ...party }; b.poNumber = 'Q3-0007'; b.extraCols = extraCols
  b.rows = rows.map((r, i) => ({ ...r, idx: i }))
  return b
}

const NAME_60 = 'Premium embroidered cotton blend saree with golden border piece'.slice(0, 60)
const NAME_120 = ('Hand woven silk brocade bridal lehenga set with matching dupatta and blouse piece, ' + 'extra long description continues here').slice(0, 120)
const HEADER_40 = 'Quantity per carton including loose items'.slice(0, 40)
const manyRows = (n: number): Bill => base('non_gst', Array.from({ length: n }, (_, i) => mk(`item ${i + 1}${i % 11 === 4 ? ' with a somewhat longer description so it wraps' : ''}`, String((i % 9) + 1), String(((i * 37) % 400) + 10))))

const BUILDERS: Record<PrintFixtureId, () => Bill> = {
  legacy: () => {
    const b = legacyGridBill(); b.party = { ...party }; b.poNumber = 'Q3-0007'
    return b
  },
  gst: () => base('gst', [
    mk('Cotton shirt cloth', '10', '120', { gstRate: '5' }),
    mk('Steel bowl set', '3', '640', { gstRate: '12' }),
    mk('LED bulb 9W', '25', '45', { gstRate: '18' }),
    mk('Gift wrap roll', '4', '18')
  ]),
  adjustment: () => base('non_gst', [
    mk('Notebook A4', '12', '45'), mk('Pen box', '5', '99.99'), mk('Brass lamp', '2', '250.75'),
    mk('Discount', null, null, { totalOverride: '-100' }), mk('Packing', null, null, { totalOverride: '35.50' })
  ]),
  extraCols: () => base('non_gst', [
    mk('Ruby thread', '10', '90', { extras: { c1: { text: '11.5-1' }, c2: { text: '5-4' } } }),
    mk('Tomato red dye', '2', '120', { extras: { c1: { text: '12.5-1', marked: true } } }),
    mk('Copper wire 2 mm', '1', '250', { extras: { c2: { text: '56-2' } } })
  ], [{ key: 'c1', header: 'ruby', kind: 'units' }, { key: 'c2', header: 'tomato', kind: 'units' }]),
  longText: () => {
    const b = longTextGridBill(); b.party = { ...party, name: 'A very long party name that must wrap onto a second line of the header ' + 'Traders and Sons'.repeat(2) }
    return b
  },
  styled: () => base('non_gst', [
    mk('', '1', '100', { nameRuns: [{ t: 'plain ' }, { t: 'bold', b: 1 }, { t: ' and ' }, { t: 'red bold', r: 1, b: 1 }, { t: ' & <tag> "q"' }] }),
    mk('highlighted cell', '2', '50', { cellStyle: { name: { hl: 1 } } }),
    mk('part of this is highlighted', '3', '10', { nameRuns: [{ t: 'part of ' }, { t: 'this', hl: 1 }, { t: ' is highlighted' }] })
  ]),
  rows30: () => {
    const b = bigGridBill(30); b.party = { ...party }; b.poNumber = 'Q3-0030'; b.formatId = 'non_gst'
    return b
  },
  /** Phase 35 long-text fixtures. */
  name60: () => base('non_gst', [
    mk(NAME_60, '2', '100'), mk('short item', '1', '50'), mk(NAME_60.toUpperCase(), '3', '75.5', { nameRuns: [{ t: NAME_60.slice(0, 30), b: 1 }, { t: NAME_60.slice(30), r: 1 }] })
  ]),
  name120: () => base('non_gst', [
    mk(NAME_120, '1', '1250.50'), mk('X'.repeat(70) + '-' + 'y'.repeat(40), '4', '10'), mk('normal', '1', '5')
  ]),
  header40: () => base('non_gst', [
    mk('Ruby thread', '10', '90', { extras: { c1: { text: '11.5-1' }, c2: { text: 'code-' + 'z'.repeat(45) + '-5' } } }),
    mk('Tomato red dye', '2', '120', { extras: { c1: { text: '12.5-1', marked: true } } })
  ], [{ key: 'c1', header: HEADER_40, kind: 'units' }, { key: 'c2', header: 'Another fairly long column header', kind: 'units' }]),
  gstExtra3: () => base('gst', Array.from({ length: 12 }, (_, i) => mk(i % 4 === 0 ? NAME_60 : `Item number ${i + 1}`, String(i + 1), String(100 + i * 7), {
    gstRate: i % 3 === 0 ? '18' : i % 3 === 1 ? '12' : '5', extras: { c1: { text: `${10 + i}-${(i % 4) + 1}` }, c2: { text: `${i + 1}.5-2` }, ...(i % 2 ? { c3: { text: 'a long extra cell value ' + i } } : {}) }
  })), [{ key: 'c1', header: 'ruby', kind: 'units' }, { key: 'c2', header: HEADER_40, kind: 'units' }, { key: 'c3', header: 'Remarks', kind: 'units' }]),
  rows81: () => manyRows(81),
  rows150: () => manyRows(150),
  rows40: () => {
    const b = bigGridBill(40); b.party = { ...party }; b.poNumber = 'Q3-0040'; b.formatId = 'non_gst'
    return b
  }
}

export const printFixture = (id: PrintFixtureId): Bill => BUILDERS[id]()

/**
 * Phase 40 - a bill for the PAPER_ENGINE_RULES §6 matrix: `rows` item rows, `extras` extra (units) columns, any format.
 * `withGstRates` gives every row a GST % (for a GST format). Deterministic; a long item name every 11th row so wrapping is exercised.
 */
export function matrixBill(formatId: string, rows: number, extras: number, withGstRates = false): Bill {
  const cols: Bill['extraCols'] = Array.from({ length: extras }, (_, i) => ({ key: `c${i + 1}`, header: `col${i + 1}`, kind: 'units' as const }))
  const items = Array.from({ length: rows }, (_, i) => mk(`item ${i + 1}${i % 11 === 4 ? ' with a somewhat longer description so it wraps' : ''}`, String((i % 9) + 1), String(((i * 37) % 400) + 10), {
    ...(withGstRates ? { gstRate: i % 3 === 0 ? '18' : i % 3 === 1 ? '12' : '5' } : {}),
    extras: Object.fromEntries(cols.map((c, k) => [c.key, { text: `${10 + i + k}-${(i % 4) + 1}` }]))
  }))
  return base(formatId, items, cols)
}
