/** Phase 28 — pure rules for the unsaved-changes guard (no DOM, no Electron). KEYBOARD_CELL_RULES §6. */

export type GuardChoice = 'save' | 'discard' | 'cancel'

/** Prompt only when the bill differs from its saved / opened state (`dirty` already ignores grid padding and survives undo-to-clean). */
export function needsPrompt(s: { dirty: boolean }): boolean {
  return s.dirty
}

/** Phase 95 - what `requestLeave` does for a given state. 'proceed' = nothing unfinished (saved / discarded / fresh / clean); 'ask' = open the dialog; 'ignore' = the dialog is already up, never stack a second one. */
export type LeaveDecision = 'proceed' | 'ask' | 'ignore'
export function leaveDecision(s: { billId: string | null; dirty: boolean; guardOpen: boolean }): LeaveDecision {
  if (s.billId === null || !needsPrompt({ dirty: s.dirty })) return 'proceed' // no bill (discarded / cleared) or nothing differs from saved
  return s.guardOpen ? 'ignore' : 'ask'
}

/** An auto-repeating Esc (key held) must never navigate or re-open the dialog: only a fresh key press counts. */
export function ignoreEscRepeat(e: { key: string; repeat: boolean }): boolean {
  return e.key === 'Escape' && e.repeat
}

export function guardCopy(saved: boolean): { title: string; message: string; saveLabel: string } {
  return saved
    ? { title: 'Save changes?', message: 'This bill has changes that are not saved yet.', saveLabel: 'Save changes' }
    : { title: 'Save this bill?', message: 'This bill has not been saved yet.', saveLabel: 'Save' }
}

/** Dialog hot-keys: S / D / Esc (no modifiers are handled by the caller). */
export function choiceFromKey(key: string): GuardChoice | null {
  if (key === 'Escape') return 'cancel'
  const k = key.length === 1 ? key.toLowerCase() : ''
  if (k === 's') return 'save'
  if (k === 'd') return 'discard'
  return null
}
