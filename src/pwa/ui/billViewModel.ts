import { getBillOptions } from '../../shared/calc/billOptions'
import { computeBill } from '../../shared/calc/billTotals'
import { formatHistoryDate } from '../../shared/history/historyList'
import { hasFormat, resolveFormat } from '../../shared/format/registry'
import type { Bill, ColumnDef, Runs } from '../../shared/types'
import '../../shared/format'

/** Read-only bill view model (Phase 181). Totals come only from shared `computeBill` + `getBillOptions`; formats only through the registry. */
export interface ViewField { key: string; label: string; value: string }
export interface ViewItem {
  key: string
  kind: 'item' | 'adjustment' | 'partial' | 'blank'
  slNo: string
  runs: Runs
  /** Qty, rate, total, GST and extra-column cells that have a value, in column order. */
  fields: ViewField[]
  overridden: boolean
}
export interface ViewFooterLine { key: string; label: string; value: string; strong: boolean }
export interface BillView {
  poNumber: string
  billDate: string
  revision: number
  formatLabel: string
  /** The party block: name (or branch for a transfer), phone, transport, address; empty parts are left out. */
  partyLabel: string
  party: ViewField[]
  items: ViewItem[]
  footer: ViewFooterLine[]
  /** Set when the phone cannot edit this bill (it still opens read-only). */
  readOnlyReason: string | null
}

export const EDIT_ON_PC = 'Edit on PC'

/** [A] The phone edits only the plain money formats. A bill is read-only here when it carries a Hybrid second table, its format is unknown to
 *  this build, or its format has no customer (the registry marks a transfer by `partyMode: 'branch'`). Decided from the registry, never a format id. */
export function phoneEditBlockReason(bill: Pick<Bill, 'formatId' | 'hybrid'>): string | null {
  if (bill.hybrid) return `${EDIT_ON_PC}: this is a hybrid bill.`
  if (!hasFormat(bill.formatId)) return `${EDIT_ON_PC}: this bill uses a layout this app does not know yet.`
  if (resolveFormat(bill.formatId).partyMode === 'branch') return `${EDIT_ON_PC}: this is a stock transfer.`
  return null
}

const SKIP = new Set(['slNo', 'name'])

export function buildBillView(bill: Bill): BillView {
  const format = resolveFormat(bill.formatId)
  const totals = computeBill(format, bill.rows, getBillOptions(bill))
  const rowById = new Map(bill.rows.map((r) => [r.id, r]))
  const cols: ColumnDef[] = format.columns.filter((c) => !SKIP.has(c.key))
  const extra = bill.extraCols.map((c) => ({ key: c.key, label: c.header }))

  const items: ViewItem[] = []
  const footer: ViewFooterLine[] = []
  for (const d of totals.display) {
    if (d.kind === 'item' || d.kind === 'partial' || d.kind === 'blank' || d.kind === 'adjustment') {
      const row = d.rowId ? rowById.get(d.rowId) : undefined
      if (d.kind === 'blank') continue
      const fields: ViewField[] = []
      for (const c of [...cols.map((x) => ({ key: x.key, label: x.label })), ...extra]) {
        const v = d.cells[c.key]
        if (v !== undefined && v !== '') fields.push({ key: c.key, label: c.label, value: v })
      }
      items.push({ key: d.rowId ?? `r${items.length}`, kind: d.kind, slNo: d.slNo ? String(d.slNo) : '', runs: row?.nameRuns ?? [{ t: d.cells['name'] ?? '' }], fields, overridden: d.override === true })
    } else {
      const v = d.cells['amount'] || d.cells['total'] || ''
      footer.push({ key: d.kind, label: d.cells['name'] ?? '', value: v, strong: d.kind === 'grandTotal' })
    }
  }

  const p = bill.party
  const branchMode = format.partyMode === 'branch'
  const party: ViewField[] = [
    { key: 'name', label: branchMode ? 'Branch' : 'Party', value: p.name },
    { key: 'phone', label: 'Phone', value: p.phone },
    { key: 'transport', label: 'Transport', value: p.transport },
    { key: 'address', label: 'Address', value: p.address }
  ].filter((f) => f.value.trim() !== '')

  return {
    poNumber: bill.poNumber,
    billDate: formatHistoryDate(bill.billDate),
    revision: bill.revision,
    formatLabel: format.label,
    partyLabel: p.name.trim() || 'No name',
    party,
    items,
    footer,
    readOnlyReason: phoneEditBlockReason(bill)
  }
}
