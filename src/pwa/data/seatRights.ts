/** Phone per-seat rights (Phase 288, M25-4 / M25-7). Pure rules live in `shared/seatRights`; this file holds two small `meta` rows:
 *  - `seatrights.cache`  the LAST server answer for this seat `{ seatNo, flags, configured, at }` (an offline phone keeps it);
 *  - `seatrights.status` the last ASK `{ serverKnows, at, error }` (`serverKnows: 'no'` = the company database has no SQL 23; asked again at most once per 24 h).
 *  The flags hide and block IN THE APP only (honest limit). Data only: nothing here executes a record. */
import {
  canDo, effectiveRights, normalizeSeatFlags, seatNeedsWord, type SeatFlag, type SeatFlags, type SeatRightsSource, type ServerKnowsRights
} from '../../shared/seatRights'
import { getRecord, putRecord, type PhoneDb } from './db'

export const SEAT_RIGHTS_CACHE_KEY = 'seatrights.cache'
export const SEAT_RIGHTS_STATUS_KEY = 'seatrights.status'
/** An "unaware" server is asked again at most once per day. */
export const UNAWARE_RECHECK_MS = 24 * 60 * 60 * 1000

interface MetaRow { key: string; value: unknown }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface CachedSeatRights { seatNo: number; flags: SeatFlags; configured: boolean; at: string }
export function parseCachedSeatRights(raw: unknown): CachedSeatRights | null {
  if (!isObj(raw) || typeof raw.seatNo !== 'number' || !Number.isInteger(raw.seatNo) || raw.seatNo < 1) return null
  return { seatNo: raw.seatNo, flags: normalizeSeatFlags(raw.flags), configured: raw.configured === true, at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '' }
}
export async function readCachedSeatRights(db: PhoneDb): Promise<CachedSeatRights | null> {
  return parseCachedSeatRights((await getRecord<MetaRow>(db, 'meta', SEAT_RIGHTS_CACHE_KEY))?.value)
}
export async function writeCachedSeatRights(db: PhoneDb, answer: { seatNo: number; flags: unknown; configured: boolean }, at: string): Promise<void> {
  if (!db.canWrite()) return
  await putRecord(db, 'meta', { key: SEAT_RIGHTS_CACHE_KEY, value: { seatNo: answer.seatNo, flags: normalizeSeatFlags(answer.flags), configured: answer.configured === true, at } satisfies CachedSeatRights } satisfies MetaRow)
}

export interface RightsStatus { serverKnows: ServerKnowsRights; at: string; error: string }
export function parseRightsStatus(raw: unknown): RightsStatus {
  if (!isObj(raw)) return { serverKnows: 'unknown', at: '', error: '' }
  const k = raw.serverKnows
  return { serverKnows: k === 'yes' || k === 'no' ? k : 'unknown', at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : '', error: typeof raw.error === 'string' ? raw.error.slice(0, 300) : '' }
}
export async function readRightsStatus(db: PhoneDb): Promise<RightsStatus> {
  return parseRightsStatus((await getRecord<MetaRow>(db, 'meta', SEAT_RIGHTS_STATUS_KEY))?.value)
}
export async function writeRightsStatus(db: PhoneDb, s: RightsStatus): Promise<void> {
  if (!db.canWrite()) return
  await putRecord(db, 'meta', { key: SEAT_RIGHTS_STATUS_KEY, value: { serverKnows: s.serverKnows, at: s.at, error: s.error.slice(0, 300) } satisfies RightsStatus } satisfies MetaRow)
}

export interface SeatRightsSnapshot { flags: SeatFlags; source: SeatRightsSource; checkedAt: string | null }

