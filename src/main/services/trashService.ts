import { TRASH_RETENTION_DAYS } from '../../shared/constants'
import type { AuditInput } from '../../shared/audit'
import { purgeAt, sanitizeRetentionDays, trashCutoff, type TrashItem } from '../../shared/trash'
import type { TrashRepo } from '../db/trashRepo'
import { AppError } from '../ipc/envelope'

export interface SavedInfoLike { billId: string; revision: number; created: boolean; branchId: string; op?: 'upsert' | 'delete' }

export interface TrashService {
  /** Trashed bills, most recently deleted first, each with the day it will be purged. */
  list(): TrashItem[]
  /** Brings bills back: `deleted_at` cleared, `revision` + 1 (supersedes the tombstone). PO number and content are untouched. */
  restore(ids: string[]): { restored: string[]; missing: string[] }
  /** Deletes trashed bills for good (ONE audit row). A bill that is not in the trash is reported in `missing`, never purged. */
  purge(ids: string[]): { purged: string[]; missing: string[] }
  /** Purges everything in the trash (ONE audit row). */
  emptyTrash(): { purged: number }
  /** Launch sweep: purges bills deleted more than `days` ago (default: the setting / 30) with ONE audit row. Returns the count. */
  autoPurge(days?: number): number
  /** The retention in force (days). */
  retentionDays(): number
}

export interface TrashDeps { repo: TrashRepo; branchId: () => string | null }
export interface TrashOpts {
  writable?: boolean
  now?: () => Date
  /** Read live so the Settings screen's value applies at the next sweep. */
  retention?: () => unknown
  outbox?: (info: SavedInfoLike) => void
  /** Phase 61: one audit row per restored bill (inside the restore transaction). */
  audit?: (a: AuditInput) => void
}

/** Phase 43 - Recently deleted. Soft delete itself lives in `billService.delete` (Phase 42); this is the way back and the way out. */
export function createTrashService({ repo, branchId }: TrashDeps, opts: TrashOpts = {}): TrashService {
  const now = opts.now ?? (() => new Date())
  const days = (): number => (opts.retention ? sanitizeRetentionDays(opts.retention()) : TRASH_RETENTION_DAYS)
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  const audit = (action: string, detail: Record<string, unknown>): void => {
    repo.audit({ at: now().toISOString(), branchId: branchId(), entity: 'bill', entityId: null, action, detailJson: JSON.stringify(detail) })
  }
  const purgeIds = (ids: string[]): { purged: string[]; missing: string[] } => {
    const purged: string[] = []
    const missing: string[] = []
    for (const id of ids) (repo.purge(id) ? purged : missing).push(id)
    return { purged, missing }
  }

  return {
    retentionDays: days,

    list() {
      const d = days()
      return repo.list().map((t) => ({ ...t, purgeAt: purgeAt(t.deletedAt, d) }))
    },

    restore(ids) {
      guard()
      const at = now().toISOString()
      const unique = [...new Set(ids)]
      return repo.transaction(() => {
        const restored: string[] = []
        const missing: string[] = []
        for (const id of unique) {
          const head = repo.getHead(id)
          if (!head || head.deletedAt === null || !repo.restore(id, at)) { missing.push(id); continue }
          restored.push(id)
          opts.outbox?.({ billId: id, revision: head.revision + 1, created: false, branchId: head.branchId })
          opts.audit?.({ entity: 'bill', entityId: id, action: 'restore', detail: { poNumber: head.poNumber, revision: head.revision + 1 } })
        }
        return { restored, missing }
      })
    },

    purge(ids) {
      guard()
      const unique = [...new Set(ids)]
      return repo.transaction(() => {
        const r = purgeIds(unique)
        if (r.purged.length > 0) audit('purge', { ids: r.purged, count: r.purged.length })
        return r
      })
    },

    emptyTrash() {
      guard()
      return repo.transaction(() => {
        const r = purgeIds(repo.allIds())
        if (r.purged.length > 0) audit('empty_trash', { ids: r.purged, count: r.purged.length })
        return { purged: r.purged.length }
      })
    },

    autoPurge(override) {
      guard()
      const d = override === undefined ? days() : sanitizeRetentionDays(override)
      const cutoff = trashCutoff(now(), d)
      return repo.transaction(() => {
        const due = repo.dueIds(cutoff)
        if (due.length === 0) return 0
        const r = purgeIds(due)
        if (r.purged.length > 0) audit('auto_purge', { ids: r.purged, count: r.purged.length, retentionDays: d, cutoff })
        return r.purged.length
      })
    }
  }
}
