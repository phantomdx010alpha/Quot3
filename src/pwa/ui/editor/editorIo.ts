/** Editor <-> phone data layer glue (Phase 182). Async, no React. Create ALWAYS opens a clean bill (hard rule A31): a saved draft is only
 *  OFFERED through `findRecoverable`, never loaded by itself. */
import { getSetting } from '../../data/settingsRepo'
import { describeSaveFailure } from '../../platform/storageErrors'
import { getMetaValue } from '../../data/metaRepo'
import { BillError, getBill } from '../../data/billsRepo'
import { saveBillWithParty } from '../../data/partiesRepo'
import { deleteDraft, getDraft, inspectDraft, listDrafts, saveDraft, type Draft } from '../../data/draftsRepo'
import { ROUND_OFF_SETTING_KEY } from '../../../shared/calc/billOptions'
import type { PhoneDb } from '../../data/db'
import { withOutbox } from '../../sync/outbox'
import { phoneEditBlockReason } from '../billViewModel'
import { openExistingBill, openNewBill, openRecoveredNew, toSaveInput, type EditorState } from './editorModel'
import { localIsoDate } from '../dashboardModel'

export type OpenResult =
  | { kind: 'ready'; state: EditorState }
  | { kind: 'read-only'; reason: string }
  | { kind: 'missing'; message: string }

/** A new clean bill (no id -> new) or the stored bill with this id. A trashed bill, a missing bill or one the phone cannot edit does not open. */
export async function openEditor(db: PhoneDb, id: string | undefined, now: Date): Promise<OpenResult> {
  if (id === undefined) {
    const branchId = (await getMetaValue(db, 'branch_id')) ?? ''
    const roundOff = (await getSetting<unknown>(db, ROUND_OFF_SETTING_KEY, true)) !== false
    return { kind: 'ready', state: openNewBill({ branchId, roundOff, today: localIsoDate(now), now: now.toISOString() }) }
  }
  let bill
  try {
    bill = await getBill(db, id)
  } catch (e) {
    if (e instanceof BillError) return { kind: 'missing', message: e.message }
    throw e
  }
  if (bill.deletedAt !== null) return { kind: 'missing', message: 'This bill is in Recently deleted. Restore it first.' }
  const reason = phoneEditBlockReason(bill)
  if (reason) return { kind: 'read-only', reason }
  return { kind: 'ready', state: openExistingBill(bill) }
}

/** The draft the owner may recover: for a new bill the newest draft of a bill never saved; for an edit the draft of that bill if the bill is
 *  still at the revision the draft opened (a bill that changed since, e.g. by sync, is NOT offered: recovering would overwrite it). */
export async function findRecoverable(db: PhoneDb, id: string | undefined): Promise<Draft | undefined> {
  if (id !== undefined) {
    const d = await getDraft(db, id)
    return d && (await inspectDraft(db, d)) === 'current' ? d : undefined
  }
  for (const d of await listDrafts(db)) if ((await inspectDraft(db, d)) === 'new') return d
  return undefined
}

export async function recoverDraft(db: PhoneDb, d: Draft): Promise<EditorState> {
  if (d.baseRevision === null) return openRecoveredNew(d.bill)
  const stored = await getBill(db, d.id)
  return openExistingBill(d.bill, { baseline: stored })
}

export async function autosave(db: PhoneDb, s: EditorState, now?: () => Date): Promise<void> {
  if (!db.canWrite()) return
  await saveDraft(db, s.bill, { baseRevision: s.baseRevision, now })
}

export async function discardDraft(db: PhoneDb, id: string): Promise<void> {
  if (db.canWrite()) await deleteDraft(db, id)
}

export type SaveOutcome =
  | { ok: true; id: string; poNumber: string; revision: number }
  | { ok: false; message: string }

/** Saves the bill and its customer in one transaction, queued for sync. A refusal becomes a message, never a throw. */
export async function saveEditorBill(db: PhoneDb, s: EditorState, onChanged?: () => void): Promise<SaveOutcome> {
  if (!db.canWrite()) return { ok: false, message: 'This tab is read-only. Close the other window of the app and try again.' }
  try {
    const r = await saveBillWithParty(db, toSaveInput(s), { ...withOutbox() })
    onChanged?.()
    return { ok: true, id: r.id, poNumber: r.poNumber, revision: r.revision }
  } catch (e) {
    if (e instanceof BillError) {
      if (e.code === 'NO_BRANCH') return { ok: false, message: 'Set up this phone as a branch first (Settings), then save.' }
      return { ok: false, message: e.message }
    }
    return { ok: false, message: describeSaveFailure(e) }
  }
}
