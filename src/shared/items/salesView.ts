/**
 * Phase 114 - the Sales window's pure view helpers (no React, no Electron). They only FORMAT what the Phase 110 read model already
 * computed (`GroupSales`): no money arithmetic happens here, every amount stays the decimal string it arrived as.
 */
import type { GroupSales } from './api'
import type { PartyLastRate, RateStats, SaleRow, SalesTab } from './sales'

export type SalesTabId = 'nonGst' | 'gst'
/** The GST sales tab id (a UI tab, NOT a format id; named so no literal comparison is needed). */
export const GST_TAB: SalesTabId = 'gst'
export const SALES_TAB_IDS: readonly SalesTabId[] = ['nonGst', 'gst']

export const tabOf = (sales: GroupSales, id: SalesTabId): SalesTab => (id === GST_TAB ? sales.gst : sales.nonGst)

/** Non-GST first; GST only when Non-GST has no sales at all and GST has some. */
export function defaultTab(sales: GroupSales): SalesTabId {
  return sales.nonGst.stats.count === 0 && sales.gst.stats.count > 0 ? 'gst' : 'nonGst'
}

export const saleKey = (r: Pick<SaleRow, 'billId' | 'rowIdx'>): string => `${r.billId}:${r.rowIdx}`

/** Index of the row with this key, -1 when it is not (any more) in the list. */
export function saleRowIndex(rows: readonly SaleRow[], key: string | null): number {
  if (key === null) return -1
  return rows.findIndex((r) => saleKey(r) === key)
}

export function salesColumns(id: SalesTabId): string[] {
  const base = ['Date', 'Party', 'Bill', 'Qty', 'Rate']
  return id === GST_TAB ? [...base, 'GST %', 'Tax', 'Line total'] : base
}

export const flagText = (o: 'high' | 'low' | null): string => (o === 'high' ? 'High' : o === 'low' ? 'Low' : '')

/** dd-mm-yy like the rest of the app; an unreadable date is shown as it is. */
export function dateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}-${m[2]}-${m[1]!.slice(2)}` : iso
}

/** Display strings of one row, in `salesColumns` order. */
export function saleCells(r: SaleRow, id: SalesTabId): string[] {
  const base = [dateText(r.billDate), r.partyName, r.poNumber, r.qty ?? '', r.rate ?? '']
  if (id !== GST_TAB) return base
  return [...base, r.gstPct !== null ? r.gstPct : '', r.gstAmt ?? '', r.amount ?? r.lineTotal ?? '']
}

const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim()

/** Plain-text table of the CURRENT list (party filter applied) for Excel: header, then one line per sale; a rate flag is its own last column. */
export function salesToTsv(tab: SalesTab, id: SalesTabId): string {
  const lines = [[...salesColumns(id), 'Flag'].join('\t')]
  for (const r of tab.rows) lines.push([...saleCells(r, id), flagText(r.outlier)].map(clean).join('\t'))
  return lines.join('\r\n')
}

/** One line of summary: `118 sales, rate 75 - 90 (median 82), latest 84 on 03-10-26, qty 640, 77 parties`. */
export function statsText(s: RateStats): string {
  if (s.count === 0) return 'No sales'
  const parts = [`${s.count} ${s.count === 1 ? 'sale' : 'sales'}`]
  if (s.minRate !== null && s.maxRate !== null) {
    parts.push(s.minRate === s.maxRate ? `rate ${s.minRate}` : `rate ${s.minRate} - ${s.maxRate}`)
    if (s.medianRate !== null) parts[parts.length - 1] += ` (median ${s.medianRate})`
  } else parts.push('no rates')
  if (s.latestRate !== null) parts.push(`latest ${s.latestRate}${s.latestDate ? ` on ${dateText(s.latestDate)}` : ''}`)
  parts.push(`qty ${s.totalQty}`)
  parts.push(`${s.parties} ${s.parties === 1 ? 'party' : 'parties'}`)
  return parts.join(', ')
}

/** Party key of the highlighted row, null when there is none. */
export function partyOfRow(rows: readonly SaleRow[], i: number): string | null {
  return rows[i]?.partyKey ?? null
}

/** One line of the Sales list: a sale, the "who paid what" sub-header, or a party's last rate. All are one row high. */
export type SalesListRow =
  | { kind: 'sale'; key: string; row: SaleRow; index: number }
  | { kind: 'sub'; key: string; text: string }
  | { kind: 'party'; key: string; party: PartyLastRate }

/** The sales (newest first), then "Last rate per party" (when any party has a rate). `index` of a sale = its position among the sales (the cursor). */
export function buildSalesListRows(tab: SalesTab): SalesListRow[] {
  const out: SalesListRow[] = tab.rows.map((row, index) => ({ kind: 'sale', key: saleKey(row), row, index }))
  if (tab.lastByParty.length > 0) {
    out.push({ kind: 'sub', key: 'sub:parties', text: 'Who paid what: last rate per party' })
    for (const p of tab.lastByParty) out.push({ kind: 'party', key: `party:${p.partyKey}`, party: p })
  }
  return out
}
