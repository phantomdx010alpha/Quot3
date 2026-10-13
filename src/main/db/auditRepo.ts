import type Database from 'better-sqlite3'
import { likePattern, type AuditQuery } from '../../shared/audit'

/**
 * The only SQL for reading and trimming `audit_log` (Phase 61). Other repos still insert their own rows inside their own
 * transactions (Phases 29-58); `insert` here serves `auditService.record`.
 */
export interface AuditRow {
  id: number
  at: string
  branchId: string | null
  branchName: string | null
  entity: string
  entityId: string | null
  action: string
  detailJson: string | null
}

export function createAuditRepo(sqlite: Database.Database) {
  const insertStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )
  const listStmt = sqlite.prepare(
    `SELECT a.id, a.at, a.branch_id AS branchId, b.name AS branchName, a.entity, a.entity_id AS entityId, a.action, a.detail_json AS detailJson
     FROM audit_log a LEFT JOIN branches b ON b.id = a.branch_id
     WHERE (@entity IS NULL OR a.entity = @entity)
       AND (@action IS NULL OR a.action = @action)
       AND (@from IS NULL OR a.at >= @from)
       AND (@to IS NULL OR a.at <= @to)
       AND (@beforeId IS NULL OR a.id < @beforeId)
       AND (@search IS NULL OR a.entity_id LIKE @search ESCAPE '\\' OR a.action LIKE @search ESCAPE '\\' OR a.entity LIKE @search ESCAPE '\\' OR a.detail_json LIKE @search ESCAPE '\\')
     ORDER BY a.id DESC LIMIT @limit`
  )
  const entitiesStmt = sqlite.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity')
  const actionsStmt = sqlite.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action')
  const countStmt = sqlite.prepare('SELECT COUNT(*) AS n FROM audit_log')
  // A lost local version lives ONLY in its conflict row: keep those while the bill is still marked `conflict`.
  const purgeStmt = sqlite.prepare(
    `DELETE FROM audit_log WHERE at < @cutoff
       AND NOT (entity = 'bill' AND action = 'conflict' AND entity_id IN (SELECT id FROM bills WHERE sync_state = 'conflict'))`
  )

  return {
    insert: (a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void => { insertStmt.run(a) },
    list: (q: Required<Pick<AuditQuery, 'limit'>> & AuditQuery): AuditRow[] =>
      listStmt.all({
        entity: q.entity ?? null, action: q.action ?? null, from: q.from ?? null, to: q.to ?? null,
        beforeId: q.beforeId ?? null, search: q.search ? likePattern(q.search) : null, limit: q.limit
      }) as AuditRow[],
    entities: (): string[] => (entitiesStmt.all() as Array<{ entity: string }>).map((r) => r.entity),
    actions: (): string[] => (actionsStmt.all() as Array<{ action: string }>).map((r) => r.action),
    total: (): number => (countStmt.get() as { n: number }).n,
    purgeOlderThan: (cutoffIso: string): number => purgeStmt.run({ cutoff: cutoffIso }).changes,
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
export type AuditRepo = ReturnType<typeof createAuditRepo>
