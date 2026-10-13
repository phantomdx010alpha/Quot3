import { create } from 'zustand'
import { leaveDecision } from '@shared/dirtyGuard'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { historyHooks } from './historyHooks'
import { runSave } from './saveActions'
import { forgetDraft } from './draftAutosave'
import { createSession } from './createSession'

/**
 * Phase 28 — the unsaved-changes guard. `requestLeave(proceed)` runs `proceed` right away when the open bill is clean
 * (including a brand-new untouched bill, or one undone back to its saved state); otherwise it opens the Save / Discard /
 * Cancel dialog and runs `proceed` only after Save succeeds or Discard is chosen.
 */
interface GuardState {
  open: boolean
  /** The bill has been saved before ("Save changes?") vs never saved ("Save this bill?"). */
  saved: boolean
  busy: boolean
  pending: (() => void) | null
}
export const useGuardStore = create<GuardState>(() => ({ open: false, saved: false, busy: false, pending: null }))

/** Typed-but-uncommitted cell text is committed first so it counts. */
export function isBillDirty(): boolean {
  historyHooks.selection?.flush()
  const s = useBillStore.getState()
  return leaveDecision({ billId: s.billId, dirty: s.dirty, guardOpen: false }) !== 'proceed'
}

/** Returns true when `proceed` ran immediately. */
export function requestLeave(proceed: () => void): boolean {
  historyHooks.selection?.flush()
  const b = useBillStore.getState()
  const d = leaveDecision({ billId: b.billId, dirty: b.dirty, guardOpen: useGuardStore.getState().open })
  if (d === 'proceed') { proceed(); return true }
  if (d === 'ignore') return false
  useGuardStore.setState({ open: true, saved: useBillStore.getState().poNumber !== '', pending: proceed, busy: false })
  return false
}

const close = (): (() => void) | null => {
  const p = useGuardStore.getState().pending
  useGuardStore.setState({ open: false, pending: null, busy: false })
  return p
}

export async function chooseSave(): Promise<void> {
  if (useGuardStore.getState().busy) return
  useGuardStore.setState({ busy: true })
  const r = await runSave()
  const p = close()
  if (r.ok) p?.() // on failure the dialog just closes: focus is already on the missing field / the error is shown
}

export function chooseDiscard(): void {
  if (useGuardStore.getState().busy) return
  // Phase 95: a discarded bill must not stay "dirty" (updateStore, drafts and the guard all read the flag): make it clean, then forget it.
  useBillStore.getState().markSaved()
  const p = close()
  void forgetDraft(useBillStore.getState().billId) // Phase 29: a discarded bill must not come back from its draft
  createSession.set(null)
  useBillStore.setState({ billId: null })
  p?.()
}

export function chooseCancel(): void {
  if (useGuardStore.getState().busy) return // a Save is in flight: its outcome closes the dialog, Esc must not orphan it
  close()
  useGridUiStore.getState().refocus?.()
}
