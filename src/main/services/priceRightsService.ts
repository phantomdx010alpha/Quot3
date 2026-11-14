import type { SyncStateRepo } from '../db/syncStateRepo'
import type { Logger } from '../logger'
import type { PriceRightsInfo, PriceSeatRightsRow } from '../../shared/pricelist/api'
import { AUTO_REFRESH_MS, REFUSED_REFRESH_MS, autoRefreshDue, effectiveFlags, flagsToStore, normalizeFlags, refusedNeeds, type PermFlags } from '../../shared/pricelist/perms'
import { SHARED_MESSAGES } from '../../shared/sync/license'
import { AppError } from '../ipc/envelope'
import { sharedToAppError } from '../sync/activationV2'
import { readRefused } from '../sync/pushWorkerV2'
import type { PriceRightsCalls, SharedStoreTransport } from '../sync/sharedTransport'

/**
 * Phase 242 (M23): who may edit the Price List on THIS PC (MILESTONE23_DESIGN 4.4).
 *  - No shared sync = full rights (this PC is the only one). Seat 1 = full rights, always.
 *  - Another seat has what seat 1 granted: the last answer of the server is cached in `sync_state` (`pricelist.perms`), so a PC that is
 *    offline keeps working with the last known rights. A seat that has never heard from the server has NO rights until `refresh()` succeeds [A].
 *  - `list` / `set` are for seat 1 only (the server enforces it too: `Q3P02`).
 * The server is the real gate (`sn_push` refuses with `Q3P01`); this service only lets the screen and the local guard say so early.
 */
export const PERMS_STATE_KEY = 'pricelist.perms'
/** Phase 255: the LAST ASK (when, and why it failed), so a failed refresh is never silent. `{ at, error }`. */
export const PERMS_STATUS_KEY = 'pricelist.permsStatus'
export { AUTO_REFRESH_MS, REFUSED_REFRESH_MS }

export interface PriceRightsDeps {
  sync: Pick<SyncStateRepo, 'get' | 'set'>
  syncActive: () => boolean
  /** The seat number the server gave this PC (null until shared sync is activated). */
  seatNo: () => number | null
  /** `activationV2.connect()`. */
  connect: () => Promise<{ transport: SharedStoreTransport; creds: { license: string } }>
  log: Pick<Logger, 'info' | 'warn'>
}
export interface PriceRightsService {
  /** This PC's rights right now (instant, never throws). */
  own(): PermFlags
  info(): PriceRightsInfo
  /** Asks the server for this seat's rights and caches them. A network failure keeps the cached answer; never throws. */
  refresh(): Promise<PriceRightsInfo>
  /** Phase 255: the automatic refresh (app start / after each sync cycle / after a refused push). Throttled, never throws, no-op for seat 1 and without sync. */
  auto(afterRefused: boolean): Promise<void>
  list(): Promise<PriceSeatRightsRow[]>
  set(seatNo: number, flags: unknown): Promise<PriceSeatRightsRow>
}

interface Cached { seatNo: number; flags: PermFlags; at: string }

const hasRights = (t: SharedStoreTransport): t is SharedStoreTransport & PriceRightsCalls => typeof (t as Partial<PriceRightsCalls>).pricePermsGet === 'function'

