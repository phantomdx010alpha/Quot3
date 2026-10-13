import {
  AUDIT_RETENTION_DEFAULT_DAYS, auditCutoff, clampRetentionDays, describeAudit, detailToText, normaliseQuery, trimDetail,
  type AuditFacets, type AuditInput, type AuditItem, type AuditPage, type AuditQuery
} from '../../shared/audit'
import type { AuditRepo } from '../db/auditRepo'
import type { Logger } from '../logger'

/**
 * Phase 61 - the audit log: who / what / when for bills, imports, restores and sync conflicts. `record` is what services call
 * (it never throws: a failed log line must not undo the owner's save); `list` / `facets` feed the Settings viewer;
 * `purgeOld` is the retention sweep run at launch.
 */
export interface AuditService {
  record(input: AuditInput): void
  list(query: AuditQuery): AuditPage
  facets(): AuditFacets
  retentionDays(): number
  /** Removes rows older than the retention (conflict rows still needed are kept) and writes ONE `audit/purge` row. Returns the count. */
  purgeOld(days?: number): number
}

export interface AuditDeps {
  repo: AuditRepo
  branchId: () => string | null
  retention?: () => unknown
  log?: Logger
}

export function createAuditService(deps: AuditDeps, opts: { writable?: boolean; now?: () => Date } = {}): AuditService {
  const now = opts.now ?? (() => new Date())
  const writable = opts.writable !== false
  const retentionDays = (): number => clampRetentionDays(deps.retention ? deps.retention() : AUDIT_RETENTION_DEFAULT_DAYS)

  const write = (input: AuditInput): void => {
    deps.repo.insert({
      at: now().toISOString(), branchId: deps.branchId(), entity: input.entity, entityId: input.entityId ?? null, action: input.action,
      detailJson: input.detail ? JSON.stringify(input.detail) : null
    })
  }

  return {
    retentionDays,

    record(input) {
      if (!writable) return
      try { write(input) } catch (err) { deps.log?.warn('Audit row could not be written', { entity: input.entity, action: input.action, err }) }
    },

    list(query) {
      const q = normaliseQuery(query)
      const rows = deps.repo.list({ ...q, limit: q.limit + 1 })
      const page = rows.slice(0, q.limit)
      const items: AuditItem[] = page.map((r) => {
        const detail = trimDetail(r.detailJson)
        return {
          id: r.id, at: r.at, branchId: r.branchId, branchName: r.branchName ?? '', entity: r.entity, entityId: r.entityId, action: r.action,
          summary: describeAudit(r.entity, r.action, detail), detailText: detailToText(detail)
        }
      })
      return { items, hasMore: rows.length > q.limit, nextBeforeId: items.length > 0 && rows.length > q.limit ? items[items.length - 1]!.id : null }
    },

    facets() {
      return { entities: deps.repo.entities(), actions: deps.repo.actions(), total: deps.repo.total(), retentionDays: retentionDays() }
    },

    purgeOld(days) {
      if (!writable) return 0
      const d = clampRetentionDays(days ?? retentionDays())
      const cutoff = auditCutoff(now(), d)
      return deps.repo.transaction(() => {
        const removed = deps.repo.purgeOlderThan(cutoff)
        if (removed > 0) write({ entity: 'audit', action: 'purge', detail: { removed, olderThanDays: d, cutoff } })
        return removed
      })
    }
  }
}
