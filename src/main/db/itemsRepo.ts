import type Database from 'better-sqlite3'
import type { BillRow } from '../../shared/types'

/** What `bills` says about one bill: enough to know whether the cached sales lines are still right. */
export interface BillSignature { id: string; revision: number; updatedAt: string; deletedAt: string | null }
export interface BillHeadRow {
  id: string; poNumber: string; billDate: string; createdAt: string; formatId: string
  partyId: string | null; partyName: string; legacyRef: string | null
}
export interface LoadedBill { head: BillHeadRow; rows: BillRow[] }

/**
 * Phase 110 - the only SQL behind the Items read model. READ-ONLY: it never writes (the page never mutates bills). A row whose
 * name JSON is malformed is skipped instead of breaking the whole index.
 * Trashed bills (`deleted_at` set) are never returned by `loadBills` / `countLive`.
 */
export function createItemsRepo(sqlite: Database.Database) {
  const sigStmt = sqlite.prepare('SELECT id, revision, updated_at AS updatedAt, deleted_at AS deletedAt FROM bills')
  const countStmt = sqlite.prepare('SELECT COUNT(*) AS n FROM bills WHERE deleted_at IS NULL')
  const headsStmt = sqlite.prepare(
    `SELECT id, po_number AS poNumber, bill_date AS billDate, created_at AS createdAt, format_id AS formatId, party_id AS partyId,
            COALESCE(json_extract(party_snapshot_json, '$.name'), '') AS partyName, legacy_ref AS legacyRef
     FROM bills WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(@ids))`
  )
  const rowsStmt = sqlite.prepare(
    `SELECT bill_id AS billId, idx, name_runs_json AS nameRunsJson, qty, rate, total_override AS totalOverride, gst_rate AS gstRate
     FROM bill_rows WHERE bill_id IN (SELECT value FROM json_each(@ids)) ORDER BY bill_id, idx`
  )
  const oneStmt = sqlite.prepare(
    "SELECT id, po_number AS poNumber, bill_date AS billDate, COALESCE(json_extract(party_snapshot_json, '$.name'), '') AS partyName FROM bills WHERE id = ? AND deleted_at IS NULL"
  )

  type RawRow = { billId: string; idx: number; nameRunsJson: string; qty: string | null; rate: string | null; totalOverride: string | null; gstRate: string | null }
  const toRow = (r: RawRow): BillRow | null => {
    let runs: unknown
    try { runs = JSON.parse(r.nameRunsJson) } catch { return null }
    if (!Array.isArray(runs)) return null
    const nameRuns = runs.filter((x): x is { t: string } => typeof x === 'object' && x !== null && typeof (x as { t?: unknown }).t === 'string') as BillRow['nameRuns']
    return { id: `${r.billId}:${r.idx}`, idx: r.idx, nameRuns, qty: r.qty, rate: r.rate, totalOverride: r.totalOverride, gstRate: r.gstRate, extras: {} }
  }

  return {
    signatures: (): BillSignature[] => sigStmt.all() as BillSignature[],
    countLive: (): number => (countStmt.get() as { n: number }).n,

    /** The live bills among `ids` with their rows (ids that are trashed, purged or unknown are simply absent). */
    loadBills(ids: readonly string[]): LoadedBill[] {
      if (ids.length === 0) return []
      const json = JSON.stringify(ids)
      const heads = headsStmt.all({ ids: json }) as BillHeadRow[]
      const byBill = new Map<string, BillRow[]>()
      for (const raw of rowsStmt.all({ ids: json }) as RawRow[]) {
        const row = toRow(raw)
        if (!row) continue
        const list = byBill.get(raw.billId)
        if (list) list.push(row); else byBill.set(raw.billId, [row])
      }
      return heads.map((head) => ({ head, rows: byBill.get(head.id) ?? [] }))
    },

    /** A live bill's open target, or null (unknown / in the trash). */
    bill: (id: string): { id: string; poNumber: string; billDate: string; partyName: string } | null =>
      (oneStmt.get(id) as { id: string; poNumber: string; billDate: string; partyName: string } | undefined) ?? null
  }
}

export type ItemsRepo = ReturnType<typeof createItemsRepo>
