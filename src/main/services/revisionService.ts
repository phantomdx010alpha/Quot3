import { deserializeBill } from '../../shared/billModel'
import type { RestoreDraft, RevisionDetail, RevisionSummary } from '../../shared/revisions'
import type { Bill } from '../../shared/types'
import type { BillRepo } from '../db/billRepo'
import { AppError } from '../ipc/envelope'

export interface RevisionService {
  /** Stored revisions of a live bill, newest first. */
  list(billId: string): RevisionSummary[]
  /** One revision as a full bill. */
  get(billId: string, revision: number): RevisionDetail
  /**
   * "Restore this revision": the bill as the editor should show it (`draft`, the revision's content under the bill's CURRENT
   * identity / revision number) next to what is stored now (`baseline`). Writes nothing - the owner saves or discards.
   */
  restoreToDraft(billId: string, revision: number): RestoreDraft
}

const tolerant = <T>(raw: string | null, pick: (v: Record<string, unknown>) => T, fallback: T): T => {
  if (raw === null) return fallback
  try {
    const v: unknown = JSON.parse(raw)
    return v !== null && typeof v === 'object' ? pick(v as Record<string, unknown>) : fallback
  } catch { return fallback }
}

/** Phase 44 - Revision history (undo layer L4). Revisions are WRITTEN by `billService.save`; this reads them and builds the restore. */
export function createRevisionService(deps: { bills: BillRepo }): RevisionService {
  const { bills } = deps

  const liveHead = (billId: string): NonNullable<ReturnType<BillRepo['getHead']>> => {
    const head = bills.getHead(billId)
    if (!head || head.deletedAt !== null) throw new AppError('NOT_FOUND', 'Bill not found')
    return head
  }
  const current = (billId: string): Bill => {
    const parsed = deserializeBill(bills.getRecord(billId), bills.getRows(billId))
    if (!parsed.ok) throw new AppError('DB_ERROR', `This bill's stored data is damaged (${parsed.error})`)
    return parsed.data
  }
  const revisionBill = (billId: string, revision: number): { bill: Bill; savedAt: string; savedByBranch: string } => {
    const stored = bills.getRevision(billId, revision)
    if (!stored) throw new AppError('NOT_FOUND', `Revision ${revision} was not found (only the newest 50 are kept)`)
    let snap: { bill?: unknown; rows?: unknown }
    try { snap = JSON.parse(stored.snapshotJson) as { bill?: unknown; rows?: unknown } } catch { throw new AppError('DB_ERROR', `Revision ${revision} is damaged (invalid JSON)`) }
    const parsed = deserializeBill(snap.bill, Array.isArray(snap.rows) ? snap.rows : [])
    if (!parsed.ok) throw new AppError('DB_ERROR', `Revision ${revision} is damaged (${parsed.error})`)
    return { bill: parsed.data, savedAt: stored.savedAt, savedByBranch: stored.savedByBranch }
  }

  return {
    list(billId) {
      const head = liveHead(billId)
      const rows = bills.listRevisions(billId)
      return rows.map((r, i) => ({
        revision: r.revision,
        savedAt: r.savedAt,
        savedByBranch: r.savedByBranch,
        billDate: r.billDate ?? '',
        partyName: tolerant(r.partyJson, (v) => (typeof v['name'] === 'string' ? v['name'] : ''), ''),
        grandTotal: tolerant(r.totalsJson, (v) => (v['grandTotal'] === undefined || v['grandTotal'] === null ? '' : String(v['grandTotal'])), ''),
        itemRowCount: r.itemRowCount ?? 0,
        isCurrent: i === 0 && r.revision === head.revision
      }))
    },

    get(billId, revision) {
      liveHead(billId)
      const r = revisionBill(billId, revision)
      return { revision, savedAt: r.savedAt, savedByBranch: r.savedByBranch, bill: r.bill }
    },

    restoreToDraft(billId, revision) {
      liveHead(billId)
      const baseline = current(billId)
      const r = revisionBill(billId, revision)
      // The bill keeps its own identity: PO number, branch, creation time and the CURRENT revision number (so the next Save's
      // expectedRevision matches). Only the editable content comes from the revision.
      const draft: Bill = {
        ...r.bill,
        id: baseline.id, branchId: baseline.branchId, poSeq: baseline.poSeq, poNumber: baseline.poNumber, partyId: baseline.partyId,
        revision: baseline.revision, createdAt: baseline.createdAt, updatedAt: baseline.updatedAt, deletedAt: null, syncState: baseline.syncState
      }
      return { draft, baseline, fromRevision: revision }
    }
  }
}
