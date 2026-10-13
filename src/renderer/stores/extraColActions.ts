import { flushSync } from 'react-dom'
import { buildGridColumns, remapColumnKey } from '@shared/gridModel'
import { resolveFormat } from '@shared/format/registry'
import { extraColHasData, MAX_EXTRA_COLS } from '@shared/extraCols'
import { freeColumnHasData } from '@shared/freeCells'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { useExtraColUiStore } from './extraColUiStore'
import { historyHooks } from './historyHooks'

/**
 * Phase 21 — the single place the toolbar, hotkeys and palette run extra-column commands (UNDO_REDO_RULES §2.7,
 * EXTRA_COLS_UNITS_RULES §5). Add/remove/rename are each ONE undoable entry (`billStore`). The active cell's uncommitted
 * draft is committed first so undo order stays correct, and the active cell is re-seated afterwards (on the new column
 * after Add; on the nearest surviving column after Remove).
 */
const notice = (t: string): void => useGridUiStore.getState().setNotice(t)

/** The extra column a command targets: the active cell's column when it is an extra one, else the last extra column. */
export function targetExtraColKey(): string | null {
  const s = useBillStore.getState()
  if (s.extraCols.length === 0) return null
  const sel = historyHooks.selection?.get() ?? null
  if (sel && s.extraCols.some((c) => c.key === sel.colKey)) return sel.colKey
  return (s.extraCols[s.extraCols.length - 1] as { key: string }).key
}

export function runAddExtraCol(): string | null {
  const port = historyHooks.selection
  port?.flush()
  const sel = port?.get() ?? null
  let key: string | null = null
  flushSync(() => { key = useBillStore.getState().addExtraCol() })
  if (!key) { notice(`At most ${MAX_EXTRA_COLS} extra columns`); return null }
  const header = useBillStore.getState().extraCols.find((c) => c.key === key)?.header ?? ''
  if (sel) port?.restore({ rowId: sel.rowId, colKey: key, range: null })
  notice(`Added column '${header}' (Ctrl+Z to undo)`)
  return key
}

/** Ask-first removal: a column holding data opens the confirmation; an empty one goes straight away (still undoable). */
export function requestRemoveExtraCol(key: string | null = targetExtraColKey()): void {
  const s = useBillStore.getState()
  if (!key || !s.extraCols.some((c) => c.key === key)) { notice('No extra column to remove'); return }
  historyHooks.selection?.flush()
  const cur = useBillStore.getState()
  if (extraColHasData(cur.rows, key) || freeColumnHasData(cur.footerExtras, cur.tailRows, key)) useExtraColUiStore.getState().askRemove(key)
  else confirmRemoveExtraCol(key)
}

export function confirmRemoveExtraCol(key: string | null = useExtraColUiStore.getState().removeKey): boolean {
  useExtraColUiStore.getState().closeRemove()
  if (!key) return false
  const port = historyHooks.selection
  port?.flush()
  const sel = port?.get() ?? null
  const before = useBillStore.getState()
  const name = before.extraCols.find((c) => c.key === key)?.header ?? ''
  const oldKeys = buildGridColumns(resolveFormat(before.formatId), before.extraCols).filter((c) => c.editable).map((c) => c.key)
  let ok = false
  flushSync(() => { ok = useBillStore.getState().removeExtraCol(key) })
  if (!ok) return false
  if (sel) {
    const next = useBillStore.getState()
    const newKeys = buildGridColumns(resolveFormat(next.formatId), next.extraCols).filter((c) => c.editable).map((c) => c.key)
    const colKey = remapColumnKey(oldKeys, newKeys, sel.colKey)
    if (colKey) port?.restore({ rowId: sel.rowId, colKey, range: null })
  }
  notice(`Removed column '${name}' (Ctrl+Z to undo)`)
  return true
}

export function requestRenameExtraCol(key: string | null = targetExtraColKey()): void {
  if (!key) { notice('No extra column to rename'); return }
  historyHooks.selection?.flush()
  useExtraColUiStore.getState().startRename(key)
}

/** Header editor result: `null` = cancelled. Emptied/unchanged text keeps the old header. */
export function commitRenameExtraCol(key: string, text: string | null): void {
  useExtraColUiStore.getState().endRename()
  if (text !== null) useBillStore.getState().renameExtraCol(key, text)
  useGridUiStore.getState().refocus?.()
}

/** Phase 22 — Ctrl+M: mark/unmark the active cell when it is in an extra column (it becomes / stops being a segment header). */
export function runToggleMark(): boolean | null {
  const port = historyHooks.selection
  port?.flush()
  const sel = port?.get() ?? null
  const s = useBillStore.getState()
  if (!sel || !s.extraCols.some((c) => c.key === sel.colKey)) { notice('Select a cell in an extra column to mark it'); return null }
  const r = s.toggleMark(sel.rowId, sel.colKey)
  if (r !== null) notice(r ? 'Marked — this cell now starts its own segment (Ctrl+M again to unmark)' : 'Unmarked')
  return r
}
export function openUnitsPopup(view: 'units' | 'marked'): void {
  historyHooks.selection?.flush()
  useExtraColUiStore.getState().openUnits(view)
}
