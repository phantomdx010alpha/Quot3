import type Database from 'better-sqlite3'
import type { BillRecord, BillRowRecord } from '../../shared/billModel'
import { REVISION_MAX_PER_BILL } from '../../shared/constants'

export interface StoredBillHead {
  id: string
  branchId: string
  poSeq: number
  poNumber: string
  revision: number
  createdAt: string
  deletedAt: string | null
}

export interface RevisionListRow {
  revision: number
  savedAt: string
  savedByBranch: string
  billDate: string | null
  partyJson: string | null
  totalsJson: string | null
  itemRowCount: number | null
}
export interface StoredRevision { revision: number; savedAt: string; savedByBranch: string; snapshotJson: string }

/** The only SQL that touches `bills`, `bill_rows` and `bill_revisions` (Phase 27). Services decide the rules. */
export function createBillRepo(sqlite: Database.Database) {
  const headStmt = sqlite.prepare(
    'SELECT id, branch_id AS branchId, po_seq AS poSeq, po_number AS poNumber, revision, created_at AS createdAt, deleted_at AS deletedAt FROM bills WHERE id = ?'
  )
  const insertBillStmt = sqlite.prepare(
    `INSERT INTO bills (id, branch_id, po_seq, po_number, party_id, party_snapshot_json, format_id, extra_cols_json, paper_override, round_off, footer_extras_json, tail_rows_json, bill_date,
       totals_json, item_row_count, revision, created_at, updated_at, deleted_at, sync_state)
     VALUES (@id, @branchId, @poSeq, @poNumber, @partyId, @partySnapshotJson, @formatId, @extraColsJson, @paperOverride, @roundOff, @footerExtrasJson, @tailRowsJson, @billDate,
       @totalsJson, @itemRowCount, @revision, @createdAt, @updatedAt, @deletedAt, @syncState)`
  )
  const updateBillStmt = sqlite.prepare(
    `UPDATE bills SET party_id = @partyId, party_snapshot_json = @partySnapshotJson, format_id = @formatId, extra_cols_json = @extraColsJson,
       paper_override = @paperOverride, round_off = @roundOff, footer_extras_json = @footerExtrasJson, tail_rows_json = @tailRowsJson, bill_date = @billDate, totals_json = @totalsJson, item_row_count = @itemRowCount,
       revision = @revision, updated_at = @updatedAt WHERE id = @id`
  )
  const recordStmt = sqlite.prepare(
    `SELECT id, branch_id AS branchId, po_seq AS poSeq, po_number AS poNumber, party_id AS partyId, party_snapshot_json AS partySnapshotJson,
       format_id AS formatId, extra_cols_json AS extraColsJson, paper_override AS paperOverride, round_off AS roundOff, footer_extras_json AS footerExtrasJson, tail_rows_json AS tailRowsJson, bill_date AS billDate, totals_json AS totalsJson,
       item_row_count AS itemRowCount, revision, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState,
       legacy_ref AS legacyRef, import_batch_id AS importBatchId, import_fingerprint AS importFingerprint
     FROM bills WHERE id = ?`
  )
  const rowsStmt = sqlite.prepare(
    `SELECT id, bill_id AS billId, idx, name_runs_json AS nameRunsJson, name_plain AS namePlain, qty, rate, total_override AS totalOverride,
       gst_rate AS gstRate, extras_json AS extrasJson, cell_style_json AS cellStyleJson FROM bill_rows WHERE bill_id = ? ORDER BY idx`
  )
  // Phase 42: soft delete = tombstone. The revision is bumped so a later sync pull can tell the tombstone from the live copy.
  const softDeleteStmt = sqlite.prepare('UPDATE bills SET deleted_at = @at, updated_at = @at, revision = revision + 1 WHERE id = @id AND deleted_at IS NULL')
  const deleteRowsStmt = sqlite.prepare('DELETE FROM bill_rows WHERE bill_id = ?')
  const insertRowStmt = sqlite.prepare(
    `INSERT INTO bill_rows (id, bill_id, idx, name_runs_json, name_plain, qty, rate, total_override, gst_rate, extras_json, cell_style_json)
     VALUES (@id, @billId, @idx, @nameRunsJson, @namePlain, @qty, @rate, @totalOverride, @gstRate, @extrasJson, @cellStyleJson)`
  )
  const insertRevStmt = sqlite.prepare(
    'INSERT INTO bill_revisions (id, bill_id, revision, snapshot_json, saved_at, saved_by_branch) VALUES (@id, @billId, @revision, @snapshotJson, @savedAt, @savedByBranch)'
  )
  // Phase 44: count-based (a delete / restore bumps `revision` without a row, so "latest - 50" would keep fewer than 50).
  const pruneStmt = sqlite.prepare(
    'DELETE FROM bill_revisions WHERE bill_id = @billId AND id NOT IN (SELECT id FROM bill_revisions WHERE bill_id = @billId ORDER BY revision DESC LIMIT @keep)'
  )
  const listRevStmt = sqlite.prepare(
    `SELECT revision, saved_at AS savedAt, saved_by_branch AS savedByBranch,
            CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json, '$.bill.billDate') END AS billDate,
            CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json, '$.bill.partySnapshotJson') END AS partyJson,
            CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json, '$.bill.totalsJson') END AS totalsJson,
            CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json, '$.bill.itemRowCount') END AS itemRowCount
     FROM bill_revisions WHERE bill_id = ? ORDER BY revision DESC`
  )
  const getRevStmt = sqlite.prepare('SELECT revision, saved_at AS savedAt, saved_by_branch AS savedByBranch, snapshot_json AS snapshotJson FROM bill_revisions WHERE bill_id = ? AND revision = ?')

  return {
    getHead: (id: string): StoredBillHead | undefined => headStmt.get(id) as StoredBillHead | undefined,
    /** Raw stored shapes (Drizzle property names) — `deserializeBill` validates them. */
    getRecord: (id: string): unknown => recordStmt.get(id),
    getRows: (id: string): unknown[] => rowsStmt.all(id),
    /** Marks one bill deleted (trash). Returns whether a live bill was found. */
    softDelete: (id: string, at: string): boolean => softDeleteStmt.run({ id, at }).changes > 0,
    insertBill: (b: BillRecord): void => { insertBillStmt.run({ ...b, roundOff: b.roundOff ?? 0, footerExtrasJson: b.footerExtrasJson ?? '{}', tailRowsJson: b.tailRowsJson ?? '[]' }) },
    updateBill: (b: BillRecord): void => { updateBillStmt.run({ ...b, roundOff: b.roundOff ?? 0, footerExtrasJson: b.footerExtrasJson ?? '{}', tailRowsJson: b.tailRowsJson ?? '[]' }) },
    replaceRows: (billId: string, rows: readonly BillRowRecord[]): void => {
      deleteRowsStmt.run(billId)
      for (const r of rows) insertRowStmt.run(r)
    },
    insertRevision: (r: { id: string; billId: string; revision: number; snapshotJson: string; savedAt: string; savedByBranch: string }): void => { insertRevStmt.run(r) },
    /** Keeps the newest `keep` revisions of a bill (`REVISION_MAX_PER_BILL`, 50). */
    pruneRevisions: (billId: string, keep = REVISION_MAX_PER_BILL): void => { pruneStmt.run({ billId, keep }) },
    /** Phase 44: the revisions of a bill, newest first, with just the fields the list shows (snapshots are not parsed in JS). */
    listRevisions: (billId: string): RevisionListRow[] => listRevStmt.all(billId) as RevisionListRow[],
    /** Phase 44: one stored revision (raw snapshot JSON), or undefined. */
    getRevision: (billId: string, revision: number): StoredRevision | undefined => getRevStmt.get(billId, revision) as StoredRevision | undefined,
    /** `BEGIN IMMEDIATE`: takes the write lock up front, so two saves (even from two connections) serialise cleanly. */
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
export type BillRepo = ReturnType<typeof createBillRepo>
