/** Phase 191 - "Undo" for removing an item row. Pure. Built over the editor model's own `removeRow` (editorModel.ts is not edited); restores the SAME row
 *  (every field, cells and styles included) at the same place inside its group (item rows / adjustments) and renumbers `idx`. */
import type { BillRow } from '../../../shared/types'
import { removeRow, type EditorState } from '../editor/editorModel'

export interface RowRemoval {
  row: BillRow
  group: 'item' | 'adj'
  /** Position inside its own group at the time of removal. */
  index: number
  /** True when it was the last item row: the editor blanks it instead of removing it, so undo puts the content back into that row. */
  blanked: boolean
}

const renumber = (rows: readonly BillRow[]): BillRow[] => rows.map((r, i) => (r.idx === i ? r : { ...r, idx: i }))

export function removeRowWithUndo(s: EditorState, id: string): { state: EditorState; removal: RowRemoval | null } {
  const row = s.bill.rows.find((r) => r.id === id)
  if (!row) return { state: s, removal: null }
  const isAdj = s.adjIds.includes(id)
  const group = s.bill.rows.filter((r) => s.adjIds.includes(r.id) === isAdj)
  const index = group.findIndex((r) => r.id === id)
  const state = removeRow(s, id)
  const blanked = state.bill.rows.some((r) => r.id === id)
  return { state, removal: { row, group: isAdj ? 'adj' : 'item', index, blanked } }
}

export function restoreRemoval(s: EditorState, removal: RowRemoval): EditorState {
  const { row } = removal
  const present = s.bill.rows.some((r) => r.id === row.id)
  if (removal.blanked) {
    if (!present) return s
    const rows = s.bill.rows.map((r) => (r.id === row.id ? { ...row, idx: r.idx } : r))
    return { ...s, bill: { ...s.bill, rows } }
  }
  if (present) return s
  const adj = new Set(s.adjIds)
  const items = s.bill.rows.filter((r) => !adj.has(r.id))
  const adjRows = s.bill.rows.filter((r) => adj.has(r.id))
  const target = removal.group === 'item' ? items : adjRows
  target.splice(Math.min(removal.index, target.length), 0, row)
  const adjIds = removal.group === 'adj' ? adjRows.map((r) => r.id) : s.adjIds
  return { ...s, bill: { ...s.bill, rows: renumber([...items, ...adjRows]) }, adjIds }
}
