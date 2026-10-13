import type Database from 'better-sqlite3'
import type { PartyLite } from '../../shared/party/partyLite'

export interface ImportBatchRow {
  id: string
  at: string
  fileName: string
  created: number
  updated: number
  skipped: number
  invalid: number
  beforeJson: string
  undoneAt: string | null
}
export interface ImportedPartyRow { id: string; updatedAt: string; deletedAt: string | null }

/** The only SQL of the party import (Phase 47): the batch rows and the import-tagged party rows. */
export function createPartyImportRepo(sqlite: Database.Database) {
  const insertBatch = sqlite.prepare(
    `INSERT INTO party_imports (id, at, file_name, created, updated, skipped, invalid, before_json)
     VALUES (@id, @at, @fileName, @created, @updated, @skipped, @invalid, @beforeJson)`
  )
  const getBatch = sqlite.prepare(
    `SELECT id, at, file_name AS fileName, created, updated, skipped, invalid, before_json AS beforeJson, undone_at AS undoneAt FROM party_imports WHERE id = ?`
  )
  const listBatches = sqlite.prepare(
    `SELECT id, at, file_name AS fileName, created, updated, skipped, invalid, before_json AS beforeJson, undone_at AS undoneAt FROM party_imports ORDER BY at DESC, id DESC LIMIT ?`
  )
  const markUndone = sqlite.prepare('UPDATE party_imports SET undone_at = @at WHERE id = @id AND undone_at IS NULL')
  const insertParty = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, import_id, created_at, updated_at)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, 'import', @importId, @at, @at)`
  )
  const importedStmt = sqlite.prepare('SELECT id, updated_at AS updatedAt, deleted_at AS deletedAt FROM parties WHERE import_id = ? ORDER BY created_at, id')
  const softDeleteStmt = sqlite.prepare('UPDATE parties SET deleted_at = @at, updated_at = @at WHERE id = @id AND deleted_at IS NULL')
  const updatedAtStmt = sqlite.prepare('SELECT updated_at AS at FROM parties WHERE id = ? AND deleted_at IS NULL')
  const auditStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )
  return {
    insertBatch: (b: Omit<ImportBatchRow, 'undoneAt'>): void => { insertBatch.run(b) },
    getBatch: (id: string): ImportBatchRow | undefined => getBatch.get(id) as ImportBatchRow | undefined,
    listBatches: (limit: number): ImportBatchRow[] => listBatches.all(limit) as ImportBatchRow[],
    markUndone: (id: string, at: string): boolean => markUndone.run({ id, at }).changes > 0,
    insertParty: (w: { id: string; name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null; importId: string; at: string }): void => { insertParty.run(w) },
    importedParties: (importId: string): ImportedPartyRow[] => importedStmt.all(importId) as ImportedPartyRow[],
    softDeleteParty: (id: string, at: string): boolean => softDeleteStmt.run({ id, at }).changes > 0,
    /** `updated_at` of a live party (an import stamps its batch time, so a later edit shows as a different value). */
    updatedAtOf: (id: string): string | undefined => (updatedAtStmt.get(id) as { at: string } | undefined)?.at,
    audit: (a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void => { auditStmt.run(a) }
  }
}
export type PartyImportRepo = ReturnType<typeof createPartyImportRepo>
export type { PartyLite }
