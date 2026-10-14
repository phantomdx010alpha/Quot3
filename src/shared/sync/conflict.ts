import { z } from 'zod'
import type { BillRecord, BillRowRecord } from '../billModel'

/**
 * Phase 57: shared rules for conflicts (docs/SYNC_POSTBOX_SPEC.md section 6). Pure.
 * A conflict = a change from another branch WON while this computer still had an edit of its own that had not been sent.
 * The local edit is never lost: its full snapshot goes into `audit_log` (action `conflict`) and the bill is marked `conflict`.
 */

/** The parts of a bill that a person can see or edit. Version bookkeeping (revision, times, sync state, totals cache) is not content. */
type ContentBill = Pick<BillRecord, 'branchId' | 'poSeq' | 'poNumber' | 'partySnapshotJson' | 'formatId' | 'extraColsJson' | 'paperOverride' | 'roundOff' | 'footerExtrasJson' | 'tailRowsJson' | 'secondTableJson' | 'billDate' | 'deletedAt'>
type ContentRow = Pick<BillRowRecord, 'idx' | 'nameRunsJson' | 'namePlain' | 'qty' | 'rate' | 'totalOverride' | 'gstRate' | 'extrasJson' | 'cellStyleJson'>

const billKey = (b: ContentBill): string =>
  JSON.stringify([b.branchId, b.poSeq, b.poNumber, b.partySnapshotJson, b.formatId, b.extraColsJson, b.paperOverride, b.roundOff ?? 0, b.footerExtrasJson ?? '{}', b.tailRowsJson ?? '[]', b.secondTableJson ?? '', b.billDate, b.deletedAt !== null])
const rowKey = (r: ContentRow): string =>
  JSON.stringify([r.idx, r.nameRunsJson, r.namePlain, r.qty, r.rate, r.totalOverride, r.gstRate, r.extrasJson, r.cellStyleJson])

/** True when two copies of a bill say the same thing (so a "conflict" between them would be noise). */
export function sameContent(a: { bill: ContentBill; rows: readonly ContentRow[] }, b: { bill: ContentBill; rows: readonly ContentRow[] }): boolean {
  if (billKey(a.bill) !== billKey(b.bill) || a.rows.length !== b.rows.length) return false
  const ra = [...a.rows].sort((x, y) => x.idx - y.idx), rb = [...b.rows].sort((x, y) => x.idx - y.idx)
  return ra.every((r, i) => rowKey(r) === rowKey(rb[i] as ContentRow))
}

/** What is stored in `audit_log.detail_json` for a conflict (the snapshot is the local version that lost). */
export const conflictDetailSchema = z.object({
  /** Which kind of local change lost. */
  lost: z.enum(['edit', 'delete']),
  loserRevision: z.number().int(),
  loserUpdatedAt: z.string(),
  winnerBranch: z.string(),
  winnerRevision: z.number().int(),
  winnerUpdatedAt: z.string(),
  winnerDeleted: z.boolean(),
  /** `{ bill, rows }` exactly as the local copy was (stored bill record + rows). */
  snapshot: z.unknown()
})
export type ConflictDetail = z.infer<typeof conflictDetailSchema>

/** One row of the conflict list (no snapshot: it can be large). */
export interface ConflictInfo {
  billId: string
  poNumber: string
  at: string
  lost: 'edit' | 'delete'
  loserRevision: number
  loserUpdatedAt: string
  winnerBranch: string
  winnerRevision: number
  winnerUpdatedAt: string
  winnerDeleted: boolean
}

export const dismissConflictSchema = z.object({ billId: z.string().min(1).max(100) }).strict()
