import type Database from 'better-sqlite3'
import type { DeviceKind, LogChange, LogEntity, LogOp, PriceLogEntry } from '../../shared/pricelist/logEntry'
import type { PriceLogRow } from '../../shared/pricelist/apiLog'

/**
 * The only SQL for `price_log` (Phase 236): the LOCAL Price List activity log (never synced; the shared log is server-side in Phase 240).
 * Same conventions as `auditRepo`: ISO-8601 `at`, newest first, keyset paging by `beforeId`, retention trim by cutoff.
 * The entry's `changes`, `count` and `deviceKind` live in `after_json`; `before_json` is unused for now (reserved).
 */
export type { PriceLogRow } from '../../shared/pricelist/apiLog'
interface Raw { id: number; at: string; seatNo: number | null; branchId: string; entity: string; entityId: string; op: string; path: string; afterJson: string | null }
const parse = (r: Raw): PriceLogRow => {
  let extra: { deviceKind?: DeviceKind; changes?: LogChange[] | null; count?: number } = {}
  try { extra = r.afterJson ? (JSON.parse(r.afterJson) as typeof extra) : {} } catch { /* a damaged row still lists */ }
  return {
    id: r.id, at: r.at, seatNo: r.seatNo, branchId: r.branchId, deviceKind: extra.deviceKind === 'phone' ? 'phone' : 'pc',
    entity: r.entity as LogEntity, entityId: r.entityId, op: r.op as LogOp, path: r.path, changes: extra.changes ?? null, count: extra.count ?? 1
  }
}

export function createPriceLogRepo(sqlite: Database.Database) {
  const insertStmt = sqlite.prepare(
    'INSERT INTO price_log (at, seat_no, branch_id, entity, entity_id, op, path, before_json, after_json) VALUES (@at, @seatNo, @branchId, @entity, @entityId, @op, @path, NULL, @afterJson)'
  )
  const listStmt = sqlite.prepare(
    `SELECT id, at, seat_no AS seatNo, branch_id AS branchId, entity, entity_id AS entityId, op, path, after_json AS afterJson
     FROM price_log WHERE (@beforeId IS NULL OR id < @beforeId) ORDER BY id DESC LIMIT @limit`
  )
  const countStmt = sqlite.prepare('SELECT COUNT(*) AS n FROM price_log')
  const purgeStmt = sqlite.prepare('DELETE FROM price_log WHERE at < @cutoff')
  return {
    insert: (e: PriceLogEntry): void => {
      insertStmt.run({ at: e.at, seatNo: e.seatNo, branchId: e.branchId, entity: e.entity, entityId: e.entityId, op: e.op, path: e.path, afterJson: JSON.stringify({ deviceKind: e.deviceKind, changes: e.changes, count: e.count }) })
    },
    list: (q: { limit: number; beforeId?: number }): PriceLogRow[] => (listStmt.all({ limit: q.limit, beforeId: q.beforeId ?? null }) as Raw[]).map(parse),
    total: (): number => (countStmt.get() as { n: number }).n,
    purgeOlderThan: (cutoffIso: string): number => purgeStmt.run({ cutoff: cutoffIso }).changes
  }
}
export type PriceLogRepo = ReturnType<typeof createPriceLogRepo>
