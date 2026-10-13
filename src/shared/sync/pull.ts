import { z } from 'zod'
import { billRecordSchema, billRowRecordSchema } from '../billModel'

/**
 * Phase 56: shared rules of the pull / apply side (docs/SYNC_POSTBOX_SPEC.md section 6). Pure.
 * Phase 57 extends the ordering with conflict recording; the ordering itself is already the final one.
 */
export const PULL_INTERVAL_MS = 30_000
export const PULL_BACKOFF_CAP_MS = 600_000
export const PULL_PAGE_SIZE = 200
export const PULL_MAX_PAGES_PER_RUN = 10
export const PULL_KICK_DELAY_MS = 250
/** A row that cannot be decrypted / applied this many runs in a row is skipped (it stays UNACKNOWLEDGED on the server and is listed in Sync status). */
export const PULL_SKIP_AFTER_ATTEMPTS = 10
export const PULL_SKIPPED_KEEP = 100

/** Wait after `failures` failed runs in a row: 30 s, then doubling, capped at 10 minutes. */
export function pullDelayMs(failures: number): number {
  return pollDelayMs(failures, PULL_INTERVAL_MS)
}

/** Phase 138: the shared-store poll. The doorbell is the fast path; this poll always runs as the backup (docs/SYNC_SHARED_STORE_SPEC.md section 10). */
export const SHARED_POLL_MS = 60_000
/** Phase 138: rings that arrive within this window become ONE pull. */
export const DOORBELL_DEBOUNCE_MS = 500
/** Phase 138: wait before trying the Realtime connection again: 2 s, doubling, never more than 5 minutes. */
export const DOORBELL_RECONNECT_BASE_MS = 2_000
export const DOORBELL_RECONNECT_CAP_MS = 300_000

/** `baseMs` normally, doubling after each failure in a row, capped at 10 minutes (a base above the cap is the cap). */
export function pollDelayMs(failures: number, baseMs: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return baseMs
  return Math.min(baseMs * 2 ** Math.min(Math.trunc(failures), 20), Math.max(PULL_BACKOFF_CAP_MS, baseMs))
}

/** Phase 138: delay before reconnect attempt number `attempt` (0 = the first retry). */
export function doorbellReconnectMs(attempt: number): number {
  const a = Number.isFinite(attempt) && attempt > 0 ? Math.min(Math.trunc(attempt), 20) : 0
  return Math.min(DOORBELL_RECONNECT_BASE_MS * 2 ** a, DOORBELL_RECONNECT_CAP_MS)
}

/** Phase 138: the two plain words the Sync status shows for how changes arrive. */
export type DeliveryMode = 'live' | 'polling'
export const deliveryText = (mode: DeliveryMode): string => (mode === 'live' ? 'Live' : 'Checking every minute')

/** The decrypted payload of a postbox row (built by the push worker, Phase 55). */
export const remoteSnapshotSchema = z.object({
  v: z.literal(1),
  bill: billRecordSchema.omit({ syncState: true }),
  rows: z.array(billRowRecordSchema),
  deleted: z.boolean()
})
export type RemoteSnapshot = z.infer<typeof remoteSnapshotSchema>

export interface VersionStamp { updatedAt: string; revision: number; /** Branch that made this version. */ branchId: string }

/**
 * Deterministic winner (SYNC spec section 6): newer `updatedAt`, else higher `revision`, else the greater branch id.
 * Equal on all three = the same version: the incoming copy does NOT win, so applying a row twice changes nothing.
 * ISO-8601 UTC strings of the same length compare correctly as text; to be safe they are compared as instants first.
 */
export function incomingWins(local: VersionStamp | null, incoming: VersionStamp): boolean {
  if (local === null) return true
  const a = Date.parse(incoming.updatedAt), b = Date.parse(local.updatedAt)
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a > b
  if (incoming.revision !== local.revision) return incoming.revision > local.revision
  return incoming.branchId > local.branchId
}

/** A change that arrived for the bill that is open in the editor; kept aside until the owner decides (never applied under the editor). */
export interface HeldChange {
  billId: string
  poNumber: string
  fromBranch: string
  /** Name of that branch when known. */
  fromBranchName: string | null
  revision: number
  updatedAt: string
  deleted: boolean
}

export type PullBlock = 'idle' | 'offline' | 'no_key' | 'license' | 'not_activated' | 'decrypt' | 'stopped'

export interface PullRunResult {
  /** Rows taken from the postbox and settled (applied, ignored or held). */
  received: number
  applied: number
  ignored: number
  held: number
  /** Rows given up on in this run (kept unacknowledged). */
  skipped: number
  /** Phase 57: of `applied`, how many overwrote a local edit that had not been sent (kept in the audit log, bill marked `conflict`). */
  conflicts: number
  block: PullBlock
}

export interface PullStatus {
  running: boolean
  block: PullBlock
  consecutiveFailures: number
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  appliedTotal: number
  /** Server id of the last row applied. */
  cursor: number
  /** Applied rows whose acknowledgement has not reached the server yet. */
  unacked: number
  /** Rows skipped for good (still on the server, never acknowledged). */
  skipped: { id: number; billId: string | null; error: string }[]
  held: HeldChange[]
}

/** Renderer -> main: which bill is open in the editor (null = none). */
export const editorPayloadSchema = z.object({ billId: z.string().min(1).max(100).nullable() }).strict()
export const resolveHeldSchema = z.object({ billId: z.string().min(1).max(100), choice: z.enum(['keep', 'load']) }).strict()
export type ResolveHeldInput = z.infer<typeof resolveHeldSchema>

/** `bills:remoteChanged` payload. */
export interface RemoteChangedEvent { id: string; /** True when the change was kept aside because the bill is open. */ held: boolean; /** Phase 57: the change replaced an unsent local edit. */ conflict?: true }

// ------------------------------------------------------------------------------------------------------- Phase 135 (shared notebook)

/** Pull side of `docs/SYNC_SHARED_STORE_SPEC.md` section 6: a failing record never blocks the cursor; it is kept and retried, then set aside. */
export const SHARED_PULL_PAGE_SIZE = 200
/** A failed record is dropped into the set-aside list after this many failed runs (same cap as the v1 pull). */
export const SHARED_PULL_FAIL_CAP = PULL_SKIP_AFTER_ATTEMPTS

/** Where the pull cursor goes after the first-sync compare (see `compareService`). Pure. */
export function cursorAfterCompare(current: number, lowestWantedSeq: number | null, highestSeq: number): number {
  const cur = Number.isFinite(current) && current > 0 ? Math.trunc(current) : 0
  // Something still has to be downloaded (or decided by the server): the pull starts just below the lowest such record.
  if (lowestWantedSeq !== null) return Math.max(0, Math.min(cur, Math.trunc(lowestWantedSeq) - 1))
  // Everything on the server is already here or goes up: nothing to pull below the highest sequence seen.
  return Math.max(cur, Math.trunc(highestSeq))
}
