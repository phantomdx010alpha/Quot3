import type { ColumnDef, FormatDef } from '../types'

// Owner's list order: sl.no, item name, rate, qty, total (MASTERPLAN §10). Total is derived and overridable.
const cols: ColumnDef[] = [
  { key: 'slNo', label: 'Sl.No', kind: 'auto', editable: false, widthPx: 52, printWidthPct: 7, align: 'center' },
  { key: 'name', label: 'Item Name', kind: 'richtext', editable: true, widthPx: 360, printWidthPct: 53, align: 'left' },
  { key: 'rate', label: 'Rate', kind: 'num', editable: true, widthPx: 96, printWidthPct: 12, align: 'right' },
  { key: 'qty', label: 'Quantity', kind: 'num', editable: true, widthPx: 96, printWidthPct: 12, align: 'right' },
  { key: 'total', label: 'Amount', kind: 'derived', editable: true, overridable: true, widthPx: 120, printWidthPct: 16, align: 'right' }
]

export const NON_GST_FORMAT: FormatDef = {
  id: 'non_gst',
  label: 'Non-GST',
  shortcut: 'Alt+2',
  isDefault: true,
  columns: cols,
  a5ExtraColLimit: 2,
  footer: 'total'
}
