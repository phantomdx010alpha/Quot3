import type { OutboxRepo } from '../db/outboxRepo'
import { OUTBOX_KEEP_SYNCED_DAYS, OUTBOX_LIST_LIMIT, type OutboxChange, type OutboxStatus } from '../../shared/sync/outbox'

/**
 * Phase 54 - local change capture. `capture` is the hook the bill and trash services call INSIDE their own SQLite
 * transaction, so the outbox row and the bill change commit together or not at all (a crash cannot lose a change and a
 * rollback leaves no row). While no license is activated nothing is captured and bills stay `local_only`.
 * Bills that existed before activation are NOT queued: a new branch gets history from a backup import (Phase 58).
 */
export interface Outbox {
  capture(change: OutboxChange): void
  /** Phase 88: the bulk form (imported bills); same no-op while sync is off. Call inside the caller's transaction. */
  captureMany(changes: readonly OutboxChange[]): void
  status(): OutboxStatus
  /** For the push worker (Phase 55). */
  repo: OutboxRepo
}

export function createOutbox(deps: { repo: OutboxRepo; capturing: () => boolean }, opts: { now?: () => Date } = {}): Outbox {
  const now = opts.now ?? (() => new Date())
  const { repo } = deps
  return {
    repo,
    capture(c) {
      if (!deps.capturing()) return
      const at = now()
      repo.enqueue({
        billId: c.billId, op: c.op, revision: c.revision, at: at.toISOString(),
        keepSyncedBefore: new Date(at.getTime() - OUTBOX_KEEP_SYNCED_DAYS * 86_400_000).toISOString()
      })
    },
    captureMany(list) {
      if (!deps.capturing() || list.length === 0) return
      const at = now()
      repo.enqueueMany(list, at.toISOString(), new Date(at.getTime() - OUTBOX_KEEP_SYNCED_DAYS * 86_400_000).toISOString())
    },
    status() {
      return {
        capturing: deps.capturing(),
        counts: repo.counts(),
        oldestPendingAt: repo.oldestPendingAt(),
        pending: repo.list('pending', OUTBOX_LIST_LIMIT),
        failed: repo.list('failed', OUTBOX_LIST_LIMIT)
      }
    }
  }
}
