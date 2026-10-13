import type Database from 'better-sqlite3'
import { formatPoNumber } from '../../shared/po'

export interface AllocatedPo {
  seq: number
  poNumber: string
}

/**
 * Atomically takes the next PO sequence for a branch. Uses a single UPDATE ... RETURNING, so two callers can
 * never receive the same number, and it nests safely inside the caller's bill-save transaction (Phase 27):
 * if that transaction rolls back, the increment rolls back with it (no gaps, no duplicates).
 */
export function allocatePoNumber(sqlite: Database.Database, branchId: string): AllocatedPo {
  const row = sqlite
    .transaction(() =>
      sqlite
        .prepare(
          `UPDATE po_counters SET next_seq = next_seq + 1 WHERE branch_id = ?
           RETURNING next_seq - 1 AS seq, (SELECT po_prefix FROM branches WHERE id = ?) AS prefix`
        )
        .get(branchId, branchId)
    )() as { seq: number; prefix: string } | undefined
  if (!row) throw new Error(`No PO counter for branch ${branchId}`)
  return { seq: row.seq, poNumber: formatPoNumber(row.prefix, row.seq) }
}

/** Read-only preview of what the next allocation would produce (for the Create page, Phase 25/27). */
export function peekNextPoNumber(sqlite: Database.Database, branchId: string): string {
  const row = sqlite
    .prepare('SELECT c.next_seq AS seq, b.po_prefix AS prefix FROM po_counters c JOIN branches b ON b.id = c.branch_id WHERE c.branch_id = ?')
    .get(branchId) as { seq: number; prefix: string } | undefined
  if (!row) throw new Error(`No PO counter for branch ${branchId}`)
  return formatPoNumber(row.prefix, row.seq)
}
