import type Database from 'better-sqlite3'
import type { ExistingState } from '../../shared/legacyImport'

/**
 * Phase 85: the only SQL behind the legacy-bill import (LEGACY_IMPORT_SPEC sections 6-7): what already exists (for the planner),
 * the `import_batches` table, the three `bills.legacy_*` columns, the PO counter bump and the undo queries. Bills, rows and
 * revisions themselves are written through `billRepo` (the same code path as `bills:save`).
 */
export interface BatchRow {
  id: string
  at: string
  sourceLabel: string
  branchId: string
  poPrefix: string
  filesFound: number
  created: number
  skipped: number
  errors: number
  newParties: number
  poFirst: number | null
  poLast: number | null
  nextSeqAfter: number
  /** Parties this batch created (or revived), for undo. */
  partyIds: string[]
  reportFile: string | null
  undoneAt: string | null
  undo: UndoSummary | null
}

export interface UndoSummary { deleted: number; keptEdited: Array<{ id: string; poNumber: string }>; alreadyDeleted: number; partiesRemoved: number }

export interface BatchBill { id: string; poNumber: string; branchId: string; revision: number; deletedAt: string | null }

export interface ImportedParty { id: string; name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null }

interface BatchDb {
  id: string; at: string; sourceLabel: string; branchId: string; poPrefix: string; filesFound: number; created: number; skipped: number
  errors: number; newParties: number; poFirst: number | null; poLast: number | null; nextSeqAfter: number; partyIdsJson: string
  reportFile: string | null; undoneAt: string | null; undoJson: string | null
}

const safeJson = <T>(text: string | null, fallback: T): T => {
  if (!text) return fallback
  try { return JSON.parse(text) as T } catch { return fallback }
}

