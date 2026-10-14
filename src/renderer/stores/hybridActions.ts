import { flushSync } from 'react-dom'
import { buildGridColumns, remapColumnKey } from '@shared/gridModel'
import { resolveFormat } from '@shared/format/registry'
import { canHybrid, otherSide } from '@shared/hybrid/hybrid'
import type { HybridSide } from '@shared/types'
import { create } from 'zustand'
import { useBillStore } from './billStore'
import { useGridUiStore } from './gridUiStore'
import { historyHooks } from './historyHooks'
import { sideOfRowId } from './tableApi'

/**
 * Phase 151 - Hybrid (GST + Non-GST side by side) actions: Alt+3, the table switch, the explicit re-copy. The grid stays the owner of
 * focus: a typed-but-uncommitted cell is committed first (so undo stays in order), and focus only moves back into the grid when it
 * was already there (or in the palette that ran this), exactly like `switchFormat`.
 */
const notice = (t: string): void => useGridUiStore.getState().setNotice(t)

/** UI-only: which table the "Re-copy from the other side" confirmation targets (null = closed). Never saved. */
interface HybridUiState { recopyTarget: HybridSide | null; askRecopy: (t: HybridSide) => void; closeRecopy: () => void }
export const useHybridUiStore = create<HybridUiState>((set) => ({
  recopyTarget: null,
  askRecopy: (t) => set({ recopyTarget: t }),
  closeRecopy: () => set({ recopyTarget: null })
}))

/** Alt+3. Turns the Hybrid view on (creating the second table the first time only; a second Alt+3 never overwrites it). */
export function enterHybrid(): boolean {
  const s = useBillStore.getState()
  if (s.hybrid?.active && s.formatId === s.hybrid.primary) { notice('Already in Hybrid. Ctrl+Alt+Left / Right switches table'); return false }
  if (!canHybrid(s.toBill())) { notice('Hybrid works on a GST or Non-GST bill (switch to one first)'); return false }
  const port = historyHooks.selection
  const ae = typeof document === 'undefined' ? null : document.activeElement
  const wasInGrid = !!ae?.closest?.('.q3-grid')
  const fromPalette = !!ae?.closest?.('[role="dialog"]')
  port?.flush()
  const sel = port?.get() ?? null
  let result: ReturnType<typeof s.enterHybridView> = null
  flushSync(() => { result = useBillStore.getState().enterHybridView() })
  if (result === null) return false
  if (sel && (wasInGrid || fromPalette)) port?.restore(sel)
  notice(result === 'created' ? 'Hybrid: the second table was copied from this bill (Ctrl+Z undoes)' : 'Hybrid view on (the second table is kept as you left it)')
  return true
}

/** Where the active cell goes when Hybrid is left: the same row / column of the primary table (a second-table cell maps by position). */
export function selectionAfterLeavingHybrid(): { rowId: string; colKey: string; range: null } | null {
  const sel = historyHooks.selection?.get() ?? null
  if (!sel) return null
  const s = useBillStore.getState()
  if (sideOfRowId(sel.rowId) !== 'second' || !s.second) return { rowId: sel.rowId, colKey: sel.colKey, range: null }
  const at = Math.max(0, s.second.view.navIds.indexOf(sel.rowId))
  const ids = s.view.navIds
  const rowId = ids[Math.min(at, ids.length - 1)] ?? s.view.bodyIds[0] ?? sel.rowId
  const oldKeys = buildGridColumns(resolveFormat(s.second.formatId), s.extraCols).map((c) => c.key)
  const newKeys = buildGridColumns(resolveFormat(s.formatId), s.extraCols).filter((c) => c.editable).map((c) => c.key)
  return { rowId, colKey: remapColumnKey(oldKeys, newKeys, sel.colKey) ?? sel.colKey, range: null }
}

/** Ctrl+Alt+Left / Right: put the cursor in the first (primary, left) or second (right) table. */
export function focusHybridTable(side: 'primary' | 'second'): boolean {
  const s = useBillStore.getState()
  if (!s.hybrid?.active) { notice('Switch to Hybrid first (Alt+3)'); return false }
  historyHooks.selection?.flush()
  const root = document.querySelector<HTMLElement>(`.q3-hy-pane[data-side="${side}"] [role="grid"]`)
  if (!root) return false
  root.focus()
  return true
}

/** The table the cursor is in (the second one when the active cell is a second-table row), for "re-copy THIS table". */
export function activeHybridSide(): HybridSide | null {
  const s = useBillStore.getState()
  if (!s.hybrid) return null
  const sel = historyHooks.selection?.get() ?? null
  const second = otherSide(s.hybrid.primary)
  return sel && sideOfRowId(sel.rowId) === 'second' ? second : s.hybrid.primary
}

/** Palette: ask before replacing the table the cursor is in with fresh copies of the other table's items. */
export function requestRecopy(): boolean {
  const s = useBillStore.getState()
  if (!s.hybrid) { notice('This bill has no second table yet (Alt+3 creates it)'); return false }
  historyHooks.selection?.flush()
  const target = activeHybridSide()
  if (!target) return false
  useHybridUiStore.getState().askRecopy(target)
  return true
}

export function confirmRecopy(): boolean {
  const target = useHybridUiStore.getState().recopyTarget
  useHybridUiStore.getState().closeRecopy()
  if (!target) return false
  const sel = historyHooks.selection?.get() ?? null
  let ok = false
  flushSync(() => { ok = useBillStore.getState().recopyTable(target) })
  if (sel) historyHooks.selection?.restore(sel)
  notice(ok ? 'Re-copied from the other table (Ctrl+Z undoes)' : 'Nothing to re-copy')
  return ok
}
