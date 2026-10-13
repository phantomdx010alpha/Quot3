/**
 * Phase 54: shared shapes of the local change outbox (docs/SYNC_POSTBOX_SPEC.md section 5). Pure.
 * One row says "bill X changed to revision N (or was deleted)". The snapshot is NOT stored: the push worker (Phase 55)
 * builds it from the bill as it is at push time, so a row never holds a stale copy of a bill.
 */
export type OutboxOp = 'upsert' | 'delete'
export type OutboxState = 'pending' | 'synced' | 'failed'
/** A row that failed this many times stops retrying by itself and shows in Sync status (spec section 6). */
export const OUTBOX_MAX_ATTEMPTS = 10
/** Already-sent rows are only a short audit trail; older ones are removed when the next change is captured. */
export const OUTBOX_KEEP_SYNCED_DAYS = 7
/** The Sync status screen lists at most this many rows per group. */
export const OUTBOX_LIST_LIMIT = 50

export interface OutboxItem {
  id: number
  billId: string
  /** PO number of the bill, or null when the bill no longer exists (purged). */
  poNumber: string | null
  op: OutboxOp
  revision: number
  createdAt: string
  attempts: number
  lastError: string | null
  state: OutboxState
}

export interface OutboxCounts { pending: number; failed: number; synced: number }

export interface OutboxStatus {
  /** Changes are captured only while a license is activated on this computer. */
  capturing: boolean
  counts: OutboxCounts
  /** Time of the oldest change still waiting to go out, or null. */
  oldestPendingAt: string | null
  pending: OutboxItem[]
  failed: OutboxItem[]
}

/** What the bill / trash services tell the outbox from inside their transaction. */
export interface OutboxChange { billId: string; revision: number; op: OutboxOp }
