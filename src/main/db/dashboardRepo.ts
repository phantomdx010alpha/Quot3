import type Database from 'better-sqlite3'
import type { BillListItem } from '../../shared/history/historyList'
import type { DayRow } from '../../shared/dashboard/dashboardStats'

/** The only SQL behind the Dashboard stats (Phase 46). Live bills only; totals come back as cached strings and are summed in JS with decimal.js. */
export function createDashboardRepo(sqlite: Database.Database) {
  const daysStmt = sqlite.prepare(
    `SELECT bill_date AS billDate, json_extract(totals_json, '$.grandTotal') AS grandTotal FROM bills WHERE deleted_at IS NULL AND bill_date >= ?`
  )
  const recentStmt = sqlite.prepare(
    `SELECT id, po_number AS poNumber, po_seq AS poSeq, bill_date AS billDate,
            json_extract(party_snapshot_json, '$.name') AS partyName,
            json_extract(totals_json, '$.grandTotal') AS grandTotal,
            branch_id AS branchId, revision
     FROM bills WHERE deleted_at IS NULL ORDER BY bill_date DESC, created_at DESC, id DESC LIMIT ?`
  )
  type Recent = Omit<BillListItem, 'partyName' | 'grandTotal'> & { partyName: string | null; grandTotal: string | number | null }
  return {
    daysSince: (from: string): DayRow[] => daysStmt.all(from) as DayRow[],
    recent: (limit: number): BillListItem[] =>
      (recentStmt.all(limit) as Recent[]).map((r) => ({ ...r, partyName: r.partyName ?? '', grandTotal: r.grandTotal === null ? '' : String(r.grandTotal) }))
  }
}
export type DashboardRepo = ReturnType<typeof createDashboardRepo>
