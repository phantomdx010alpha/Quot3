import { buildGridColumns } from '@shared/gridModel'
import { resolveFormat } from '@shared/format/registry'
import { applyColWidths, COL_WIDTH_STEP_PX, currentColWidth } from '@shared/columnWidths'
import { useBillStore } from './billStore'
import { sideOfRowId, tableApi } from './tableApi'
import { useColWidthStore } from './columnWidthStore'
import { useGridUiStore } from './gridUiStore'
import { historyHooks } from './historyHooks'

/** Phase 23 — keyboard/palette column sizing. Targets the active cell's column (so the keyboard path exists without the mouse handle). */
export function stepActiveColWidth(dir: 1 | -1): boolean {
  const sel = historyHooks.selection?.get() ?? null
  if (!sel) { useGridUiStore.getState().setNotice('Select a cell first to resize its column'); return false }
  const s = tableApi(sideOfRowId(sel.rowId)) // Phase 151: the column of the table the active cell is in
  const w = useColWidthStore.getState()
  const cols = applyColWidths(buildGridColumns(resolveFormat(s.formatId), s.extraCols), w.overrides[s.formatId])
  const cur = currentColWidth(cols, sel.colKey)
  if (cur === null) return false
  w.set(s.formatId, sel.colKey, cur + dir * COL_WIDTH_STEP_PX)
  return true
}
export function resetColumnWidths(): void {
  useColWidthStore.getState().resetAll(useBillStore.getState().formatId)
  useGridUiStore.getState().setNotice('Column widths reset')
}