/** The one place the contract table meets the stored rows. `seatHint` = a seat number learned elsewhere (the Price List answer) for a phone with no rights answer. */
export function resolveSeatRights(i: { linked: boolean; cached: CachedSeatRights | null; status: RightsStatus; seatHint?: number | null }): SeatRightsSnapshot {
  const seatNo = i.cached?.seatNo ?? i.seatHint ?? null
  const checkedAt = i.status.at === '' ? null : i.status.at
  const base = { seatNo, linked: i.linked }
  if (!i.linked) return { flags: effectiveRights({ ...base, granted: undefined, configured: null, serverKnows: 'unknown' }), source: 'not_linked', checkedAt }
  if (seatNo === 1) return { flags: effectiveRights({ ...base, granted: undefined, configured: null, serverKnows: 'unknown' }), source: 'seat1', checkedAt }
  if (i.status.serverKnows === 'no') return { flags: effectiveRights({ ...base, granted: undefined, configured: null, serverKnows: 'no' }), source: 'server_unaware', checkedAt }
  if (i.cached === null || i.status.serverKnows !== 'yes') return { flags: effectiveRights({ ...base, granted: undefined, configured: null, serverKnows: 'unknown' }), source: 'unknown_staff', checkedAt }
  const flags = effectiveRights({ ...base, granted: i.cached.flags, configured: i.cached.configured, serverKnows: 'yes' })
  if (!i.cached.configured) return { flags, source: 'default_staff', checkedAt }
  return { flags, source: i.status.error !== '' ? 'cached_offline' : 'admin', checkedAt }
}

/** Is a new ask due? Normal: at most once a minute (10 s after a refusal / a ring); an unaware server at most once per 24 h; `force` always. */
export function seatRightsAskDue(status: RightsStatus, nowMs: number, o: { force?: boolean; afterRefused?: boolean; autoMs: number; refusedMs: number }): boolean {
  if (o.force === true) return true
  const last = Date.parse(status.at)
  if (!Number.isFinite(last)) return true
  if (status.serverKnows === 'no') return nowMs - last >= UNAWARE_RECHECK_MS
  return nowMs - last >= (o.afterRefused === true ? o.refusedMs : o.autoMs)
}

// ---- the live snapshot every screen reads (a tiny store; `useSeatRights` subscribes) ----------------------------------------

export const EVERYTHING_SNAPSHOT: SeatRightsSnapshot = resolveSeatRights({ linked: false, cached: null, status: { serverKnows: 'unknown', at: '', error: '' } })
let current: SeatRightsSnapshot = EVERYTHING_SNAPSHOT
const listeners = new Set<() => void>()
export const getSeatRightsSnapshot = (): SeatRightsSnapshot => current
export function publishSeatRights(s: SeatRightsSnapshot): void {
  const same = current.source === s.source && current.checkedAt === s.checkedAt && Object.keys(s.flags).every((k) => current.flags[k as keyof SeatFlags] === s.flags[k as keyof SeatFlags])
  if (same) return
  current = s
  for (const cb of [...listeners]) cb()
}
export function subscribeSeatRights(cb: () => void): () => void { listeners.add(cb); return () => void listeners.delete(cb) }

// ---- the code-level refusal (Phase 290, M25-5: "hidden AND refused in code, so no path bypasses the screen") ------------------

/** Thrown by a repo / data function when this phone's rights do not allow it. The screen shows `message` (plain words). */
export class RightsRefusedError extends Error {
  readonly code = 'RIGHTS_REFUSED' as const
  constructor(readonly flag: SeatFlag, what: string, message?: string) {
    super(message ?? `This phone is not allowed to ${what} (${seatNeedsWord(flag)}).`)
    this.name = 'RightsRefusedError'
  }
}
/** Throws `RightsRefusedError` when the LIVE snapshot has the flag off. Not linked / old server / seat 1 = everything, so nothing changes for them. */
export function assertSeatRight(flag: SeatFlag, what: string, flags: Readonly<SeatFlags> = current.flags, message?: string): void {
  if (!canDo(flags, flag)) throw new RightsRefusedError(flag, what, message)
}
