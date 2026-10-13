import type Database from 'better-sqlite3'
import { OUTBOX_LIST_LIMIT, OUTBOX_MAX_ATTEMPTS, type OutboxCounts, type OutboxItem, type OutboxOp, type OutboxState } from '../../shared/sync/outbox'

/** Phase 54: the only SQL for `sync_outbox` and for `bills.sync_state`. Every write is a single statement or runs inside the caller's transaction. */
export interface OutboxRepo {
  /**
   * Records one change. Older rows of the same bill that have not been sent (pending or failed) are removed: the newer row
   * supersedes them because the snapshot is built at push time. Sent rows older than `keepSyncedBefore` are pruned.
   * Marks the bill `pending`. Must be called inside the bill transaction.
   */
  enqueue(c: { billId: string; op: OutboxOp; revision: number; at: string; keepSyncedBefore: string }): number
  /** Phase 88: many NEW bills at once (one prune, prepared statements reused). Same rules as `enqueue`. Inside the caller's transaction. */
  enqueueMany(items: readonly { billId: string; op: OutboxOp; revision: number }[], at: string, keepSyncedBefore: string): number
  /** Oldest first. `limit` is clamped to 1..500. */
  pending(limit: number): OutboxItem[]
  counts(): OutboxCounts
  oldestPendingAt(): string | null
  list(state: OutboxState, limit?: number): OutboxItem[]
  /** Marks the row sent, and the bill `synced` unless it has other unsent rows or is in `conflict`. */
  markSynced(id: number): void
  /** Counts one failed attempt; at `OUTBOX_MAX_ATTEMPTS` the row becomes `failed`. Returns the new state. */
  markAttempt(id: number, error: string): OutboxState
  /** Phase 135: the unsent rows of one bill / rule are settled (a received version replaced the local one; the local one stays as a revision). Returns how many. */
  dropUnsent(billId: string): number
  /** Failed rows go back to pending with a fresh attempt count. Returns how many. */
  retryFailed(ids?: number[]): number
  transaction<T>(fn: () => T): T
}

const COLS = `o.id, o.bill_id AS billId, (SELECT po_number FROM bills b WHERE b.id = o.bill_id) AS poNumber, o.op, o.revision,
  o.created_at AS createdAt, o.attempts, o.last_error AS lastError, o.state`

export function createOutboxRepo(sqlite: Database.Database): OutboxRepo {
  const dropOlder = sqlite.prepare("DELETE FROM sync_outbox WHERE bill_id = ? AND state IN ('pending', 'failed')")
  const pruneSynced = sqlite.prepare("DELETE FROM sync_outbox WHERE state = 'synced' AND created_at < ?")
  const insert = sqlite.prepare("INSERT INTO sync_outbox (bill_id, op, revision, created_at, state) VALUES (?, ?, ?, ?, 'pending')")
  const markBill = sqlite.prepare("UPDATE bills SET sync_state = 'pending' WHERE id = ?")
  const pendingStmt = sqlite.prepare(`SELECT ${COLS} FROM sync_outbox o WHERE o.state = 'pending' ORDER BY o.id LIMIT ?`)
  const listStmt = sqlite.prepare(`SELECT ${COLS} FROM sync_outbox o WHERE o.state = ? ORDER BY o.id LIMIT ?`)
  const countStmt = sqlite.prepare('SELECT state, COUNT(*) AS n FROM sync_outbox GROUP BY state')
  const oldestStmt = sqlite.prepare("SELECT MIN(created_at) AS at FROM sync_outbox WHERE state = 'pending'")
  const getStmt = sqlite.prepare('SELECT bill_id AS billId, attempts FROM sync_outbox WHERE id = ?')
  const sentStmt = sqlite.prepare("UPDATE sync_outbox SET state = 'synced', last_error = NULL WHERE id = ?")
  const billSynced = sqlite.prepare(
    `UPDATE bills SET sync_state = 'synced' WHERE id = ? AND sync_state = 'pending'
       AND NOT EXISTS (SELECT 1 FROM sync_outbox WHERE bill_id = ? AND state IN ('pending', 'failed'))`
  )
  const attemptStmt = sqlite.prepare('UPDATE sync_outbox SET attempts = ?, last_error = ?, state = ? WHERE id = ?')
  const retryAll = sqlite.prepare("UPDATE sync_outbox SET state = 'pending', attempts = 0 WHERE state = 'failed'")
  const retryOne = sqlite.prepare("UPDATE sync_outbox SET state = 'pending', attempts = 0 WHERE state = 'failed' AND id = ?")
  const dropUnsentStmt = sqlite.prepare("UPDATE sync_outbox SET state = 'synced', last_error = NULL WHERE bill_id = ? AND state IN ('pending', 'failed')")
  const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(Math.trunc(n), lo), hi)

  return {
    enqueue(c) {
      dropOlder.run(c.billId)
      pruneSynced.run(c.keepSyncedBefore)
      const id = Number(insert.run(c.billId, c.op, c.revision, c.at).lastInsertRowid)
      markBill.run(c.billId)
      return id
    },
    enqueueMany(items, at, keepSyncedBefore) {
      pruneSynced.run(keepSyncedBefore)
      for (const c of items) {
        dropOlder.run(c.billId)
        insert.run(c.billId, c.op, c.revision, at)
        markBill.run(c.billId)
      }
      return items.length
    },
    pending: (limit) => pendingStmt.all(clamp(limit, 1, 500)) as OutboxItem[],
    counts() {
      const out: OutboxCounts = { pending: 0, failed: 0, synced: 0 }
      for (const r of countStmt.all() as { state: OutboxState; n: number }[]) if (r.state in out) out[r.state] = r.n
      return out
    },
    oldestPendingAt: () => (oldestStmt.get() as { at: string | null }).at,
    list: (state, limit = OUTBOX_LIST_LIMIT) => listStmt.all(state, clamp(limit, 1, 500)) as OutboxItem[],
    markSynced: sqlite.transaction((id: number) => {
      const row = getStmt.get(id) as { billId: string } | undefined
      if (!row) return
      sentStmt.run(id)
      billSynced.run(row.billId, row.billId)
    }),
    markAttempt: sqlite.transaction((id: number, error: string): OutboxState => {
      const row = getStmt.get(id) as { attempts: number } | undefined
      if (!row) return 'failed'
      const attempts = row.attempts + 1
      const state: OutboxState = attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending'
      attemptStmt.run(attempts, error.slice(0, 300), state, id)
      return state
    }),
    dropUnsent: (billId) => dropUnsentStmt.run(billId).changes,
    retryFailed(ids) {
      if (ids === undefined) return retryAll.run().changes
      return sqlite.transaction(() => ids.reduce((n, id) => n + retryOne.run(id).changes, 0))()
    },
    transaction: (fn) => sqlite.transaction(fn)()
  }
}
