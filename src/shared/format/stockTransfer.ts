import type { ColumnDef, FormatDef } from '../types'

// Phase 149 (design 1.5): Item name + Qty only. Qty is FREE TEXT here ("two dozen", "12") - `kind: 'text'` - and only here;
// every other format keeps a strict numeric qty. No rate / amount / GST / totals: `footer: 'none'`, no money columns.
const cols: ColumnDef[] = [
  { key: 'name', label: 'Item Name', kind: 'richtext', editable: true, widthPx: 420, printWidthPct: 70, align: 'left' },
  { key: 'qty', label: 'Qty', kind: 'text', editable: true, widthPx: 160, printWidthPct: 30, align: 'left' }
]

export const STOCK_TRANSFER_FORMAT: FormatDef = {
  id: 'stock_transfer',
  label: 'Stock transfer',
  shortcut: 'Alt+4',
  columns: cols,
  a5ExtraColLimit: 2,
  footer: 'none',
  partyMode: 'branch',
  docTitle: 'Stock transfer'
}
