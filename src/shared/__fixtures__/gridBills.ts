import { createEmptyBill } from '../billModel'
import type { Bill, BillRow } from '../types'
import { LEGACY_ROWS } from './bills'

let n = 0
const newId = (): string => `gb-${++n}`

function mk(i: number, name: string, qty: string | null, rate: string | null, extras: BillRow['extras'] = {}): BillRow {
  return { id: newId(), idx: i, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras }
}

/** The owner's legacy screenshot bill: 18 items + ruby/tomato extra columns (units fixture shape) + one marked cell. */
export function legacyGridBill(): Bill {
  const b = createEmptyBill({ branchId: 'dev', billDate: '2026-10-08', now: '2026-10-08T00:00:00.000Z', newId, rowCount: 0 })
  b.extraCols = [{ key: 'ruby', header: 'ruby', kind: 'units' }, { key: 'tomato', header: 'tomato', kind: 'units' }]
  const ruby = ['11.5-1', '12.5-1', '13-1', '13.5-1', '14-1', '14.5-1', '15-1', '15.5-1', '16-1', '16.5-1', '17-1', '17.5-1', '', 'idk bruhh', '25-5', '25651-45', '42-5']
  const tomato = ['5-4', '56-2', '454-1']
  b.rows = LEGACY_ROWS.map(([name, q, r], i) => {
    const extras: BillRow['extras'] = {}
    const rb = ruby[i]
    if (rb) extras.ruby = rb === 'idk bruhh' ? { text: rb, marked: true } : { text: rb }
    const tm = tomato[i]
    if (tm) extras.tomato = { text: tm }
    return mk(i, name, q, r, extras)
  })
  return b
}

/** Deterministic n-row bill (default 80) with a few long names, GST rates, one adjustment and one override. */
export function bigGridBill(count = 80): Bill {
  const b = createEmptyBill({ branchId: 'dev', billDate: '2026-10-08', now: '2026-10-08T00:00:00.000Z', newId, rowCount: 0 })
  b.extraCols = [{ key: 'c1', header: 'Col 1', kind: 'units' }]
  b.rows = Array.from({ length: count }, (_, i) => {
    const long = i % 17 === 5 ? ' with an unusually long description that must ellipsise in the grid cell' : ''
    const r = mk(i, `item ${i + 1}${long}`, String((i % 9) + 1), String(((i * 37) % 400) + 10), i % 3 === 0 ? { c1: { text: `${100 + i}-${(i % 5) + 1}` } } : {})
    r.gstRate = i % 4 === 0 ? '18' : i % 4 === 1 ? '12' : null
    return r
  })
  if (count > 10) {
    const adj = b.rows[count - 1] as BillRow
    adj.nameRuns = [{ t: 'Discount' }]; adj.qty = null; adj.rate = null; adj.totalOverride = '-250'
    ;(b.rows[7] as BillRow).totalOverride = '999'
  }
  return b
}

/** Phase 23: overflow fixture — a 300-char name, RTL text, emoji/ZWJ sequences, and a 40-character extra-column header. */
export const LONG_HEADER_40 = 'Forty-character header for overflow test!'.slice(0, 40)
export function longTextGridBill(): Bill {
  const b = createEmptyBill({ branchId: 'dev', billDate: '2026-10-08', now: '2026-10-08T00:00:00.000Z', newId, rowCount: 0 })
  b.extraCols = [{ key: 'c1', header: LONG_HEADER_40, kind: 'units' }]
  b.rows = [
    mk(0, 'long item name '.repeat(20).trim(), '2', '100', { c1: { text: 'code-with-a-very-long-label-' + 'x'.repeat(80) + '-5' } }),
    mk(1, 'عنصر طويل جدا للاختبار '.repeat(6).trim(), '1', '50'),
    mk(2, 'gift 🎁 family 👨‍👩‍👧‍👦 flag 🇮🇳 done', '3', '10')
  ]
  return b
}
