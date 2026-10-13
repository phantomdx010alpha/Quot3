import type { ColumnDef, FormatDef } from '../types'

// STUB formats for Phase 6 tests only (columns per MASTERPLAN §10). Phase 8's registry replaces these as the
// source of truth; calc code never branches on `id` — only on columns / footer.
const col = (key: string, label: string, kind: ColumnDef['kind'], align: ColumnDef['align'] = 'right'): ColumnDef => ({
  key, label, kind, editable: kind !== 'derived' && kind !== 'auto', widthPx: 90, printWidthPct: 10, align
})

export const NON_GST: FormatDef = {
  id: 'non_gst', label: 'Non-GST', isDefault: true, shortcut: 'Alt+2', a5ExtraColLimit: 2, footer: 'total',
  columns: [col('slNo', 'Sl.No', 'auto', 'center'), col('name', 'Item Name', 'richtext', 'left'), col('qty', 'Quantity', 'num'), col('rate', 'Rate', 'num'), { ...col('total', 'Amount', 'derived'), overridable: true }]
}

export const GST: FormatDef = {
  id: 'gst', label: 'GST', shortcut: 'Alt+1', a5ExtraColLimit: 0, footer: 'total_gst_amount',
  columns: [col('slNo', 'Sl.No', 'auto', 'center'), col('name', 'Item Name', 'richtext', 'left'), col('qty', 'Quantity', 'num'), col('rate', 'Rate', 'num'), { ...col('total', 'Total', 'derived'), overridable: true }, col('gstRate', 'GST %', 'num'), col('gstAmt', 'GST Amt', 'derived'), col('amount', 'Amount', 'derived')]
}
