import type Database from 'better-sqlite3'

/** Phase 61: row counts for "Copy diagnostics" (counts only - never content). */
export function createDiagnosticsRepo(sqlite: Database.Database) {
  const n = (sql: string): number => (sqlite.prepare(sql).get() as { n: number }).n
  return {
    counts: (): Record<string, number> => ({
      bills: n('SELECT COUNT(*) AS n FROM bills WHERE deleted_at IS NULL'),
      billsInTrash: n('SELECT COUNT(*) AS n FROM bills WHERE deleted_at IS NOT NULL'),
      customers: n('SELECT COUNT(*) AS n FROM parties WHERE deleted_at IS NULL'),
      drafts: n('SELECT COUNT(*) AS n FROM drafts'),
      auditRows: n('SELECT COUNT(*) AS n FROM audit_log'),
      syncOutboxRows: n('SELECT COUNT(*) AS n FROM sync_outbox')
    })
  }
}
export type DiagnosticsRepo = ReturnType<typeof createDiagnosticsRepo>
