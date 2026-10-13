import { randomUUID } from 'node:crypto'
import type { DraftRepo } from '../db/draftRepo'
import { AppError } from '../ipc/envelope'
import { DRAFT_STALE_DAYS } from '../../shared/constants'
import { parseDraftPayload, staleCutoff, summarizeDraft, type DraftSummary } from '../../shared/draft'
import type { Bill } from '../../shared/types'

export interface DraftSaveInput {
  /** Omitted → a new id is generated (the renderer always sends the bill-session id so repeated saves update ONE row). */
  draftId?: string
  /** Set when the draft is an edit of a saved bill. */
  billId?: string
  /** `JSON.stringify(DraftPayload)`. */
  payload: string
}
export interface DraftFull {
  id: string
  billId: string | null
  updatedAt: string
  bill: Bill
}

export interface DraftService {
  save(input: DraftSaveInput): { draftId: string; updatedAt: string }
  /** Recoverable drafts, newest first. Unreadable ones are left out (never offered), not deleted. */
  list(): DraftSummary[]
  get(id: string): DraftFull
  /** Idempotent: deleting a draft that does not exist is fine. */
  delete(id: string): { deleted: boolean }
  /** Removes drafts untouched for more than `days` (default 14) and writes ONE audit row when it removed any. Returns the count. */
  cleanupStale(days?: number): number
}

export function createDraftService(
  repo: DraftRepo,
  opts: { writable?: boolean; now?: () => Date; newId?: () => string; branchId?: () => string | null } = {}
): DraftService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  return {
    save({ draftId, billId, payload }) {
      guard()
      const parsed = parseDraftPayload(payload)
      if (!parsed.ok) throw new AppError('VALIDATION', `Draft not stored — ${parsed.reason}`)
      const id = draftId ?? newId()
      const updatedAt = now().toISOString()
      repo.upsert({ id, billId: billId ?? null, payloadJson: payload, updatedAt })
      return { draftId: id, updatedAt }
    },
    list() {
      const out: DraftSummary[] = []
      for (const r of repo.list()) {
        const s = summarizeDraft(r)
        if (s) out.push(s)
      }
      return out
    },
    get(id) {
      const r = repo.get(id)
      if (!r) throw new AppError('NOT_FOUND', 'That unsaved bill no longer exists')
      const p = parseDraftPayload(r.payloadJson)
      if (!p.ok) throw new AppError('DB_ERROR', `The unsaved bill could not be read (${p.reason})`)
      return { id: r.id, billId: r.billId, updatedAt: r.updatedAt, bill: p.bill }
    },
    delete(id) {
      guard()
      return { deleted: repo.delete(id) }
    },
    cleanupStale(days = DRAFT_STALE_DAYS) {
      guard()
      const at = now()
      return repo.transaction(() => {
        const stale = repo.staleBefore(staleCutoff(at, days))
        if (stale.length === 0) return 0
        for (const d of stale) repo.delete(d.id)
        repo.audit({
          at: at.toISOString(), branchId: opts.branchId?.() ?? null, entity: 'draft', entityId: null, action: 'cleanup',
          detailJson: JSON.stringify({ removed: stale.length, olderThanDays: days, ids: stale.map((d) => d.id) })
        })
        return stale.length
      })
    }
  }
}
