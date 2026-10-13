import type Database from 'better-sqlite3'
import type { TrashItem } from '../../shared/trash'

/**
 * The only SQL behind Recently deleted (Phase 43): list the trashed bills, restore, hard delete, and the one `audit_log`
 * insert purging needs. `bill_rows` and `bill_revisions` go with a bill by `ON DELETE CASCADE`; drafts have no foreign key,
 * so a purged bill's drafts are removed explicitly. `po_counters` is never touched, so a purged PO number is never reused.
 */
export interface TrashHead { id: string; branchId: string; poNumber: string; revision: number; deletedAt: string | null }

export function createTrashRepo(sqlite: Database.Database) {
  const listStmt = sqlite.prepare(
    `SELECT id, po_number AS poNumber, po_seq AS poSeq, bill_date AS billDate,
            json_extract(party_snapshot_json, '$.name') AS partyName,
            json_extract(totals_json, '$.grandTotal') AS grandTotal,
            branch_id AS branchId, revision, deleted_at AS deletedAt
     FROM bills WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC`
  )
  const headStmt = sqlite.prepare('SELECT id, branch_id AS branchId, po_number AS poNumber, revision, deleted_at AS deletedAt FROM bills WHERE id = ?')
  const restoreStmt = sqlite.prepare('UPDATE bills SET deleted_at = NULL, updated_at = @at, revision = revision + 1 WHERE id = @id AND deleted_at IS NOT NULL')
  const deleteBillStmt = sqlite.prepare('DELETE FROM bills WHERE id = ? AND deleted_at IS NOT NULL')
  const deleteDraftsStmt = sqlite.prepare('DELETE FROM drafts WHERE bill_id = ?')
  const dueStmt = sqlite.prepare('SELECT id FROM bills WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at, id')
  const allIdsStmt = sqlite.prepare('SELECT id FROM bills WHERE deleted_at IS NOT NULL ORDER BY deleted_at, id')
  const auditStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )

  type Row = Omit<TrashItem, 'partyName' | 'grandTotal' | 'purgeAt'> & { partyName: string | null; grandTotal: string | number | null }

  return {
    /** Trashed bills, most recently deleted first (`purgeAt` is added by the service, which knows the retention). */
    list: (): Array<Omit<TrashItem, 'purgeAt'>> =>
      (listStmt.all() as Row[]).map((r) => ({ ...r, partyName: r.partyName ?? '', grandTotal: r.grandTotal === null ? '' : String(r.grandTotal) })),
    getHead: (id: string): TrashHead | undefined => headStmt.get(id) as TrashHead | undefined,
    /** Returns whether a trashed bill was found and brought back. */
    restore: (id: string, at: string): boolean => restoreStmt.run({ id, at }).changes > 0,
    /** Hard delete; only ever matches a bill that IS in the trash. Returns whether one was removed. */
    purge: (id: string): boolean => {
      const gone = deleteBillStmt.run(id).changes > 0
      if (gone) deleteDraftsStmt.run(id)
      return gone
    },
    dueIds: (cutoffIso: string): string[] => (dueStmt.all(cutoffIso) as Array<{ id: string }>).map((r) => r.id),
    allIds: (): string[] => (allIdsStmt.all() as Array<{ id: string }>).map((r) => r.id),
    audit: (a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void => { auditStmt.run(a) },
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
export type TrashRepo = ReturnType<typeof createTrashRepo>
