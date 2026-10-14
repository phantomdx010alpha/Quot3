import { useBillStore } from './billStore'

/**
 * Phase 151 - one grid, one table. The grid controller and the cells address a TABLE: the primary table is the bill store itself,
 * the Hybrid second table is `store.second` (its own rows / view / layout) with its edits routed to the `*Second*` store actions
 * (same undo history, shared extra cells go to the primary twin). `tableApi('second')` is a view of the store state in which the
 * table fields and the row edits are swapped for the second table's; everything else (undo, free cells, extra columns, party...) is
 * the store's own. Memoised per store state, so it costs nothing per keystroke.
 */
export type TableSide = 'primary' | 'second'
export type TableApi = ReturnType<typeof useBillStore.getState>

let memo: { s: TableApi; api: TableApi } | null = null

export function tableApi(side: TableSide): TableApi {
  const s = useBillStore.getState()
  if (side === 'primary' || !s.second) return s
  if (memo?.s === s) return memo.api
  const t = s.second
  const api: TableApi = {
    ...s,
    rows: t.rows, view: t.view, formatId: t.formatId,
    setCellText: (rowId, colKey, text) => s.setSecondCellTexts([{ rowId, colKey, text }]),
    setCellTexts: s.setSecondCellTexts,
    setNameRuns: s.setSecondNameRuns,
    resetTotal: s.resetSecondTotal,
    toggleMark: s.toggleSecondMark,
    deleteRows: s.deleteSecondRows,
    moveRow: s.moveSecondRow,
    ensureBodyRows: s.ensureSecondBodyRows
  }
  memo = { s, api }
  return api
}

/** Which table a row id belongs to (a total / tail row id is shared and counts as the primary table). */
export function sideOfRowId(rowId: string): TableSide {
  const s = useBillStore.getState()
  return s.second && s.second.view.body[rowId] !== undefined && s.view.body[rowId] === undefined ? 'second' : 'primary'
}
