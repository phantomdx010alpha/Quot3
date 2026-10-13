import type { BillRow, ExtraColDef, IsoDate } from '../types'
import { SAMPLE_PARTIES } from '../party/sampleParties'

/**
 * Phase 32 — thirty deterministic "historical" bills for the History / Customers / Dashboard / print / sync phases.
 * Pure data: the same call always returns the same bills (no clock, no randomness). Dates run from `anchor` back in time.
 * Variety on purpose: both formats, extra columns with marks, adjustments (incl. negative), styled names, a long name,
 * an override total, a paper override, and bills with no phone/transport.
 */
export interface HistoricalBill {
  party: { name: string; phone: string; address: string; transport: string }
  formatId: 'non_gst' | 'gst'
  extraCols: ExtraColDef[]
  paperOverride: 'A4' | 'A5' | null
  billDate: IsoDate
  rows: BillRow[]
}

export const HISTORICAL_BILL_COUNT = 30
const ITEMS = ['Cotton shirt cloth', 'Silk saree border', 'Pen box', 'Notebook A4', 'Ruby thread', 'Tomato red dye', 'Steel bowl set', 'Brass lamp', 'Plastic chair', 'LED bulb 9W', 'Copper wire 2 mm', 'Gift wrap roll']
const RATES = ['9', '12.50', '45', '99.99', '120', '250.75', '18', '640']
const QTYS = ['1', '2', '3', '5', '10', '12', '25', '0.5']

function isoDate(anchor: IsoDate, daysBack: number): IsoDate {
  const [y, m, d] = anchor.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(y, m - 1, d - daysBack))
  return t.toISOString().slice(0, 10)
}

export function historicalBills(count: number = HISTORICAL_BILL_COUNT, anchor: IsoDate = '2026-10-08'): HistoricalBill[] {
  const out: HistoricalBill[] = []
  for (let i = 0; i < count; i++) {
    const p = SAMPLE_PARTIES[i % SAMPLE_PARTIES.length]!
    const gst = i % 3 === 0
    const withUnits = i % 4 === 1
    const extraCols: ExtraColDef[] = withUnits ? [{ key: 'c1', header: 'ruby', kind: 'units' }] : []
    const nItems = 3 + (i % 6)
    const rows: BillRow[] = []
    for (let k = 0; k < nItems; k++) {
      const base = ITEMS[(i + k) % ITEMS.length]!
      const name = i === 7 && k === 0 ? `${base} ${'very long description '.repeat(12)}`.trim() : base
      const styled = i % 5 === 2 && k === 0
      rows.push({
        id: `h${i}-r${k}`, idx: k,
        nameRuns: styled ? [{ t: 'URGENT ', r: 1, b: 1 }, { t: name }] : [{ t: name }],
        qty: QTYS[(i * 3 + k) % QTYS.length]!, rate: RATES[(i + k * 2) % RATES.length]!,
        totalOverride: i === 11 && k === 1 ? '777' : null,
        gstRate: gst ? '18' : null,
        extras: withUnits && k < 2 ? { c1: { text: k === 0 ? '(125-5)' : 'tomato-7', marked: k === 1 } } : {},
      })
    }
    if (i % 6 === 4) rows.push({ id: `h${i}-adj`, idx: rows.length, nameRuns: [{ t: i % 12 === 4 ? 'Discount' : 'Freight' }], qty: null, rate: null, totalOverride: i % 12 === 4 ? '-100' : '250', gstRate: null, extras: {} })
    out.push({
      party: { name: p.name, phone: i % 7 === 3 ? '' : (p.phone ?? ''), address: p.address ?? '', transport: i % 5 === 0 ? '' : (p.transport ?? '') },
      formatId: gst ? 'gst' : 'non_gst',
      extraCols,
      paperOverride: i % 10 === 9 ? 'A4' : null,
      billDate: isoDate(anchor, i * 3),
      rows
    })
  }
  return out
}
