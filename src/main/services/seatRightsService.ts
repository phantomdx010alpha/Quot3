import type { SyncStateRepo } from '../db/syncStateRepo'
import type { Logger } from '../logger'
import { SEAT_RIGHT_FLAGS, normalizeSeatFlags, seatFlagsToStore, type SeatRightsRow } from '../../shared/seatRights'
import { SHARED_MESSAGES } from '../../shared/sync/license'
import { AppError } from '../ipc/envelope'
import { sharedToAppError } from '../sync/activationV2'
import { SharedTransportError, type SeatRightsCalls, type SharedStoreTransport } from '../sync/sharedTransport'

/**
 * Phase 286 (M25): seat 1 reads and sets the PHONE rights of every seat (API_CONTRACTS M25-4 / M25-7). Desktop only: the desktop itself is never
 * restricted by these flags (owner decision D4). The flags hide and block IN THE APP; real server-side withholding is not part of M25.
 *  - `list` / `set` are seat 1 only (a non-seat-1 caller gets `seat1_only`; the server enforces it too: `Q3P02`).
 *  - A company project without SQL 23 answers `not_available` ("Ask the owner to run SQL file 23.").
 *  - The last good list is cached in `sync_state` (`seatRights.list`), so the panel can still say what was last seen while offline.
 */
export const SEAT_RIGHTS_CACHE_KEY = 'seatRights.list'
export const NOT_AVAILABLE_TEXT = 'This company database has no phone rights yet. Ask the owner to run SQL file 23.'

export interface SeatRightsDeps {
  sync: Pick<SyncStateRepo, 'get' | 'set'>
  syncActive: () => boolean
  /** The seat number the server gave this PC (null until shared sync is activated). */
  seatNo: () => number | null
  /** `activationV2.connect()`. */
  connect: () => Promise<{ transport: SharedStoreTransport; creds: { license: string } }>
  log: Pick<Logger, 'info' | 'warn'>
}
export interface SeatRightsService {
  /** Every seat with its phone rights (seat 1 only). Caches the answer. */
  list(): Promise<SeatRightsRow[]>
  /** Store one seat's rights (seat 1 only; seat 1's own row stays all on). */
  set(seatNo: number, flags: unknown): Promise<SeatRightsRow>
  /** The last list this PC got from the server, or null. Never throws. */
  cached(): { rows: SeatRightsRow[]; at: string } | null
}

const hasRights = (t: SharedStoreTransport): t is SharedStoreTransport & SeatRightsCalls => typeof (t as Partial<SeatRightsCalls>).seatRightsList === 'function'

export function createSeatRightsService(deps: SeatRightsDeps, opts: { now?: () => Date } = {}): SeatRightsService {
  const now = opts.now ?? (() => new Date())

  const seat1Only = (): void => {
    if (!deps.syncActive()) throw new AppError('VALIDATION', 'Phone rights are only used when shared sync is on. Without sync every phone has everything.')
    if (deps.seatNo() !== 1) throw new AppError('seat1_only', SHARED_MESSAGES.seat1_only.replace('who may edit the Price List', 'the phone rights'))
  }
  const door = async (): Promise<{ t: SharedStoreTransport & SeatRightsCalls; license: string }> => {
    const c = await deps.connect()
    if (!hasRights(c.transport)) throw new AppError('not_available', NOT_AVAILABLE_TEXT)
    return { t: c.transport, license: c.creds.license }
  }
  const fail = (e: unknown): AppError => {
    if (e instanceof AppError) return e
    if (e instanceof SharedTransportError) {
      if (e.kind === 'not_installed') return new AppError('not_available', NOT_AVAILABLE_TEXT)
      if (e.kind === 'seat1_only') return new AppError('seat1_only', 'Only the main branch (seat 1) can see or change the phone rights.')
    }
    return sharedToAppError(e)
  }
  const sane = (r: SeatRightsRow): SeatRightsRow => ({ seatNo: r.seatNo, branchName: r.branchName ?? null, flags: normalizeSeatFlags(r.flags), configured: r.configured === true, updatedAt: r.updatedAt ?? null })

  const cached = (): { rows: SeatRightsRow[]; at: string } | null => {
    const raw = deps.sync.get(SEAT_RIGHTS_CACHE_KEY)
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as { rows?: unknown; at?: unknown }
      if (!Array.isArray(v.rows) || typeof v.at !== 'string') return null
      return { rows: v.rows.filter((r): r is SeatRightsRow => typeof r === 'object' && r !== null && Number.isInteger((r as SeatRightsRow).seatNo)).map(sane), at: v.at }
    } catch { return null }
  }

  return {
    cached,
    async list() {
      seat1Only()
      try {
        const { t, license } = await door()
        const rows = (await t.seatRightsList({ license })).map(sane)
        deps.sync.set(SEAT_RIGHTS_CACHE_KEY, JSON.stringify({ rows, at: now().toISOString() }))
        return rows
      } catch (e) {
        deps.log.info('The phone rights list could not be read', { kind: e instanceof SharedTransportError ? e.kind : 'other' })
        throw fail(e)
      }
    },
    async set(seatNo, flags) {
      seat1Only()
      if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 50) throw new AppError('VALIDATION', 'That seat number is not valid.')
      if (typeof flags !== 'object' || flags === null || Array.isArray(flags) || !SEAT_RIGHT_FLAGS.every((f) => typeof (flags as Record<string, unknown>)[f] === 'boolean')) {
        throw new AppError('VALIDATION', 'The rights were not complete. Try again.')
      }
      try {
        const { t, license } = await door()
        const r = await t.seatRightsSet({ license, seatNo, flags: seatFlagsToStore(seatNo, flags) })
        const row: SeatRightsRow = { seatNo: r.seatNo, branchName: null, flags: normalizeSeatFlags(r.flags), configured: true, updatedAt: now().toISOString() }
        // keep the cache in step (best effort)
        const c = cached()
        if (c) deps.sync.set(SEAT_RIGHTS_CACHE_KEY, JSON.stringify({ rows: c.rows.map((x) => (x.seatNo === row.seatNo ? { ...row, branchName: x.branchName } : x)), at: c.at }))
        return row
      } catch (e) { throw fail(e) }
    }
  }
}
