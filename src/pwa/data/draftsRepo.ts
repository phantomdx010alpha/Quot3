/** Phone drafts (Phase 176): autosave of the open bill and crash recovery. One draft per bill id, in the `drafts` store.
 *  Create ALWAYS opens a clean bill (hard rule A31): a draft is only ever OFFERED (`listDrafts` / `inspectDraft`), never loaded by itself.
 *  A successful `saveBill` deletes that bill's draft in its own transaction (billsRepo). Pure data layer: no UI, no timers
 *  (the editor decides when to call `saveDraft`). */
import '../../shared/format'
import { normalizeBill } from '../../shared/billModel'
import { isEntryBlank } from '../../shared/gridModel'
import type { Bill } from '../../shared/types'
import { deleteRecord, getAllRecords, getRecord, putRecord, type PhoneDb } from './db'

export interface DraftRecord {
  /** The bill id being edited (a new bill's id is made when the editor opens). */
  id: string
  /** The revision the editor opened, or null for a bill never saved. Used to tell a stale draft. */
  base_revision: number | null
  saved_at: string
  /** The bill exactly as in the editor (trailing blank rows included), JSON. */
  bill_json: string
}

export interface Draft {
  id: string
  baseRevision: number | null
  savedAt: string
  bill: Bill
}

/** A draft is worth keeping when the owner typed something: a party field or any row that is not blank. */
export function isDraftWorthKeeping(bill: Pick<Bill, 'party' | 'rows'>): boolean {
  const p = bill.party
  if ([p?.name, p?.phone, p?.address, p?.transport].some((s) => typeof s === 'string' && s.trim() !== '')) return true
  return bill.rows.some((r) => !isEntryBlank(r))
}

/** Writes (or replaces) the draft of this bill. A bill with nothing typed deletes its draft instead. Returns whether a draft is now stored. */
export async function saveDraft(db: PhoneDb, bill: Bill, o: { baseRevision?: number | null; now?: () => Date } = {}): Promise<boolean> {
  if (!isDraftWorthKeeping(bill)) {
    await deleteRecord(db, 'drafts', bill.id)
    return false
  }
  const rec: DraftRecord = {
    id: bill.id, base_revision: o.baseRevision ?? null, saved_at: (o.now ?? (() => new Date()))().toISOString(), bill_json: JSON.stringify(bill)
  }
  await putRecord(db, 'drafts', rec)
  return true
}

/** Parses a stored draft; anything unreadable is `undefined` (a damaged draft is skipped, never thrown). */
export function parseDraft(rec: DraftRecord | undefined): Draft | undefined {
  if (!rec || typeof rec.bill_json !== 'string') return undefined
  try {
    const raw = JSON.parse(rec.bill_json) as Partial<Bill> | null
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id === '' || !Array.isArray(raw.rows) || typeof raw.formatId !== 'string') return undefined
    const bill = normalizeBill(raw as Bill)
    return { id: rec.id, baseRevision: typeof rec.base_revision === 'number' ? rec.base_revision : null, savedAt: rec.saved_at, bill }
  } catch {
    return undefined
  }
}

export async function getDraft(db: PhoneDb, id: string): Promise<Draft | undefined> {
  return parseDraft(await getRecord<DraftRecord>(db, 'drafts', id))
}

/** Every readable draft, newest first. */
export async function listDrafts(db: PhoneDb): Promise<Draft[]> {
  const all = await getAllRecords<DraftRecord>(db, 'drafts')
  return all.map(parseDraft).filter((d): d is Draft => d !== undefined).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0))
}

/** The newest readable draft, for the \"Recover your unsaved bill?\" offer at start. */
export async function latestDraft(db: PhoneDb): Promise<Draft | undefined> {
  return (await listDrafts(db))[0]
}

export async function deleteDraft(db: PhoneDb, id: string): Promise<void> {
  await deleteRecord(db, 'drafts', id)
}

export type DraftStatus = 'new' | 'current' | 'stale' | 'bill-deleted'

/** How a draft relates to the stored bill: `new` (never saved), `current` (the bill is still at the revision the draft opened),
 *  `stale` (the bill changed since, e.g. synced from another branch: recovering it would overwrite that), `bill-deleted` (in the trash). */
export async function inspectDraft(db: PhoneDb, d: Draft): Promise<DraftStatus> {
  const head = await getRecord<{ revision: number; deletedAt: string | null }>(db, 'bills', d.id)
  if (!head) return 'new'
  if (head.deletedAt !== null) return 'bill-deleted'
  return d.baseRevision === head.revision ? 'current' : 'stale'
}