export function createPriceRightsService(deps: PriceRightsDeps, opts: { now?: () => Date } = {}): PriceRightsService {
  const now = opts.now ?? (() => new Date())

  const cached = (): Cached | null => {
    const raw = deps.sync.get(PERMS_STATE_KEY)
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as Partial<Cached>
      return typeof v.seatNo === 'number' ? { seatNo: v.seatNo, flags: normalizeFlags(v.flags), at: typeof v.at === 'string' ? v.at : '' } : null
    } catch { return null }
  }
  const status = (): { at: string; error: string } => {
    const raw = deps.sync.get(PERMS_STATUS_KEY)
    if (!raw) return { at: '', error: '' }
    try {
      const v = JSON.parse(raw) as { at?: unknown; error?: unknown }
      return { at: typeof v.at === 'string' ? v.at : '', error: typeof v.error === 'string' ? v.error.slice(0, 300) : '' }
    } catch { return { at: '', error: '' } }
  }
  const setStatus = (error: string): void => deps.sync.set(PERMS_STATUS_KEY, JSON.stringify({ at: now().toISOString(), error }))
  const own = (): PermFlags => {
    const seat = deps.seatNo()
    const c = cached()
    return effectiveFlags(seat, c !== null && c.seatNo === seat ? c.flags : undefined, deps.syncActive())
  }
  const info = (): PriceRightsInfo => {
    const seatNo = deps.seatNo()
    const syncActive = deps.syncActive()
    const st = status()
    const c = cached()
    const kept = readRefused(deps.sync)
    return {
      seatNo, syncActive, isSeat1: syncActive && seatNo === 1, flags: own(), refused: kept.length, refusedNeeds: refusedNeeds(kept),
      checkedAt: st.at === '' ? null : st.at, answeredAt: c !== null && c.at !== '' ? c.at : null, lastError: st.error
    }
  }
  const seat1Only = (): void => {
    if (!deps.syncActive()) throw new AppError('VALIDATION', 'Rights are only used when shared sync is on. Without sync this computer can change everything.')
    if (deps.seatNo() !== 1) throw new AppError('VALIDATION', SHARED_MESSAGES.seat1_only)
  }
  const door = async (): Promise<{ t: SharedStoreTransport & PriceRightsCalls; license: string }> => {
    const c = await deps.connect()
    if (!hasRights(c.transport)) throw new AppError('VALIDATION', 'This connection cannot read Price List rights.')
    return { t: c.transport, license: c.creds.license }
  }

  const refresh = async (): Promise<PriceRightsInfo> => {
    if (!deps.syncActive()) return info()
    try {
      const { t, license } = await door()
      const r = await t.pricePermsGet({ license })
      deps.sync.set(PERMS_STATE_KEY, JSON.stringify({ seatNo: r.seatNo, flags: r.flags, at: now().toISOString() } satisfies Cached))
      const seat = deps.seatNo()
      // [A] The server's seat number differs from the one this PC stored: the cache is ignored (own() never grants locally), so say it.
      setStatus(seat !== null && r.seatNo !== seat ? `The main branch says this PC is seat ${r.seatNo}, but this PC has seat ${seat} stored. Sign in to shared sync again.` : '')
    } catch (e) {
      // Phase 255: the last good flags stay, and the reason is KEPT (it used to be an info line nobody saw).
      const msg = e instanceof AppError ? e.message : sharedToAppError(e).message
      setStatus(msg === '' ? 'The main branch could not be reached.' : msg)
      deps.log.info('The Price List rights could not be refreshed; the last known rights stay', { error: e instanceof Error ? e.message : 'unknown' })
    }
    return info()
  }

  return {
    own,
    info,
    refresh,
    async auto(afterRefused) {
      if (!deps.syncActive() || deps.seatNo() === 1) return
      if (!autoRefreshDue(status().at, now().getTime(), afterRefused)) return
      await refresh()
    },
    async list() {
      seat1Only()
      try {
        const { t, license } = await door()
        return (await t.pricePermsList({ license })).map((r) => ({ seatNo: r.seatNo, branchName: r.branchName, updatedAt: r.updatedAt, flags: r.flags }))
      } catch (e) { throw e instanceof AppError ? e : sharedToAppError(e) }
    },
    async set(seatNo, flags) {
      seat1Only()
      if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 50) throw new AppError('VALIDATION', 'That seat number is not valid.')
      try {
        const { t, license } = await door()
        const r = await t.pricePermsSet({ license, seatNo, flags: flagsToStore(seatNo, flags) })
        return { seatNo: r.seatNo, branchName: null, updatedAt: now().toISOString(), flags: r.flags }
      } catch (e) { throw e instanceof AppError ? e : sharedToAppError(e) }
    }
  }
}
