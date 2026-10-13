import type { BillRow } from '../types'

let seq = 0
/** Terse row builder for tests. `name` '' → no name. */
export function row(name: string, qty: string | null, rate: string | null, over: Partial<BillRow> & { total?: string | null; gst?: string | null } = {}): BillRow {
  const { total, gst, ...rest } = over
  const i = seq++
  return {
    id: `r${i}`, idx: i,
    nameRuns: name ? [{ t: name }] : [],
    qty, rate,
    totalOverride: total ?? null,
    gstRate: gst ?? null,
    extras: {},
    ...rest
  }
}
export const blankRow = (): BillRow => row('', null, null)

/** First 18 rows of the owner's legacy screenshot (legacy_create_screen.png): qty × rate = amount as shown. */
export const LEGACY_ROWS: [string, string, string][] = [
  ['ruby gold belt roll big', '10', '90'], ['ruby gold 32x70', '10', '120'], ['talco 2044', '30', '108'],
  ['spade = 8800- black-2} cream-2} 1163-2}', '6', '105'], ['spade yellow big', '15', '450'],
  ['jumbo trimmer big', '1', '150'], ['stretch gripper 2 inch white', '2', '130'], ['kohinoor 1', '1', '140'],
  ['eagle elastic 1/2', '1', '90'], ['bone 2 inch plastic', '2', '120'], ['bone 1.5 inch plastic', '2', '100'],
  ['db14 gold', '1', '880'], ['gemsy db16- 1 } db14-1}', '2', '180'], ['hemming needle bell no7', '1', '50'],
  ['ruby gold collar', '12', '70'], ['milton d7', '12', '48'], ['jumbo cone 20k', '10', '60'],
  ['jyothi measurement tape big', '1', '120']
]
/** Amounts shown/derivable from the screenshot (rows 1–6 are hidden behind the popup there; qty × rate here). */
export const LEGACY_AMOUNTS = ['900.00', '1200.00', '3240.00', '630.00', '6750.00', '150.00', '260.00', '140.00', '90.00', '240.00', '200.00', '880.00', '360.00', '50.00', '840.00', '576.00', '600.00', '120.00']
export const LEGACY_ITEMS_TOTAL = '17226.00'
export const legacyBill = (): BillRow[] => LEGACY_ROWS.map(([n, q, r]) => row(n, q, r))
