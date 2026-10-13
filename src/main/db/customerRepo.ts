import type Database from 'better-sqlite3'
import type { BillCursor, BillListItem } from '../../shared/history/historyList'
import type { BillStatRow } from '../../shared/customers/customerList'

/**
 * The only SQL behind the Customers page stats and a customer's bill list (Phase 45). Writes to `parties` live in `partyRepo`.
 * Trashed bills (`deleted_at` set) are never counted or listed. Totals are returned as cached strings; summing happens in
 * `shared/customers/customerList.ts` with decimal.js, never in SQL.
 */
export function createCustomerRepo(sqlite: Database.Database) {
  const statsStmt = sqlite.prepare(
    `SELECT party_id AS partyId, bill_date AS billDate, json_extract(totals_json, '$.grandTotal') AS grandTotal
     FROM bills WHERE deleted_at IS NULL AND party_id IS NOT NULL`
  )
  const billsStmt = sqlite.prepare(
    `SELECT id, po_number AS poNumber, po_seq AS poSeq, bill_date AS billDate,
            json_extract(party_snapshot_json, '$.name') AS partyName,
            json_extract(totals_json, '$.grandTotal') AS grandTotal,
            branch_id AS branchId, revision, created_at AS createdAt
     FROM bills
     WHERE deleted_at IS NULL AND party_id = @partyId
       AND (@cDate IS NULL OR (bill_date, created_at, id) < (@cDate, @cAt, @cId))
     ORDER BY bill_date DESC, created_at DESC, id DESC
     LIMIT @limit`
  )
  const auditStmt = sqlite.prepare(
    'INSERT INTO audit_log (at, branch_id, entity, entity_id, action, detail_json) VALUES (@at, @branchId, @entity, @entityId, @action, @detailJson)'
  )
  type BillRow = Omit<BillListItem, 'partyName' | 'grandTotal'> & { partyName: string | null; grandTotal: string | number | null; createdAt: string }

  return {
    /** One row per live bill that is linked to a customer. */
    billStats: (): BillStatRow[] => statsStmt.all() as BillStatRow[],

    /** Up to `limit` live bills of one customer after `cursor`, newest first (the caller asks for one extra to learn if more exist). */
    billsOf(q: { partyId: string; cursor: BillCursor | null; limit: number }): Array<BillListItem & { createdAt: string }> {
      const rows = billsStmt.all({ partyId: q.partyId, limit: q.limit, cDate: q.cursor?.date ?? null, cAt: q.cursor?.createdAt ?? null, cId: q.cursor?.id ?? null }) as BillRow[]
      return rows.map((r) => ({
        id: r.id, poNumber: r.poNumber, poSeq: r.poSeq, billDate: r.billDate,
        partyName: r.partyName ?? '', grandTotal: r.grandTotal === null ? '' : String(r.grandTotal),
        branchId: r.branchId, revision: r.revision, createdAt: r.createdAt
      }))
    },

    audit: (a: { at: string; branchId: string | null; entity: string; entityId: string | null; action: string; detailJson: string | null }): void => { auditStmt.run(a) }
  }
}
export type CustomerRepo = ReturnType<typeof createCustomerRepo>
