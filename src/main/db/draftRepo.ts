import type Database from 'better-sqlite3'

export interface DraftRow {
  id: string
  billId: string | null
  payloadJson: string
  updatedAt: string
}

/** The only SQL that touches `drafts` (Phase 29) and the one `audit_log` insert the draft cleanup needs. */
export function createDraftRepo(sqlite: Database.Database) {
  const cols = 'id, bill_id AS billId, payload_json AS payloadJson, updated_at AS updatedAt'
  const upsertStmt = sqlite.prepare(
    `INSERT INTO drafts (id, bill_id, payload_json, updated_at) VALUES (@id, @billId, @payloadJson, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET bill_id = excluded.bill_id, payload_json = excluded.payload_json, updated_at = excluded.updated_at`
  )
  const getStmt = sqlite.prepare(`SELECT ${cols} FROM drafts WHERE id = ?`)
  const listStmt = sqlite.prepare(`SELECT ${cols} FROM drafts ORDER BY updated_at DESC, id`)
  const deleteStmt = sqlite.prepare('DELETE FROM drafts WHERE id = ?')
  const staleStmt = sqlite.prepare('SELECT id, bill_id AS billId FROM drafts WHERE updated_at < ? ORDER BY updated_at, id')
  const auditStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )
  return {
    upsert: (d: DraftRow): void => { upsertStmt.run(d) },
    get: (id: string): DraftRow | undefined => getStmt.get(id) as DraftRow | undefined,
    list: (): DraftRow[] => listStmt.all() as DraftRow[],
    /** Returns whether a row was removed. */
    delete: (id: string): boolean => deleteStmt.run(id).changes > 0,
    staleBefore: (cutoffIso: string): Array<{ id: string; billId: string | null }> => staleStmt.all(cutoffIso) as Array<{ id: string; billId: string | null }>,
    audit: (a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void => { auditStmt.run(a) },
    /** One transaction (used so the stale delete and its audit row land together). */
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn)()
  }
}
export type DraftRepo = ReturnType<typeof createDraftRepo>
