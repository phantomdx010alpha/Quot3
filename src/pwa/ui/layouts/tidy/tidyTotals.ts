import { getBillOptions } from '../../../../shared/calc/billOptions'
import { computeBill } from '../../../../shared/calc/billTotals'
import { formatHasGst } from '../../../../shared/calc/rowCalc'
import { hasFormat, resolveFormat } from '../../../../shared/format/registry'
import type { Bill } from '../../../../shared/types'
import '../../../../shared/format'
import type { TotalsRow } from '../../kit/TotalsBlock'

/** Phase 192 - the totals lines of the Tidy layout (pure, display only). Everything comes from the shared `computeBill`; this only chooses the labels.
 *  A GST bill reads Before GST / GST / (adjustments, round-off) / Total; a plain bill reads (Items total, adjustments, round-off,) Total. The choice is a
 *  COLUMN check (`formatHasGst`), never a format name (rule 4.4). */
export interface TidyTotals {
  rows: TotalsRow[]
  total: string
  /** False when the format has no money at all (a stock transfer): nothing to show. */
  show: boolean
}

export function tidyTotals(bill: Pick<Bill, 'formatId' | 'rows' | 'roundOff'> & Partial<Bill>): TidyTotals {
  if (!hasFormat(bill.formatId)) return { rows: [], total: '', show: false }
  const format = resolveFormat(bill.formatId)
  const t = computeBill(format, bill.rows, getBillOptions(bill as Bill))
  const hasMoney = t.display.some((d) => d.kind === 'grandTotal' || d.kind === 'itemsTotal')
  if (!hasMoney) return { rows: [], total: '', show: false }
  const gst = formatHasGst(format)
  const rows: TotalsRow[] = []
  // A GST bill always starts with Before GST / GST (the calc's own sums), whether or not there are adjustments after them.
  if (gst) rows.push({ label: 'Before GST', amount: t.itemsTotal }, { label: 'GST', amount: t.itemsGst })
  for (const d of t.display) {
    const amount = d.cells['amount'] || d.cells['total'] || ''
    if (d.kind === 'itemsTotal') {
      if (!gst) rows.push({ label: d.cells['name'] ?? 'Items total', amount })
    } else if (d.kind === 'adjustment' || d.kind === 'roundOff') {
      // The adjustment rows of the footer, then the round-off line, in the order the calc produced them. ("Adjustments total" repeats them: left out.)
      rows.push({ label: d.cells['name'] || (d.kind === 'roundOff' ? 'Round off' : 'Adjustment'), amount })
    }
  }
  return { rows, total: t.grandTotal, show: true }
}
