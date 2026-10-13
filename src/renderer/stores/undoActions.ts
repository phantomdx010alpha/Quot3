import { jumpNotice, buildHistoryRows, undoNotice } from '@shared/history/historyView'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { useUndoUiStore } from './undoUiStore'

/**
 * Phase 18 — the single place the bottom-bar buttons, the history panel and the palette/hotkeys run undo-related
 * commands, so each one reports the same transient status message as Ctrl+Z in the grid.
 */
const notice = (t: string): void => useGridUiStore.getState().setNotice(t)

export function runUndo(): boolean {
  const st = useBillStore.getState()
  const label = st.undoLabel
  const ok = st.undo()
  notice(undoNotice('undo', ok, label))
  return ok
}
export function runRedo(): boolean {
  const st = useBillStore.getState()
  const label = st.redoLabel
  const ok = st.redo()
  notice(undoNotice('redo', ok, label))
  return ok
}
/** Jump so entries 0..index are applied (-1 = original state). */
export function runJump(index: number): boolean {
  const st = useBillStore.getState()
  const row = buildHistoryRows(st.historyList(), st.historyCursor()).find((r) => r.index === index) ?? null
  const ok = st.jumpTo(index)
  notice(jumpNotice(ok, row))
  return ok
}
/** Ctrl+Alt+Z / palette: ask first when there is something to revert; otherwise just say so. */
export function requestRevert(): void {
  if (!useBillStore.getState().dirty) { notice('Nothing to revert — no changes since the last save'); return }
  useUndoUiStore.getState().openRevert()
}
export function confirmRevert(): boolean {
  useUndoUiStore.getState().closeRevert()
  const ok = useBillStore.getState().revertToSaved()
  notice(ok ? 'Reverted to last saved (Ctrl+Z to undo)' : 'Nothing to revert — no changes since the last save')
  return ok
}
