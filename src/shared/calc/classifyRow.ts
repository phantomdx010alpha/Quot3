import type { BillRow, RowKind } from '../types'

const has = (v: string | null | undefined): boolean => v !== null && v !== undefined && v.trim() !== ''

/** Plain text of the item name (trimmed). */
export function rowName(row: Pick<BillRow, 'nameRuns'>): string {
  let s = ''
  for (const r of row.nameRuns) s += r.t
  return s.trim()
}

export const hasQty = (row: Pick<BillRow, 'qty'>): boolean => has(row.qty)
export const hasRate = (row: Pick<BillRow, 'rate'>): boolean => has(row.rate)
export const hasOverride = (row: Pick<BillRow, 'totalOverride'>): boolean => has(row.totalOverride)

/**
 * Row kind, derived (never stored) — MASTERPLAN §11:
 * blank      no name, no qty, no rate, no total override
 * item       has qty or rate (either or both) — a nameless one is still an item (D-C1, flagged by calcRow)
 * adjustment name present, qty and rate both empty, total override present
 * partial    anything else (name only; or a total with no name)
 */
export function classifyRow(row: BillRow): RowKind {
  const name = rowName(row) !== ''
  const q = hasQty(row)
  const r = hasRate(row)
  const o = hasOverride(row)
  if (q || r) return 'item'
  if (!name && !o) return 'blank'
  if (name && o) return 'adjustment'
  return 'partial'
}
