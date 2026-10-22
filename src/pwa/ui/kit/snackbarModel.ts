/** Phase 191 - the snackbar state machine. Pure: time is passed in. ONE message at a time; a different message replaces the current one; an IDENTICAL
 *  message never stacks (same snack, timer restarted), like the desktop toasts. */
export const SNACK_MS = 6000

export interface Snack { id: number; message: string; hasUndo: boolean; expiresAt: number }
export interface SnackState { current: Snack | null; seq: number }

export const EMPTY_SNACK: SnackState = { current: null, seq: 0 }

export function showSnack(s: SnackState, input: { message: string; hasUndo?: boolean }, nowMs: number): SnackState {
  const hasUndo = input.hasUndo === true
  const cur = s.current
  if (cur && cur.message === input.message && cur.hasUndo === hasUndo) {
    return { ...s, current: { ...cur, expiresAt: nowMs + SNACK_MS } }
  }
  const seq = s.seq + 1
  return { seq, current: { id: seq, message: input.message, hasUndo, expiresAt: nowMs + SNACK_MS } }
}

/** Clears the snack once its time is up. Returns the SAME object when nothing changes. */
export function tickSnack(s: SnackState, nowMs: number): SnackState {
  return s.current && nowMs >= s.current.expiresAt ? { ...s, current: null } : s
}

export function dismissSnack(s: SnackState): SnackState {
  return s.current ? { ...s, current: null } : s
}
