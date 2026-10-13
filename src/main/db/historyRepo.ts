import type Database from 'better-sqlite3'
import type { BillCursor } from '../../shared/history/historyList'
import type { BillListItem, HistoryBranch, HistoryDate } from '../../shared/history/historyList'
import type { SearchCandidate } from '../../shared/history/historySearch'

/** Phase 86: `source` null = every bill; `batch` null = any import batch. */
export interface SourceArgs { source: 'created' | 'imported' | null; batch: string | null }
const NO_SOURCE: SourceArgs = { source: null, batch: null }

/**
 * The only SQL behind the History lists (Phase 41). Reads `bills` / `branches` only; the party name and the grand total come
 * from the cached `party_snapshot_json` / `totals_json` columns through `json_extract`, so no bill row is parsed in JS.
 * Trashed bills (`deleted_at` set) never appear.
 */
export function createHistoryRepo(sqlite: Database.Database) {
  const datesStmt = sqlite.prepare(
    `SELECT bill_date AS date, count(*) AS count FROM bills
     WHERE deleted_at IS NULL AND (@branch IS NULL OR branch_id = @branch)
       AND (@from IS NULL OR bill_date >= @from) AND (@to IS NULL OR bill_date <= @to)
       AND (@source IS NULL OR (@source = 'imported' AND import_batch_id IS NOT NULL) OR (@source = 'created' AND import_batch_id IS NULL))
       AND (@batch IS NULL OR import_batch_id = @batch)
     GROUP BY bill_date ORDER BY bill_date DESC`
  )
  const billsStmt = sqlite.prepare(
    `SELECT id, po_number AS poNumber, po_seq AS poSeq, bill_date AS billDate,
            json_extract(party_snapshot_json, '$.name') AS partyName,
            json_extract(totals_json, '$.grandTotal') AS grandTotal,
            branch_id AS branchId, revision, created_at AS createdAt, sync_state AS syncState,
            legacy_ref AS legacyRef, import_batch_id AS importBatchId
     FROM bills
     WHERE deleted_at IS NULL
       AND (@date IS NULL OR bill_date = @date)
       AND (@branch IS NULL OR branch_id = @branch)
       AND (@from IS NULL OR bill_date >= @from) AND (@to IS NULL OR bill_date <= @to)
       AND (@source IS NULL OR (@source = 'imported' AND import_batch_id IS NOT NULL) OR (@source = 'created' AND import_batch_id IS NULL))
       AND (@batch IS NULL OR import_batch_id = @batch)
       AND (@cDate IS NULL OR (bill_date, created_at, id) < (@cDate, @cAt, @cId))
     ORDER BY bill_date DESC, created_at DESC, id DESC
     LIMIT @limit`
  )
  // Phase 42: every bill in range with its item names, newest first; ranking happens in shared/history/historySearch.ts.
  const searchStmt = sqlite.prepare(
    `SELECT b.id, b.po_number AS poNumber, b.po_seq AS poSeq, b.bill_date AS billDate,
            json_extract(b.party_snapshot_json, '$.name') AS partyName,
            json_extract(b.totals_json, '$.grandTotal') AS grandTotal,
            b.branch_id AS branchId, b.revision, b.sync_state AS syncState,
            b.legacy_ref AS legacyRef, b.import_batch_id AS importBatchId,
            COALESCE((SELECT group_concat(r.name_plain, ' ') FROM bill_rows r WHERE r.bill_id = b.id), '') AS itemText
     FROM bills b
     WHERE b.deleted_at IS NULL
       AND (@branch IS NULL OR b.branch_id = @branch)
       AND (@from IS NULL OR b.bill_date >= @from) AND (@to IS NULL OR b.bill_date <= @to)
       AND (@source IS NULL OR (@source = 'imported' AND b.import_batch_id IS NOT NULL) OR (@source = 'created' AND b.import_batch_id IS NULL))
       AND (@batch IS NULL OR b.import_batch_id = @batch)
     ORDER BY b.bill_date DESC, b.created_at DESC, b.id DESC`
  )
  const branchesStmt = sqlite.prepare('SELECT id, name, is_local AS isLocal FROM branches ORDER BY is_local DESC, name, id')

  type BillRow = Omit<BillListItem, 'partyName' | 'grandTotal' | 'legacyRef' | 'importBatchId'> & { partyName: string | null; grandTotal: string | number | null; createdAt: string; legacyRef: string | null; importBatchId: string | null }
  const tags = (r: { legacyRef: string | null; importBatchId: string | null }): { legacyRef?: string; importBatchId?: string } => ({
    ...(r.legacyRef ? { legacyRef: r.legacyRef } : {}), ...(r.importBatchId ? { importBatchId: r.importBatchId } : {})
  })

  return {
    listDates: (branch: string | null, from: string | null = null, to: string | null = null, src: SourceArgs = NO_SOURCE): HistoryDate[] => datesStmt.all({ branch, from, to, source: src.source, batch: src.batch }) as HistoryDate[],

    /** Up to `limit` rows after `cursor` (the caller asks for one extra row to learn whether another page exists). */
    listBills(q: { date: string | null; branch: string | null; from?: string | null; to?: string | null; cursor: BillCursor | null; limit: number; src?: SourceArgs }): Array<BillListItem & { createdAt: string }> {
      const rows = billsStmt.all({
        date: q.date, branch: q.branch, from: q.from ?? null, to: q.to ?? null, limit: q.limit, source: q.src?.source ?? null, batch: q.src?.batch ?? null,
        cDate: q.cursor?.date ?? null, cAt: q.cursor?.createdAt ?? null, cId: q.cursor?.id ?? null
      }) as BillRow[]
      return rows.map((r) => ({
        id: r.id, poNumber: r.poNumber, poSeq: r.poSeq, billDate: r.billDate,
        partyName: r.partyName ?? '', grandTotal: r.grandTotal === null ? '' : String(r.grandTotal),
        branchId: r.branchId, revision: r.revision, createdAt: r.createdAt, syncState: r.syncState, ...tags(r)
      }))
    },

    searchCandidates(q: { branch: string | null; from: string | null; to: string | null; src?: SourceArgs }): SearchCandidate[] {
      const rows = searchStmt.all({ branch: q.branch, from: q.from, to: q.to, source: q.src?.source ?? null, batch: q.src?.batch ?? null }) as Array<Omit<SearchCandidate, 'partyName' | 'grandTotal' | 'legacyRef' | 'importBatchId'> & { partyName: string | null; grandTotal: string | number | null; legacyRef: string | null; importBatchId: string | null }>
      return rows.map(({ legacyRef, importBatchId, ...r }) => ({ ...r, partyName: r.partyName ?? '', grandTotal: r.grandTotal === null ? '' : String(r.grandTotal), ...tags({ legacyRef, importBatchId }) }))
    },

    branches: (): HistoryBranch[] =>
      (branchesStmt.all() as Array<{ id: string; name: string; isLocal: number }>).map((b) => ({ id: b.id, name: b.name, isLocal: b.isLocal === 1 }))
  }
}

export type HistoryRepo = ReturnType<typeof createHistoryRepo>
