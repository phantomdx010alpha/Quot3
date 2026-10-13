import type Database from 'better-sqlite3'
import type { BackupKind } from '../../shared/backup/backupRules'

/** Phase 50: the `backups` table (only SQL for it lives here). */
export interface BackupRow { file: string; createdAt: string; kind: BackupKind; sizeBytes: number; billCount: number }

export interface BackupRepo {
  all(): BackupRow[]
  upsert(row: BackupRow): void
  remove(file: string): void
  /** Live + trashed bills in the OPEN database. */
  billCount(): number
}

export function createBackupRepo(sqlite: Database.Database): BackupRepo {
  const all = sqlite.prepare('SELECT file, created_at AS createdAt, kind, size_bytes AS sizeBytes, bill_count AS billCount FROM backups')
  const up = sqlite.prepare(
    'INSERT INTO backups (file, created_at, kind, size_bytes, bill_count) VALUES (@file, @createdAt, @kind, @sizeBytes, @billCount) ' +
      'ON CONFLICT(file) DO UPDATE SET created_at = excluded.created_at, kind = excluded.kind, size_bytes = excluded.size_bytes, bill_count = excluded.bill_count'
  )
  const del = sqlite.prepare('DELETE FROM backups WHERE file = ?')
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM bills')
  return {
    all: () => all.all() as BackupRow[],
    upsert: (r) => { up.run(r) },
    remove: (f) => { del.run(f) },
    billCount: () => (count.get() as { n: number }).n
  }
}
