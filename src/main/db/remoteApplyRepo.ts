import type Database from 'better-sqlite3'
import { normalizePartyName } from '../../shared/party/partyLite'
import type { BillRecord, BillRowRecord } from '../../shared/billModel'
import type { ConflictDetail } from '../../shared/sync/conflict'
import { REVISION_MAX_PER_BILL } from '../../shared/constants'

/** What the apply rules need to know about the local copy of a bill. */
export interface LocalHead { id: string; branchId: string; poNumber: string; revision: number; updatedAt: string; deletedAt: string | null; syncState: string }

/** Phase 56: the only SQL used to apply a bill that arrived from another branch. Every method runs inside the caller's transaction. */
/** The synced fields of a customer (Phase 136). */
export interface PartyRowV2 {
  id: string; name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null
  createdAt: string; updatedAt: string; deletedAt: string | null; mergedInto: string | null
}

export interface RemoteApplyRepo {
  head(billId: string): LocalHead | undefined
  /** Phase 135: every bill (live and trashed) for the first-sync compare. */
  heads(): LocalHead[]
  branchExists(id: string): boolean
  insertBranch(b: { id: string; name: string; poPrefix: string; createdAt: string }): void
  partyExists(id: string): boolean
  /** Phase 88: id of ANOTHER bill (not `exceptId`) already holding this import fingerprint (trashed bills included), else undefined. */
  fingerprintOwner(fingerprint: string, exceptId: string): string | undefined
  /** Phase 87: id of the live party whose normalised name equals `norm` (oldest first), else undefined. */
  findPartyByNorm(norm: string): string | undefined
  /** Phase 87: a party created because a bill from another branch named one (`source = 'sync'`). Never touches the outbox. */
  /** Phase 136: a customer row as stored (any state), by id. */
  getParty(id: string): PartyRowV2 | undefined
  /** Phase 136: writes a received customer by id (insert, or replace the synced fields). Never touches `source` / `import_id` of an existing row. */
  upsertParty(p: PartyRowV2): void
  insertParty(p: { id: string; name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null; at: string }): void
  /**
   * Phase 137: a customer record arrived for `nameNorm`: any customer that was auto-created here from a bill's name (`source = 'sync'`,
   * i.e. the bill got here before its customer) is folded into it: its bills move, it is marked merged. Local only (nothing is sent).
   */
  adoptSyncParties(intoId: string, nameNorm: string, at: string): number
  /**
   * Phase 137: the customer a received customer id stands for TODAY: follows `merged_into` (at most 8 hops) and answers the last row;
   * `null` when the first row does not exist (or the chain loops / ends in a missing row).
   */
  resolveParty(id: string): string | null
  /**
   * Phase 137: a received `party_merge`. Re-points every bill of `mergedId` to the (resolved) survivor and marks the merged customer
   * (`deleted_at`, `merged_into`). Idempotent. Throws when the survivor is not here yet. `ignored` when it would loop, or when the merged
   * customer was already merged into a DIFFERENT customer (the first merge stays; running the unify again converges them).
   */
  applyPartyMerge(m: { survivorId: string; mergedId: string; at: string }): 'applied' | 'ignored'
  /** Phase 137: a received UNDO of a merge: the merged customer comes back and the bills whose saved name is its name move back to it. */
  restorePartyMerge(m: { survivorId: string; mergedId: string; at: string }): 'applied' | 'ignored'
  /** Phase 87: live bills with no party link, with their stored party snapshot (the input of the one-time relink). */
  unlinkedBills(): { id: string; partySnapshotJson: string }[]
  /** Phase 87: sets ONLY `party_id` (no revision / updated_at change, no outbox: the link is a local fact). */
  linkParty(billId: string, partyId: string): void
  /** Insert or overwrite the whole bill row (never touches the outbox). */
  upsertBill(r: BillRecord): void
  replaceRows(billId: string, rows: readonly BillRowRecord[]): void
  /** Phase 57: the stored bill record and rows exactly as they are now (raw shapes, same as `billRepo.getRecord / getRows`). */
  record(billId: string): BillRecord | undefined
  rows(billId: string): BillRowRecord[]
  /** Phase 57: who saved the given revision (the author of that version), or undefined when no revision row exists (e.g. a delete / restore). */
  authorOf(billId: string, revision: number): string | undefined
  /** Phase 57: writes the revision row, REPLACING a row with the same number (two branches can reach the same number with different content). */
  putRevision(r: { id: string; billId: string; revision: number; snapshotJson: string; savedAt: string; savedByBranch: string }): void
  /** Phase 57: drops revision rows above `revision`; an applied version with a lower number (clock skew) would otherwise collide with the next local save. */
  deleteRevisionsAbove(billId: string, revision: number): void
  pruneRevisions(billId: string): void
  /** Phase 57: one `audit_log` conflict row. */
  auditConflict(a: { at: string; branchId: string | null; billId: string; detail: ConflictDetail }): void
  /** Phase 57: the conflict rows of bills that are still marked `conflict`, newest first (the latest row per bill). */
  conflicts(): { billId: string; poNumber: string; at: string; detailJson: string }[]
  /** Phase 57: the owner has seen it: back to `pending` when something is still unsent, else `synced`. Returns whether the bill was in conflict. */
  clearConflict(billId: string): boolean
  transaction<T>(fn: () => T): T
}

