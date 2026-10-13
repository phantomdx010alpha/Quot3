import { describeTrashItems, isEmptyTrashConfirm } from '@shared/trash'
import { describeBills } from '@shared/history/historyList'
import { useHistoryStore } from './historyStore'
import { useSaveUiStore } from './saveUiStore'
import { useTrashStore } from './trashStore'

/** Phase 43 - Recently deleted actions. Results are announced through the same status line as the other History actions. */
const say = (tone: 'ok' | 'warn' | 'danger', msg: string): void => useSaveUiStore.getState().announce(tone, msg)

/** Ctrl+Shift+D: show / hide the Recently deleted view. */
export async function toggleTrash(): Promise<void> {
  const t = useTrashStore.getState()
  if (t.open) {
    await t.setOpen(false)
    useHistoryStore.getState().focusBills?.()
    return
  }
  await t.setOpen(true)
  queueMicrotask(() => useTrashStore.getState().focusList?.())
}

/** Called by `confirmDelete` right after a successful delete: starts the 10 s "Undo delete" offer. */
export function offerUndoDelete(ids: string[], label: string): void {
  if (ids.length > 0) useTrashStore.getState().offerUndo(ids, label)
}

/** Ctrl+Z on History while the offer is alive: restore the bills that were just deleted, then refresh the list. */
export async function undoLastDelete(): Promise<boolean> {
  const offer = useTrashStore.getState().undoOffer
  if (!offer) { say('warn', 'Nothing to undo'); return false }
  const restored = await useTrashStore.getState().restoreIds(offer.ids)
  useTrashStore.getState().dismissUndo()
  if (restored.length === 0) { say('danger', 'Could not undo the delete - the bill is no longer in Recently deleted'); return false }
  await useHistoryStore.getState().refresh()
  say('ok', `Restored ${restored.length === 1 ? offer.label : `${restored.length} bills`}`)
  useHistoryStore.getState().focusBills?.()
  return true
}

/** Enter / the Restore button inside the view. */
export async function restoreSelected(): Promise<boolean> {
  const targets = useTrashStore.getState().targets()
  if (targets.length === 0) { say('warn', 'Nothing to restore - select a bill first'); return false }
  const restored = await useTrashStore.getState().restoreIds(targets.map((b) => b.id))
  if (restored.length === 0) { say('danger', 'Nothing was restored'); return false }
  await useHistoryStore.getState().refresh()
  say('ok', `Restored ${describeTrashItems(targets.filter((b) => restored.includes(b.id)))} - same bill number${restored.length === 1 ? '' : 's'}`)
  useTrashStore.getState().focusList?.()
  return true
}

export function requestPurge(): boolean {
  if (!useTrashStore.getState().askPurge()) { say('warn', 'Nothing to delete - select a bill first'); return false }
  return true
}
export async function confirmPurge(): Promise<boolean> {
  const pending = useTrashStore.getState().confirmPurge
  if (!pending) return false
  const purged = await useTrashStore.getState().purgeNow()
  useTrashStore.getState().focusList?.()
  if (purged.length === 0) { say('danger', 'Nothing was deleted'); return false }
  say('ok', `Deleted ${describeBills(pending.filter((b) => purged.includes(b.id)))} forever`)
  return true
}
export function cancelPurge(): void {
  useTrashStore.getState().cancelPurge()
  useTrashStore.getState().focusList?.()
}

export function requestEmptyTrash(): boolean {
  if (!useTrashStore.getState().askEmpty()) { say('warn', 'Recently deleted is already empty'); return false }
  return true
}
/** The Empty dialog's confirm: only when the typed word matches. */
export async function confirmEmptyTrash(): Promise<boolean> {
  const t = useTrashStore.getState()
  if (!t.confirmEmpty || !isEmptyTrashConfirm(t.emptyText)) return false
  const n = await t.emptyNow()
  useTrashStore.getState().focusList?.()
  if (n === 0) { say('warn', 'Nothing was deleted'); return false }
  say('ok', `Emptied Recently deleted - ${n} ${n === 1 ? 'bill' : 'bills'} deleted forever`)
  return true
}
export function cancelEmptyTrash(): void {
  useTrashStore.getState().cancelEmpty()
  useTrashStore.getState().focusList?.()
}

