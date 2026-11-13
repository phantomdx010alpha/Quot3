import type { Logger } from '../logger'
import { ACTIVITY_CSV_MAX, type PriceActivityAccess, type PriceActivityCsv, type PriceActivityPage, type PriceLogPage, type PriceLogQuery } from '../../shared/pricelist/api'
import type { PriceLogRow } from '../../shared/pricelist/apiLog'
import { activityToCsv } from '../../shared/pricelist/logEntry'
import { SHARED_MESSAGES } from '../../shared/sync/license'
import { AppError } from '../ipc/envelope'
import { sharedToAppError } from '../sync/activationV2'
import { logChangesOf, type PriceLogCalls, type SharedStoreTransport } from '../sync/sharedTransport'

/**
 * Phase 243 (M23): the Price List activity list (MILESTONE23_DESIGN 4.5).
 *  - Shared sync on: the log lives on the server (written inside `sn_push`, author from the login, never from the client) and ONLY seat 1 may read it.
 *  - No shared sync: this PC's own local log (`price_log`) and this PC counts as main [A].
 *  - The view is further gated by the setting `pricelist.log.visible` (recording always runs [A]).
 * The server is the real gate (`qt_price_log_list` answers `Q3P02` to any other seat); this service only says so early, in plain words.
 */
export interface PriceActivityDeps {
  /** The local log (`PriceListService.log` / `trimLog`). */
  local: { log(q?: PriceLogQuery): PriceLogPage }
  syncActive: () => boolean
  seatNo: () => number | null
  connect: () => Promise<{ transport: SharedStoreTransport; creds: { license: string } }>
  settings: () => { logVisible: boolean; logRetentionDays: number }
  log: Pick<Logger, 'info' | 'warn'>
}
export interface PriceActivityService {
  access(): PriceActivityAccess
  list(q?: PriceLogQuery): Promise<PriceActivityPage>
  csv(): Promise<PriceActivityCsv>
  /** Seat 1 only, best effort, never throws: removes server entries older than the retention. Returns how many (0 when it could not run). */
  trimServer(): Promise<number>
}

const hasLog = (t: SharedStoreTransport): t is SharedStoreTransport & PriceLogCalls => typeof (t as Partial<PriceLogCalls>).priceLogList === 'function'
const PAGE = { dflt: 100, max: 500 } as const

export function createPriceActivityService(deps: PriceActivityDeps): PriceActivityService {
  const access = (): PriceActivityAccess => {
    const s = deps.settings()
    const sync = deps.syncActive()
    const canView = !sync || deps.seatNo() === 1
    return { canView, visible: canView && s.logVisible, source: !canView ? null : sync ? 'server' : 'local', retentionDays: s.logRetentionDays }
  }
  const allow = (): 'server' | 'local' => {
    const a = access()
    if (!a.canView || a.source === null) throw new AppError('VALIDATION', SHARED_MESSAGES.seat1_only)
    if (!a.visible) throw new AppError('VALIDATION', 'The activity list is switched off. Switch it on in Settings > Price List > Activity.')
    return a.source
  }
  const door = async (): Promise<{ t: SharedStoreTransport & PriceLogCalls; license: string }> => {
    const c = await deps.connect()
    if (!hasLog(c.transport)) throw new AppError('VALIDATION', 'This connection cannot read the Price List activity.')
    return { t: c.transport, license: c.creds.license }
  }
  const page = async (source: 'server' | 'local', q: PriceLogQuery): Promise<PriceActivityPage> => {
    const limit = Math.max(1, Math.min(PAGE.max, Math.round(q.limit ?? PAGE.dflt)))
    if (source === 'local') {
      const p = deps.local.log(q)
      return { rows: p.rows, ...(p.next !== undefined ? { next: p.next } : {}), source }
    }
    try {
      const { t, license } = await door()
      const got = await t.priceLogList({ license, limit: limit + 1, ...(q.beforeId !== undefined ? { beforeId: q.beforeId } : {}) })
      const rows: PriceLogRow[] = got.slice(0, limit).map((r) => ({
        id: r.id, at: r.at, seatNo: r.seatNo, branchId: r.branchId ?? '', branchName: r.branchName, deviceKind: r.device, entity: r.entity, entityId: r.recId ?? '', op: r.op,
        path: r.path, changes: logChangesOf(r), count: r.count
      }))
      return { rows, ...(got.length > limit && rows.length > 0 ? { next: rows[rows.length - 1]!.id } : {}), source }
    } catch (e) { throw e instanceof AppError ? e : sharedToAppError(e) }
  }

  return {
    access,
    list: async (q = {}) => page(allow(), q),
    async csv() {
      const source = allow()
      const rows: PriceLogRow[] = []
      let before: number | undefined
      let truncated = false
      for (;;) {
        const p = await page(source, { limit: PAGE.max, ...(before !== undefined ? { beforeId: before } : {}) })
        for (const r of p.rows) { if (rows.length >= ACTIVITY_CSV_MAX) { truncated = true; break }; rows.push(r) }
        if (truncated || p.next === undefined) break
        before = p.next
      }
      return { csv: activityToCsv(rows, { bom: true }), count: rows.length, truncated }
    },
    async trimServer() {
      const a = access()
      if (a.source !== 'server') return 0
      try {
        const { t, license } = await door()
        return await t.priceLogTrim({ license, days: a.retentionDays })
      } catch (e) {
        deps.log.info('The shared Price List activity could not be trimmed', { error: e instanceof Error ? e.message : 'unknown' })
        return 0
      }
    }
  }
}
