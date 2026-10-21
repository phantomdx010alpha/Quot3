import type { PhoneDb } from '../data/db'
import { getMetaValue, setMetaValue } from '../data/metaRepo'
import { CLOCK_REMEASURE_MS } from '../../shared/sync/push'
import { getRaw, setRaw, SYNC_META } from './syncMeta'
import type { PhoneSyncPort } from './transport'

/** Spec section 6: over 2 minutes of skew shows a quiet warning. */
export const CLOCK_WARN_MS = 2 * 60 * 1000

/**
 * Server time minus the phone's clock, in milliseconds. The server answered somewhere between our send and receive time, so the phone's
 * reference is the midpoint of the round trip (cancels most of the network delay). Never a money value.
 */
export async function measureClockOffset(port: Pick<PhoneSyncPort, 'now'>, nowMs: () => number = Date.now): Promise<number> {
  const t0 = nowMs()
  const { serverTime } = await port.now()
  const t1 = nowMs()
  const server = Date.parse(serverTime)
  if (!Number.isFinite(server)) throw new Error('The server clock was not a valid time.')
  return Math.round(server - (t0 + t1) / 2)
}

/** Measures and stores `clock_offset_ms`. Returns the offset. A failed measurement leaves the stored value alone (the caller decides what to say). */
export async function refreshClockOffset(db: PhoneDb, port: Pick<PhoneSyncPort, 'now'>, nowMs: () => number = Date.now): Promise<number> {
  const offset = await measureClockOffset(port, nowMs)
  await setMetaValue(db, 'clock_offset_ms', offset)
  return offset
}

/** The phone's clock corrected by the stored offset, as an ISO string: the `edited_at` the push worker (Phase 179) will send. */
export async function correctedNowIso(db: PhoneDb, nowMs: () => number = Date.now): Promise<string> {
  const off = await getMetaValue(db, 'clock_offset_ms')
  return new Date(nowMs() + off).toISOString()
}

export const isClockSkewLarge = (offsetMs: number): boolean => Math.abs(offsetMs) > CLOCK_WARN_MS

export function clockWarning(offsetMs: number): string | null {
  if (!isClockSkewLarge(offsetMs)) return null
  const mins = Math.round(Math.abs(offsetMs) / 60000)
  return `This phone's clock is about ${mins} minutes ${offsetMs > 0 ? 'behind' : 'ahead of'} the server. Bills still sync correctly, but check the date and time in the phone's settings.`
}

/**
 * Phase 179: the stored offset, measured again when none was measured yet or the measurement is older than `CLOCK_REMEASURE_MS` (spec section 6).
 * A failed measurement keeps the old value (a push still works with the corrected-by-zero clock; the server only uses `edited_at` to decide a conflict).
 * Returns null while the offset was never measured.
 */
export async function ensureClockOffset(db: PhoneDb, port: Pick<PhoneSyncPort, 'now'>, nowMs: () => number = Date.now): Promise<number | null> {
  const at = await getRaw<number>(db, SYNC_META.clockAt, 0)
  const stored = await getMetaValue(db, 'clock_offset_ms')
  if (at > 0 && nowMs() - at < CLOCK_REMEASURE_MS) return stored
  try {
    const off = await measureClockOffset(port, nowMs)
    await setMetaValue(db, 'clock_offset_ms', off)
    await setRaw(db, SYNC_META.clockAt, nowMs())
    return off
  } catch {
    return at > 0 ? stored : null
  }
}
