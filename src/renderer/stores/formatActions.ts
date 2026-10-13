import { flushSync } from 'react-dom'
import { buildGridColumns, remapColumnKey } from '@shared/gridModel'
import { hasFormat, resolveFormat } from '@shared/format/registry'
import { useBillStore } from './billStore'
import { historyHooks } from './historyHooks'

/**
 * Phase 20 — switch the bill's format (Alt+1 / Alt+2, toolbar switcher, palette). One undoable entry ("Switched to GST");
 * rows are never touched. The active cell's typed-but-uncommitted text is committed first (so it is not lost and undo
 * stays in order), then the cell is re-activated on the same logical column — or the nearest one that still exists —
 * in Append mode with a collapsed range (a range's columns may be gone). Focus is only moved back into the grid when it
 * was already there (or in the command palette that ran this); from any other field the grid is not stolen from.
 * Returns false for an unknown format id or when the format is already active.
 */
export function switchFormat(formatId: string): boolean {
  if (!hasFormat(formatId)) return false
  const s = useBillStore.getState()
  if (s.formatId === formatId) return false
  const port = historyHooks.selection
  const ae = typeof document === 'undefined' ? null : document.activeElement
  const wasInGrid = !!ae?.closest?.('.q3-grid')
  const fromPalette = !!ae?.closest?.('[role="dialog"]')
  port?.flush()
  const sel = port?.get() ?? null
  const oldKeys = buildGridColumns(resolveFormat(s.formatId), s.extraCols).map((c) => c.key)
  flushSync(() => useBillStore.getState().setFormatId(formatId))
  if (sel && (wasInGrid || fromPalette)) {
    const next = useBillStore.getState()
    const newKeys = buildGridColumns(resolveFormat(next.formatId), next.extraCols).filter((c) => c.editable).map((c) => c.key)
    const colKey = remapColumnKey(oldKeys, newKeys, sel.colKey)
    if (colKey) port?.restore({ rowId: sel.rowId, colKey, range: null })
  }
  return true
}