export function createRemoteApplyRepo(sqlite: Database.Database): RemoteApplyRepo {
  const headStmt = sqlite.prepare(
    'SELECT id, branch_id AS branchId, po_number AS poNumber, revision, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState FROM bills WHERE id = ?'
  )
  const headsStmt = sqlite.prepare(
    'SELECT id, branch_id AS branchId, po_number AS poNumber, revision, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState FROM bills ORDER BY id'
  )
  const branchStmt = sqlite.prepare('SELECT 1 AS x FROM branches WHERE id = ?')
  const insBranch = sqlite.prepare('INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES (@id, @name, @poPrefix, 0, @createdAt)')
  const partyStmt = sqlite.prepare('SELECT 1 AS x FROM parties WHERE id = ?')
  const fpStmt = sqlite.prepare('SELECT id FROM bills WHERE import_fingerprint = ? AND id <> ? LIMIT 1')
  const byNormStmt = sqlite.prepare('SELECT id FROM parties WHERE name_norm = ? AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1')
  const insPartyStmt = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, created_at, updated_at)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, 'sync', @at, @at)`
  )
  const getPartyStmt = sqlite.prepare(
    'SELECT id, name, name_norm AS nameNorm, phone, address, transport, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, merged_into AS mergedInto FROM parties WHERE id = ?'
  )
  const upsertPartyStmt = sqlite.prepare(
    `INSERT INTO parties (id, name, name_norm, phone, address, transport, source, created_at, updated_at, deleted_at, merged_into)
     VALUES (@id, @name, @nameNorm, @phone, @address, @transport, 'sync', @createdAt, @updatedAt, @deletedAt, @mergedInto)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, name_norm = excluded.name_norm, phone = excluded.phone, address = excluded.address, transport = excluded.transport,
       created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, merged_into = excluded.merged_into`
  )
  const unlinkedStmt = sqlite.prepare('SELECT id, party_snapshot_json AS partySnapshotJson FROM bills WHERE party_id IS NULL AND deleted_at IS NULL ORDER BY created_at, id')
  const linkStmt = sqlite.prepare('UPDATE bills SET party_id = ? WHERE id = ? AND party_id IS NULL')
  const upsert = sqlite.prepare(
    `INSERT INTO bills (id, branch_id, po_seq, po_number, party_id, party_snapshot_json, format_id, extra_cols_json, paper_override, round_off, footer_extras_json, tail_rows_json, legacy_ref, import_batch_id, import_fingerprint, bill_date,
       totals_json, item_row_count, revision, created_at, updated_at, deleted_at, sync_state)
     VALUES (@id, @branchId, @poSeq, @poNumber, @partyId, @partySnapshotJson, @formatId, @extraColsJson, @paperOverride, @roundOff, @footerExtrasJson, @tailRowsJson, @legacyRef, @importBatchId, @importFingerprint, @billDate,
       @totalsJson, @itemRowCount, @revision, @createdAt, @updatedAt, @deletedAt, @syncState)
     ON CONFLICT(id) DO UPDATE SET branch_id = excluded.branch_id, po_seq = excluded.po_seq, po_number = excluded.po_number, party_id = excluded.party_id,
       party_snapshot_json = excluded.party_snapshot_json, format_id = excluded.format_id, extra_cols_json = excluded.extra_cols_json,
       paper_override = excluded.paper_override, round_off = excluded.round_off, footer_extras_json = excluded.footer_extras_json, tail_rows_json = excluded.tail_rows_json,
       legacy_ref = COALESCE(excluded.legacy_ref, bills.legacy_ref), import_batch_id = COALESCE(excluded.import_batch_id, bills.import_batch_id),
       import_fingerprint = COALESCE(excluded.import_fingerprint, bills.import_fingerprint), bill_date = excluded.bill_date, totals_json = excluded.totals_json, item_row_count = excluded.item_row_count,
       revision = excluded.revision, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, sync_state = excluded.sync_state`
  )
  const delRows = sqlite.prepare('DELETE FROM bill_rows WHERE bill_id = ?')
  const insRow = sqlite.prepare(
    `INSERT INTO bill_rows (id, bill_id, idx, name_runs_json, name_plain, qty, rate, total_override, gst_rate, extras_json, cell_style_json)
     VALUES (@id, @billId, @idx, @nameRunsJson, @namePlain, @qty, @rate, @totalOverride, @gstRate, @extrasJson, @cellStyleJson)`
  )
  const recStmt = sqlite.prepare(
    `SELECT id, branch_id AS branchId, po_seq AS poSeq, po_number AS poNumber, party_id AS partyId, party_snapshot_json AS partySnapshotJson,
       format_id AS formatId, extra_cols_json AS extraColsJson, paper_override AS paperOverride, round_off AS roundOff, footer_extras_json AS footerExtrasJson, tail_rows_json AS tailRowsJson, bill_date AS billDate, totals_json AS totalsJson,
       item_row_count AS itemRowCount, revision, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState
     FROM bills WHERE id = ?`
  )
  const rowsStmt = sqlite.prepare(
    `SELECT id, bill_id AS billId, idx, name_runs_json AS nameRunsJson, name_plain AS namePlain, qty, rate, total_override AS totalOverride,
       gst_rate AS gstRate, extras_json AS extrasJson, cell_style_json AS cellStyleJson FROM bill_rows WHERE bill_id = ? ORDER BY idx`
  )
  const authorStmt = sqlite.prepare('SELECT saved_by_branch AS a FROM bill_revisions WHERE bill_id = ? AND revision = ?')
  const putRev = sqlite.prepare(
    `INSERT INTO bill_revisions (id, bill_id, revision, snapshot_json, saved_at, saved_by_branch) VALUES (@id, @billId, @revision, @snapshotJson, @savedAt, @savedByBranch)
     ON CONFLICT(bill_id, revision) DO UPDATE SET snapshot_json = excluded.snapshot_json, saved_at = excluded.saved_at, saved_by_branch = excluded.saved_by_branch`
  )
  const delAbove = sqlite.prepare('DELETE FROM bill_revisions WHERE bill_id = ? AND revision > ?')
  const auditStmt = sqlite.prepare("INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, 'bill', @billId, 'conflict', @detailJson)")
  const conflictStmt = sqlite.prepare(
    `SELECT b.id AS billId, b.po_number AS poNumber, a.at AS at, a.detail_json AS detailJson
       FROM bills b JOIN audit_log a ON a.id = (SELECT MAX(id) FROM audit_log WHERE entity = 'bill' AND action = 'conflict' AND entity_id = b.id)
      WHERE b.sync_state = 'conflict' ORDER BY a.id DESC`
  )
  const clearStmt = sqlite.prepare(
    `UPDATE bills SET sync_state = CASE WHEN EXISTS (SELECT 1 FROM sync_outbox WHERE bill_id = @id AND state IN ('pending', 'failed')) THEN 'pending' ELSE 'synced' END
      WHERE id = @id AND sync_state = 'conflict'`
  )
  const prune = sqlite.prepare(
    'DELETE FROM bill_revisions WHERE bill_id = @billId AND id NOT IN (SELECT id FROM bill_revisions WHERE bill_id = @billId ORDER BY revision DESC LIMIT @keep)'
  )
  const mergedIntoStmt = sqlite.prepare('SELECT merged_into AS mergedInto FROM parties WHERE id = ?')
  const repointAllStmt = sqlite.prepare('UPDATE bills SET party_id = @to WHERE party_id = @from')
  const markMergedStmt = sqlite.prepare('UPDATE parties SET deleted_at = COALESCE(deleted_at, @at), merged_into = @to, updated_at = @at WHERE id = @id')
  const unmarkStmt = sqlite.prepare('UPDATE parties SET deleted_at = NULL, merged_into = NULL, updated_at = @at WHERE id = @id')
  const billNamesStmt = sqlite.prepare('SELECT id, party_snapshot_json AS snap FROM bills WHERE party_id = ?')
  const relinkStmt = sqlite.prepare('UPDATE bills SET party_id = @to WHERE id = @id')
  const syncDupStmt = sqlite.prepare("SELECT id FROM parties WHERE name_norm = ? AND source = 'sync' AND deleted_at IS NULL AND merged_into IS NULL AND id != ?")
  const resolveParty = (id: string): string | null => {
    let cur = id
    for (let hop = 0; hop < 8; hop++) {
      const r = mergedIntoStmt.get(cur) as { mergedInto: string | null } | undefined
      if (!r) return null
      if (r.mergedInto === null) return cur
      cur = r.mergedInto
    }
    return null
  }
  return {
    head: (id) => headStmt.get(id) as LocalHead | undefined,
    heads: () => headsStmt.all() as LocalHead[],
    branchExists: (id) => branchStmt.get(id) !== undefined,
    insertBranch: (b) => void insBranch.run(b),
    partyExists: (id) => partyStmt.get(id) !== undefined,
    fingerprintOwner: (fp, exceptId) => (fpStmt.get(fp, exceptId) as { id: string } | undefined)?.id,
    findPartyByNorm: (norm) => (byNormStmt.get(norm) as { id: string } | undefined)?.id,
    getParty: (id) => getPartyStmt.get(id) as PartyRowV2 | undefined,
    upsertParty: (p) => void upsertPartyStmt.run(p),
    insertParty: (p) => void insPartyStmt.run(p),
    resolveParty,
    adoptSyncParties(intoId, nameNorm, at) {
      const dups = syncDupStmt.all(nameNorm, intoId) as { id: string }[]
      for (const d of dups) { repointAllStmt.run({ from: d.id, to: intoId }); markMergedStmt.run({ id: d.id, to: intoId, at }) }
      return dups.length
    },
    applyPartyMerge({ survivorId, mergedId, at }) {
      const survivor = resolveParty(survivorId)
      if (survivor === null) throw new Error('The customer this merge keeps has not arrived yet.')
      if (survivor === mergedId) return 'ignored' // two branches merged the same pair in opposite directions: the first one received stays
      const merged = getPartyStmt.get(mergedId) as PartyRowV2 | undefined
      if (merged && merged.mergedInto !== null && resolveParty(mergedId) !== survivor) return 'ignored'
      let changed = repointAllStmt.run({ from: mergedId, to: survivor }).changes > 0
      if (merged && (merged.mergedInto === null || merged.deletedAt === null)) { markMergedStmt.run({ id: mergedId, to: survivor, at }); changed = true }
      return changed ? 'applied' : 'ignored'
    },
    restorePartyMerge({ survivorId, mergedId, at }) {
      const merged = getPartyStmt.get(mergedId) as PartyRowV2 | undefined
      if (!merged || getPartyStmt.get(survivorId) === undefined) return 'ignored'
      let changed = false
      // The customer record of the undo normally arrives first (it already cleared the pointer); clear it here when it has not.
      if (merged.mergedInto === survivorId) { unmarkStmt.run({ id: mergedId, at }); changed = true }
      else if (merged.mergedInto !== null || merged.deletedAt !== null) return 'ignored' // merged elsewhere / deleted by the owner: not ours to bring back
      for (const b of billNamesStmt.all(survivorId) as { id: string; snap: string }[]) {
        try {
          const name = (JSON.parse(b.snap) as { name?: unknown }).name
          if (typeof name === 'string' && normalizePartyName(name) === merged.nameNorm) { relinkStmt.run({ id: b.id, to: mergedId }); changed = true }
        } catch { /* an unreadable snapshot stays where it is */ }
      }
      return changed ? 'applied' : 'ignored'
    },
    unlinkedBills: () => unlinkedStmt.all() as { id: string; partySnapshotJson: string }[],
    linkParty: (billId, partyId) => void linkStmt.run(partyId, billId),
    upsertBill: (r) => void upsert.run({ ...r, roundOff: r.roundOff ?? 0, footerExtrasJson: r.footerExtrasJson ?? '{}', tailRowsJson: r.tailRowsJson ?? '[]', legacyRef: r.legacyRef ?? null, importBatchId: r.importBatchId ?? null, importFingerprint: r.importFingerprint ?? null }),
    replaceRows(billId, rows) {
      delRows.run(billId)
      for (const r of rows) insRow.run(r)
    },
    record: (id) => recStmt.get(id) as BillRecord | undefined,
    rows: (id) => rowsStmt.all(id) as BillRowRecord[],
    authorOf: (billId, revision) => (authorStmt.get(billId, revision) as { a: string } | undefined)?.a,
    putRevision: (r) => void putRev.run(r),
    deleteRevisionsAbove: (billId, revision) => void delAbove.run(billId, revision),
    auditConflict: (a) => void auditStmt.run({ at: a.at, branchId: a.branchId, billId: a.billId, detailJson: JSON.stringify(a.detail) }),
    conflicts: () => conflictStmt.all() as { billId: string; poNumber: string; at: string; detailJson: string }[],
    clearConflict: (id) => clearStmt.run({ id }).changes > 0,
    pruneRevisions: (billId) => void prune.run({ billId, keep: REVISION_MAX_PER_BILL }),
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
