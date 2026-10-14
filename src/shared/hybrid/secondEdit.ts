/**
 * Phase 151 - pure edits of the Hybrid SECOND table (the primary table keeps using the normal row edits). Contract: API_CONTRACTS.md
 * "Phase 151 as built". Everything returns NEW objects, never mutates its input, and has no DOM / Electron / floating-point money.
 *
 * State shape: `{ rows, hybrid }` = the primary rows + the second table (`hybrid.rows`, laid out in the OTHER format). Extra-column
 * cells are SHARED (rule 7): a second row paired in `hybrid.twins` shows - and writes - the cell of its primary row. A second row with
 * no twin keeps its own cells. Row operations (delete / move) work on positions exactly like the primary table (extras stay put).
 */
import { applyCellText } from '../gridEdit'
import type { GridColumn } from '../gridModel'
import { toggleMarkCell } from '../extraCols'
import { runsEqual } from '../richtext/runs'
import { deleteItemRows } from '../rows/deleteRows'
import { moveItemRow } from '../rows/moveRows'
import type { BillRow, HybridSecond, Id, Runs } from '../types'

export interface TwoTables {
  /** The primary table's rows (`bill.rows`). */
  rows: BillRow[]
  hybrid: HybridSecond
}

// Resolved rows are memoised per raw second row (+ the twin's extras object), so an unchanged row keeps its identity and the
// per-row calc cache (keyed by row object) still hits.
const resolved = new WeakMap<BillRow, { extras: BillRow['extras']; out: BillRow }>()

/** The second table's rows with their shared extra cells filled in from the twin (same objects when nothing changed). */
export function resolveSecondRows(rows: readonly BillRow[], h: HybridSecond): BillRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  return h.rows.map((r) => {
    const twinId = h.twins[r.id]
    const src = twinId ? byId.get(twinId) : undefined
    if (!src) return r
    const hit = resolved.get(r)
    if (hit && hit.extras === src.extras) return hit.out
    const out: BillRow = { ...r, extras: src.extras }
    resolved.set(r, { extras: src.extras, out })
    return out
  })
}

interface RowPatch { rowId: Id; patch: Partial<BillRow> }

/** Applies row patches to the second table; an `extras` patch goes to the primary twin (shared cell) when there is one. */
function applyPatches(t: TwoTables, patches: readonly RowPatch[]): TwoTables | null {
  if (patches.length === 0) return null
  const h = t.hybrid
  const secondIdx = new Map(h.rows.map((r, i) => [r.id, i]))
  const primaryIdx = new Map(t.rows.map((r, i) => [r.id, i]))
  let second: BillRow[] | null = null
  let primary: BillRow[] | null = null
  for (const { rowId, patch } of patches) {
    const si = secondIdx.get(rowId)
    if (si === undefined) continue
    const { extras, ...own } = patch
    if (extras !== undefined) {
      const twinId = h.twins[rowId]
      const pi = twinId === undefined ? undefined : primaryIdx.get(twinId)
      if (pi !== undefined) {
        if (!primary) primary = t.rows.slice()
        primary[pi] = { ...(primary[pi] as BillRow), extras }
      } else if (!second) {
        second = h.rows.slice()
        second[si] = { ...(second[si] as BillRow), extras }
      } else second[si] = { ...(second[si] as BillRow), extras }
    }
    if (Object.keys(own).length > 0) {
      if (!second) second = h.rows.slice()
      second[si] = { ...(second[si] as BillRow), ...own }
    }
  }
  if (!second && !primary) return null
  return { rows: primary ?? t.rows, hybrid: second ? { ...h, rows: second } : h }
}

/**
 * Commits typed text into second-table cells (same rules as `setCellTexts`: an invalid numeric draft changes nothing). `cols` = the
 * second table's grid columns; `display(rowId, colKey)` = what the cell showed (Total uses it to ignore an unchanged visit).
 * A styled item name paste carries `runs`. Returns null when nothing changed.
 */
export function editSecondCells(
  t: TwoTables,
  cells: ReadonlyArray<{ rowId: Id; colKey: string; text: string; runs?: Runs }>,
  cols: readonly Pick<GridColumn, 'key' | 'kind' | 'editable' | 'isExtra'>[],
  display: (rowId: Id, colKey: string) => string
): TwoTables | null {
  const rows = new Map(resolveSecondRows(t.rows, t.hybrid).map((r) => [r.id, r]))
  const patches: RowPatch[] = []
  for (const c of cells) {
    const col = cols.find((x) => x.key === c.colKey)
    const cur = rows.get(c.rowId)
    if (!col || !cur) continue
    const patch = c.runs && col.key === 'name'
      ? (runsEqual(c.runs, cur.nameRuns) ? null : { nameRuns: c.runs })
      : applyCellText(cur, col, c.text, { display: display(c.rowId, c.colKey) })
    if (!patch) continue
    patches.push({ rowId: c.rowId, patch })
    rows.set(c.rowId, { ...cur, ...patch }) // a later cell of the same row sees this one
  }
  return applyPatches(t, patches)
}

export function setSecondNameRuns(t: TwoTables, rowId: Id, runs: Runs): TwoTables | null {
  const cur = t.hybrid.rows.find((r) => r.id === rowId)
  if (!cur || runsEqual(cur.nameRuns, runs)) return null
  return applyPatches(t, [{ rowId, patch: { nameRuns: runs } }])
}

export function resetSecondTotal(t: TwoTables, rowId: Id): TwoTables | null {
  const cur = t.hybrid.rows.find((r) => r.id === rowId)
  if (!cur || cur.totalOverride === null) return null
  return applyPatches(t, [{ rowId, patch: { totalOverride: null } }])
}

/** Mark / unmark an extra cell of a second-table row (shared: the primary twin's cell). null = unknown row. */
export function toggleSecondMark(t: TwoTables, rowId: Id, colKey: string): { t: TwoTables; marked: boolean } | null {
  const cur = resolveSecondRows(t.rows, t.hybrid).find((r) => r.id === rowId)
  if (!cur) return null
  const r = toggleMarkCell(cur, colKey)
  const next = applyPatches(t, [{ rowId, patch: { extras: r.row.extras } }])
  return next ? { t: next, marked: r.marked } : null
}

/** Deletes item rows of the second table (positions keep id and extras, like the primary table). `bodyIds` = the second view's body ids. */
export function deleteSecondRows(t: TwoTables, bodyIds: readonly Id[], removeIds: ReadonlySet<Id>, extraKeys: ReadonlySet<string>): TwoTables | null {
  const next = deleteItemRows(t.hybrid.rows, bodyIds, removeIds, extraKeys)
  return next ? { rows: t.rows, hybrid: { ...t.hybrid, rows: next } } : null
}

/** Moves one item row of the second table to `toIndex` (body index). */
export function moveSecondRow(t: TwoTables, bodyIds: readonly Id[], rowId: Id, toIndex: number, extraKeys: ReadonlySet<string>): TwoTables | null {
  const next = moveItemRow(t.hybrid.rows, bodyIds, rowId, toIndex, extraKeys)
  return next ? { rows: t.rows, hybrid: { ...t.hybrid, rows: next } } : null
}
