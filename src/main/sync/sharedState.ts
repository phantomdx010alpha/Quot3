import type { SyncStateRepo } from '../db/syncStateRepo'
import type { SharedStoreTransport } from './sharedTransport'
import { CLOCK_REMEASURE_MS } from '../../shared/sync/push'
import { offsetFromServerTime } from '../../shared/sync/diff'

/**
 * Phase 135: the small bits of worker state that live in `sync_state` under the `shared.` prefix (the same prefix as
 * `activationV2`, so `deactivate` can remove them with the rest). Nothing here is secret.
 */
export const SHARED_STATE_KEYS = {
  /** Highest `server_seq` this computer has pulled (a number). */
  cursor: 'shared.cursor',
  /** Offset in ms to ADD to this computer's clock to get server time, and when it was measured. */
  clock: 'shared.clock',
  /** Progress of the first-sync compare (resumable), JSON. */
  compare: 'shared.compare',
  /** ISO time the first-sync compare finished; absent = it has not run to the end yet. */
  compareDone: 'shared.compareDone',
  /** Prefix of the records that failed to apply and wait for a retry: `shared.pullFail.<kind>.<recId>`. */
  pullFail: 'shared.pullFail.'
} as const

export const readCursor = (sync: Pick<SyncStateRepo, 'get'>): number => {
  const n = Number(sync.get(SHARED_STATE_KEYS.cursor))
  return Number.isInteger(n) && n > 0 ? n : 0
}
export const writeCursor = (sync: Pick<SyncStateRepo, 'set'>, seq: number): void => sync.set(SHARED_STATE_KEYS.cursor, String(Math.max(0, Math.trunc(seq))))

interface ClockRecord { offsetMs: number; at: number }

/** The stored offset in ms (0 when never measured) and whether it is the large-skew case that gets the quiet warning. */
export function readClock(sync: Pick<SyncStateRepo, 'get'>): { offsetMs: number | null; at: number } {
  const raw = sync.get(SHARED_STATE_KEYS.clock)
  if (!raw) return { offsetMs: null, at: 0 }
  try {
    const c = JSON.parse(raw) as Partial<ClockRecord>
    return typeof c.offsetMs === 'number' && Number.isFinite(c.offsetMs) ? { offsetMs: c.offsetMs, at: typeof c.at === 'number' ? c.at : 0 } : { offsetMs: null, at: 0 }
  } catch { return { offsetMs: null, at: 0 } }
}

/**
 * Measures the offset against `sn_now()` when none is stored or the stored one is older than `CLOCK_REMEASURE_MS`. A failed measurement
 * keeps the old value (the push still works with the raw clock; the server only uses `edited_at` to decide a conflict).
 */
export async function ensureClockOffset(sync: Pick<SyncStateRepo, 'get' | 'set'>, transport: Pick<SharedStoreTransport, 'now'>, nowMs: () => number): Promise<number | null> {
  const cur = readClock(sync)
  if (cur.offsetMs !== null && nowMs() - cur.at < CLOCK_REMEASURE_MS) return cur.offsetMs
  try {
    const start = nowMs()
    const { serverTime } = await transport.now()
    const end = nowMs()
    const off = offsetFromServerTime(serverTime, start, end)
    if (off === null) return cur.offsetMs
    sync.set(SHARED_STATE_KEYS.clock, JSON.stringify({ offsetMs: off, at: end } satisfies ClockRecord))
    return off
  } catch {
    return cur.offsetMs
  }
}