export function createLegacyImportRepo(sqlite: Database.Database) {
  const partiesStmt = sqlite.prepare('SELECT id, name FROM parties WHERE deleted_at IS NULL')
  // Every fingerprint / id counts, trashed bills included: a deleted imported bill is "already here", not re-imported.
  const fingerprintsStmt = sqlite.prepare('SELECT import_fingerprint AS f FROM bills WHERE import_fingerprint IS NOT NULL')
  const idsStmt = sqlite.prepare('SELECT id FROM bills')
  const seqsStmt = sqlite.prepare('SELECT po_seq AS s FROM bills WHERE branch_id = ?')
  const counterStmt = sqlite.prepare('SELECT next_seq AS n FROM po_counters WHERE branch_id = ?')
  const refsStmt = sqlite.prepare(
    `SELECT json_extract(party_snapshot_json, '$.name') AS party, legacy_ref AS legacyRef FROM bills WHERE legacy_ref IS NOT NULL`
  )
  const billTagStmt = sqlite.prepare('SELECT legacy_ref AS legacyRef, import_batch_id AS importBatchId FROM bills WHERE id = ?')
  const tagStmt = sqlite.prepare('UPDATE bills SET legacy_ref = @legacyRef, import_batch_id = @batchId, import_fingerprint = @fingerprint WHERE id = @id')
  // A party this batch needs: new row, or the soft-deleted row with the same deterministic id brought back (undo, then import again).
  const upsertPartyStmt = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, created_at, updated_at)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, 'import', @at, @at)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm, phone = excluded.phone, address = excluded.address,
       transport = excluded.transport, source = 'import', updated_at = excluded.updated_at, deleted_at = NULL
     WHERE parties.deleted_at IS NOT NULL`
  )
  const insertBatchStmt = sqlite.prepare(
    `INSERT INTO import_batches (id, at, source_label, branch_id, po_prefix, files_found, created, skipped, errors, new_parties, po_first, po_last,
       next_seq_after, party_ids_json, report_file)
     VALUES (@id, @at, @sourceLabel, @branchId, @poPrefix, @filesFound, @created, @skipped, @errors, @newParties, @poFirst, @poLast,
       @nextSeqAfter, @partyIdsJson, NULL)`
  )
  const reportFileStmt = sqlite.prepare('UPDATE import_batches SET report_file = ? WHERE id = ?')
  const batchStmt = sqlite.prepare(
    `SELECT id, at, source_label AS sourceLabel, branch_id AS branchId, po_prefix AS poPrefix, files_found AS filesFound, created, skipped, errors,
       new_parties AS newParties, po_first AS poFirst, po_last AS poLast, next_seq_after AS nextSeqAfter, party_ids_json AS partyIdsJson,
       report_file AS reportFile, undone_at AS undoneAt, undo_json AS undoJson FROM import_batches`
  )
  const batchByIdStmt = sqlite.prepare(`${batchStmt.source} WHERE id = ?`)
  const listBatchStmt = sqlite.prepare(`${batchStmt.source} ORDER BY at DESC, id DESC`)
  const batchBillsStmt = sqlite.prepare(
    'SELECT id, po_number AS poNumber, branch_id AS branchId, revision, deleted_at AS deletedAt FROM bills WHERE import_batch_id = ? ORDER BY po_seq'
  )
  const markUndoneStmt = sqlite.prepare('UPDATE import_batches SET undone_at = @at, undo_json = @undoJson WHERE id = @id AND undone_at IS NULL')
  // Only a party the importer created, still live, with no live bill left. Never touches a party the owner made or kept using.
  const dropPartyStmt = sqlite.prepare(
    `UPDATE parties SET deleted_at = @at, updated_at = @at
     WHERE id = @id AND source = 'import' AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM bills WHERE bills.party_id = parties.id AND bills.deleted_at IS NULL)`
  )
  const bumpCounterStmt = sqlite.prepare('UPDATE po_counters SET next_seq = MAX(next_seq, @next) WHERE branch_id = @branchId')

  const toBatch = (r: BatchDb): BatchRow => ({
    id: r.id, at: r.at, sourceLabel: r.sourceLabel, branchId: r.branchId, poPrefix: r.poPrefix, filesFound: r.filesFound, created: r.created,
    skipped: r.skipped, errors: r.errors, newParties: r.newParties, poFirst: r.poFirst, poLast: r.poLast, nextSeqAfter: r.nextSeqAfter,
    partyIds: safeJson<string[]>(r.partyIdsJson, []), reportFile: r.reportFile, undoneAt: r.undoneAt, undo: safeJson<UndoSummary | null>(r.undoJson, null)
  })

  return {
    /** What the planner must know about this database (LEGACY_IMPORT_SPEC section 6). */
    existingState(branchId: string): ExistingState {
      const counter = counterStmt.get(branchId) as { n: number } | undefined
      return {
        parties: partiesStmt.all() as Array<{ id: string; name: string }>,
        fingerprints: new Set((fingerprintsStmt.all() as Array<{ f: string }>).map((r) => r.f)),
        billIds: new Set((idsStmt.all() as Array<{ id: string }>).map((r) => r.id)),
        usedPoSeqs: new Set((seqsStmt.all(branchId) as Array<{ s: number }>).map((r) => r.s)),
        nextSeq: counter?.n ?? 1,
        importedRefs: (refsStmt.all() as Array<{ party: string | null; legacyRef: string }>).map((r) => ({ party: r.party ?? '', legacyRef: r.legacyRef }))
      }
    },
    /** Marks a just-inserted bill as imported. */
    /** Phase 86: the old-app tags of one bill (null for a bill made here). */
    billTag(id: string): { legacyRef: string; importBatchId: string } | null {
      const r = billTagStmt.get(id) as { legacyRef: string | null; importBatchId: string | null } | undefined
      return r && r.legacyRef && r.importBatchId ? { legacyRef: r.legacyRef, importBatchId: r.importBatchId } : null
    },
    tagBill: (id: string, t: { legacyRef: string; batchId: string; fingerprint: string }): void => { tagStmt.run({ id, ...t }) },
    upsertParty: (p: ImportedParty, at: string): void => { upsertPartyStmt.run({ ...p, at }) },
    /** Never lowers the counter. */
    bumpCounter: (branchId: string, next: number): void => { bumpCounterStmt.run({ branchId, next }) },
    insertBatch: (b: Omit<BatchRow, 'reportFile' | 'undoneAt' | 'undo'>): void => {
      insertBatchStmt.run({ ...b, partyIdsJson: JSON.stringify(b.partyIds) })
    },
    setReportFile: (id: string, file: string | null): void => { reportFileStmt.run(file, id) },
    getBatch: (id: string): BatchRow | undefined => { const r = batchByIdStmt.get(id) as BatchDb | undefined; return r && toBatch(r) },
    listBatches: (): BatchRow[] => (listBatchStmt.all() as BatchDb[]).map(toBatch),
    batchBills: (batchId: string): BatchBill[] => batchBillsStmt.all(batchId) as BatchBill[],
    markUndone: (id: string, at: string, undo: UndoSummary): boolean => markUndoneStmt.run({ id, at, undoJson: JSON.stringify(undo) }).changes > 0,
    /** True when the party was an importer-created, now bill-less, live party and has been removed. */
    dropPartyIfUnused: (id: string, at: string): boolean => dropPartyStmt.run({ id, at }).changes > 0,
    /** `BEGIN IMMEDIATE`, like every other write path. */
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
export type LegacyImportRepo = ReturnType<typeof createLegacyImportRepo>
