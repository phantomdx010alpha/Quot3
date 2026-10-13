import { PARTY_FIELDS, finalizePartyField } from '@shared/partyFields'
import { prepareBillForSave, validateBillForSave, type SaveIssue } from '@shared/billSave'
import type { Quot3Bridge, SaveBillResponse } from '@shared/ipc'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { usePartyIndexStore } from './partyIndexStore'
import { usePartyUiStore } from './partyUiStore'
import { useSaveUiStore } from './saveUiStore'
import { historyHooks } from './historyHooks'
import { forgetDraft } from './draftAutosave'
import { endSessionAfterSave } from './createSession'

/**
 * Phase 27 — Ctrl+S / palette "Save bill". Order: commit the typed-but-uncommitted cell text → tidy the party fields
 * (an undoable entry only if something actually changes) → validate (missing party name focuses the Party name field,
 * no rows keeps you in the grid) → `bills:save` → on success show the PO number, record the result, mark the bill saved
 * (dirty flag clears; history is kept) and reload the party index so a new party is suggested next time.
 */
export type SaveOutcome =
  | { ok: true; result: SaveBillResponse }
  | { ok: false; reason: 'validation'; issue: SaveIssue }
  | { ok: false; reason: 'busy' | 'no-bill' | 'no-bridge' }
  | { ok: false; reason: 'error'; code: string; message: string }

type SaveBridge = Pick<Quot3Bridge, 'bills'>
const bridge = (): SaveBridge | undefined => (window as unknown as { quot3?: SaveBridge }).quot3

const notice = (t: string): void => useGridUiStore.getState().setNotice(t)

export async function runSave(): Promise<SaveOutcome> {
  const ui = useSaveUiStore.getState()
  if (ui.saving) return { ok: false, reason: 'busy' }
  const first = useBillStore.getState()
  if (first.billId === null) return { ok: false, reason: 'no-bill' }

  // 1. A cell still being typed in is committed first, exactly like a format switch does.
  historyHooks.selection?.flush()

  // 2. Save-time party tidy-up (trim). Goes through the store so undo / dirty / the saved snapshot stay consistent.
  for (const f of PARTY_FIELDS) {
    const cur = useBillStore.getState().party[f]
    const fin = finalizePartyField(f, cur)
    if (fin !== cur) useBillStore.getState().setPartyField(f, fin)
  }

  // 3. Validate on the client first so the owner lands on the missing field; main re-validates anyway.
  const bill = prepareBillForSave(useBillStore.getState().toBill())
  const issue = validateBillForSave(bill)
  if (issue) {
    notice(issue.message)
    ui.announce('warn', issue.message)
    if (issue.code === 'PARTY_NAME_REQUIRED') usePartyUiStore.getState().focusParty?.()
    else useGridUiStore.getState().refocus?.()
    return { ok: false, reason: 'validation', issue }
  }

  const api = bridge()?.bills
  if (!api) {
    notice('Saving is not available (no connection to the app)')
    return { ok: false, reason: 'no-bridge' }
  }

  ui.setSaving(true)
  try {
    const s = useBillStore.getState()
    const existing = s.poNumber !== ''
    const res = await api.save({
      bill: {
        id: bill.id, party: bill.party, formatId: bill.formatId, extraCols: bill.extraCols,
        paperOverride: bill.paperOverride, billDate: bill.billDate, rows: bill.rows,
        ...(bill.footerExtras ? { footerExtras: bill.footerExtras } : {}), ...(bill.tailRows ? { tailRows: bill.tailRows } : {})
      },
      ...(existing ? { expectedRevision: s.meta.revision } : {})
    })
    if (!res.ok) {
      const msg = res.error.code === 'CONFLICT_REVISION'
        ? 'Not saved — this bill was changed elsewhere since you opened it. Nothing was overwritten.'
        : `Not saved — ${res.error.message}`
      notice(msg)
      ui.announce('danger', msg)
      return { ok: false, reason: 'error', code: res.error.code, message: res.error.message }
    }
    useBillStore.getState().applySaved(res.data)
    useBillStore.getState().markSaved()
    endSessionAfterSave() // Phase 70: the next Create visit is a blank bill
    void forgetDraft(bill.id) // Phase 29: a saved bill needs no draft
    void usePartyIndexStore.getState().load()
    const msg = `Saved ${res.data.poNumber}`
    notice(msg)
    ui.announce('ok', msg)
    useGridUiStore.getState().refocus?.()
    return { ok: true, result: res.data }
  } catch (e) {
    const msg = 'Not saved — something went wrong talking to the database'
    notice(msg)
    ui.announce('danger', msg)
    return { ok: false, reason: 'error', code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
  } finally {
    useSaveUiStore.getState().setSaving(false)
  }
}
