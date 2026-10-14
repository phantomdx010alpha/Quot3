import { computeBill } from '../calc/billTotals'
import { getBillOptions } from '../calc/billOptions'
import { footerKeyOfKind } from '../freeCells'
import { resolveFormat } from '../format/registry'
import { buildGridColumns } from '../gridModel'
import type { Bill } from '../types'
import { formatTsv } from './tsvCodec'

/**
 * Phase 31 - the whole bill as Excel-ready text (pure). PARTY SIDE ONLY: party name, then phone and transport lines
 * (each only when filled in), a blank row, the table header row, the item rows, then the footer rows exactly as the
 * grid shows them (adjustments, items/adjustments total, round-off, final total). No company block, no PO number, no
 * party address, no date. Numbers are the grid's plain 2-dp / canonical strings (no thousands commas, no rupee sign) so
 * Excel reads them as numbers. Blank padding rows are skipped; a partial row is shown as typed. Extra columns follow the
 * format's own columns, with their headers.
 */
export interface BillTsv {
  /** Ragged rows: the party lines have 1-2 cells, the table rows have one cell per column. */
  rows: string[][]
  /** Clipboard text (CRLF rows, Excel quoting) - `formatTsv(rows)`. */
  text: string
  /** `<table>` flavour so Excel / Word paste into cells. */
  html: string
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '<br>')

export function billToRows(bill: Bill): string[][] {
  const format = resolveFormat(bill.formatId)
  const cols = buildGridColumns(format, bill.extraCols)
  const totals = computeBill(format, bill.rows, getBillOptions(bill))
  const rows: string[][] = []
  const p = bill.party
  if (format.partyMode === 'branch') {
    // Phase 149: Stock transfer: the title and the branch the stock comes from (no phone / transport).
    if (format.docTitle) rows.push([format.docTitle])
    if (p.name.trim()) rows.push(['From branch', p.name.trim()])
  } else {
    if (p.name.trim()) rows.push([p.name.trim()])
    if (p.phone.trim()) rows.push(['Phone', p.phone.trim()])
    if (p.transport.trim()) rows.push(['Transport', p.transport.trim()])
  }
  if (rows.length > 0) rows.push([])
  rows.push(cols.map((c) => c.label))
  for (const d of totals.display) {
    if (d.kind === 'blank') continue
    // Phase 81: the free extra cells of a SHOWN total row (the display only holds the footer rows that are shown).
    const fk = footerKeyOfKind(d.kind)
    const free = fk ? bill.footerExtras?.[fk] : undefined
    rows.push(cols.map((c) => (c.isExtra && free ? free[c.key]?.text ?? '' : d.cells[c.key] ?? '')))
  }
  // Phase 81: extra-only tail rows below the Final total, as many as the paper engine counts (same number as print).
  const tailCount = totals.counts.paperRows - totals.counts.itemRows - totals.counts.adjustmentRows
  for (let i = 0; i < tailCount; i++) {
    const src = bill.tailRows?.[i]?.extras ?? {}
    rows.push(cols.map((c) => (c.isExtra ? src[c.key]?.text ?? '' : '')))
  }
  return rows
}

export function billToTsv(bill: Bill): BillTsv {
  const rows = billToRows(bill)
  const text = formatTsv(rows.map((r) => (r.length === 0 ? [''] : r)))
  const trs = rows.map((r) => (r.length === 0 ? '<tr><td></td></tr>' : `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`))
  // the table header row is the first row whose width equals the column count (after the party lines + spacer)
  const html = `<table>${trs.join('')}</table>`
  return { rows, text, html }
}

/** True when there is anything worth copying: a named party or at least one non-blank row. */
export function billHasContent(bill: Bill): boolean {
  if (bill.party.name.trim() !== '') return true
  const totals = computeBill(resolveFormat(bill.formatId), bill.rows, getBillOptions(bill))
  return totals.display.some((d) => d.kind === 'item' || d.kind === 'partial' || d.kind === 'adjustment')
}
