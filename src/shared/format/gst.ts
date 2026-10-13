import type { ColumnDef, FormatDef } from '../types'

// A1: item name included. Qty before Rate per owner. Total derived + overridable; GST Amt / Amount derived.
const cols: ColumnDef[] = [
  { key: 'slNo', label: 'Sl.No', kind: 'auto', editable: false, widthPx: 48, printWidthPct: 7, align: 'center' },
  { key: 'name', label: 'Item Name', kind: 'richtext', editable: true, widthPx: 280, printWidthPct: 27, align: 'left' },
  { key: 'qty', label: 'Quantity', kind: 'num', editable: true, widthPx: 80, printWidthPct: 11, align: 'right' },
  { key: 'rate', label: 'Rate', kind: 'num', editable: true, widthPx: 84, printWidthPct: 10, align: 'right' },
  { key: 'total', label: 'Total', kind: 'derived', editable: true, overridable: true, widthPx: 104, printWidthPct: 12, align: 'right' },
  { key: 'gstRate', label: 'GST %', kind: 'num', editable: true, widthPx: 64, printWidthPct: 8, align: 'right' },
  { key: 'gstAmt', label: 'GST Amt', kind: 'derived', editable: false, widthPx: 92, printWidthPct: 11, align: 'right' },
  { key: 'amount', label: 'Amount', kind: 'derived', editable: false, widthPx: 108, printWidthPct: 14, align: 'right' }
]

export const GST_FORMAT: FormatDef = {
  id: 'gst',
  label: 'GST',
  shortcut: 'Alt+1',
  columns: cols,
  a5ExtraColLimit: 0,
  footer: 'total_gst_amount'
}
