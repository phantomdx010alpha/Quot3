/**
 * Pure grid view-model (Phase 9): which rows the grid body shows, which rows form the footer, which columns exist,
 * and the trailing-blank-row rule. No DOM. `buildGridView` reuses previous row objects whenever their content is
 * unchanged, so renderer selectors (and React.memo) see stable identities and untouched cells never re-render.
 */
import { computeBill, type ComputeOptions, type DisplayRow } from './calc/billTotals'
import { classifyRow } from './calc/classifyRow'
import { createEmptyRow, type NewId } from './billModel'
import type { BillRow, ColumnDef, ExtraColDef, FormatDef, Id } from './types'

/** The grid always offers at least this many empty entry rows after the last used row. */
export const MIN_TRAILING_BLANK_ROWS = 3
/** Width of an extra (units) column; the owner's header text ellipsises, full text on focus (Phase 23). */
export const EXTRA_COL_WIDTH_PX = 110

// ---------- trailing blank rows ----------
/** A row with nothing in it at all (no name, numbers, extras text/marks or styling). */
export function isEntryBlank(row: BillRow): boolean {
  if (classifyRow(row) !== 'blank') return false
  if (row.cellStyle && Object.keys(row.cellStyle).length > 0) return false
  for (const c of Object.values(row.extras)) if (c.text.trim() !== '' || c.marked) return false
  return true
}

export function countTrailingBlankRows(rows: readonly BillRow[]): number {
  let n = 0
  for (let i = rows.length - 1; i >= 0 && isEntryBlank(rows[i] as BillRow); i--) n++
  return n
}

/**
 * Ensures at least `min` blank rows after the last used row. Returns the SAME array when already satisfied
 * (so store updates stay referentially quiet). Blank rows are padding only — saving trims them (Phase 27).
 */
export function ensureTrailingBlankRows(rows: readonly BillRow[], min: number = MIN_TRAILING_BLANK_ROWS, newId?: NewId): BillRow[] {
  const have = countTrailingBlankRows(rows)
  if (have >= min) return rows as BillRow[]
  const out = [...rows]
  for (let i = have; i < min; i++) out.push(createEmptyRow(out.length, newId))
  return out
}

// ---------- columns ----------
export interface GridColumn {
  key: string
  label: string
  align: ColumnDef['align']
  widthPx: number
  /** Takes the leftover width (rich-text columns). */
  flex: boolean
  isExtra: boolean
  /** Registry `editable` (extras: true). Editable columns are the keyboard-navigable ones (Phase 11). */
  editable: boolean
  /** Registry column kind; extras are 'text'. */
  kind: ColumnDef['kind']
}

/** Format columns (from the registry) followed by the bill's extra columns. Never branches on a format id. */
export function buildGridColumns(format: FormatDef, extraCols: readonly ExtraColDef[]): GridColumn[] {
  const cols: GridColumn[] = format.columns.map((c) => ({
    key: c.key, label: c.label, align: c.align, widthPx: c.widthPx, flex: c.kind === 'richtext', isExtra: false,
    editable: c.editable, kind: c.kind
  }))
  for (const e of extraCols) cols.push({ key: e.key, label: e.header, align: 'left', widthPx: EXTRA_COL_WIDTH_PX, flex: false, isExtra: true, editable: true, kind: 'text' })
  return cols
}

/** CSS `grid-template-columns` for a column set. */
export function gridTemplateColumns(cols: readonly GridColumn[]): string {
  return cols.map((c) => (c.flex ? `minmax(${c.widthPx}px, 1fr)` : `${c.widthPx}px`)).join(' ')
}

// ---------- view ----------
export interface GridView {
  /** Body row ids in display order (item / blank / partial rows; adjustments live in the footer). */
  bodyIds: Id[]
  body: Record<Id, DisplayRow>
  /** Items-total / adjustments / round-off / grand-total rows, in display order. Adjustment rows are editable (Phase 19). */
  footer: DisplayRow[]
  /** Phase 19: adjustment row ids in footer order. Their display rows are ALSO in `body` (keyed by id) so cells can subscribe the same way. */
  adjIds: Id[]
  /** Phase 19: keyboard-navigation rows = `bodyIds` then `adjIds` (read-only total rows are skipped by the arrows). */
  navIds: Id[]
  warnings: string[]
}

export const EMPTY_VIEW: GridView = { bodyIds: [], body: {}, footer: [], adjIds: [], navIds: [], warnings: [] }

function cellsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}
function displayEqual(a: DisplayRow, b: DisplayRow): boolean {
  return a.kind === b.kind && a.rowId === b.rowId && a.slNo === b.slNo && a.override === b.override && a.ovrAuto === b.ovrAuto && cellsEqual(a.cells, b.cells)
}

/** `options` = `getBillOptions(bill)` (Phase 77, the one options read); never built from the setting here. */
export function buildGridView(format: FormatDef, rows: readonly BillRow[], prev: GridView = EMPTY_VIEW, options: ComputeOptions = {}): GridView {
  const totals = computeBill(format, rows, options)
  const bodyIds: Id[] = []
  const body: Record<Id, DisplayRow> = {}
  const footerRaw: DisplayRow[] = []
  for (const d of totals.display) {
    if (d.rowId !== undefined && (d.kind === 'item' || d.kind === 'blank' || d.kind === 'partial')) {
      const old = prev.body[d.rowId]
      body[d.rowId] = old && displayEqual(old, d) ? old : d
      bodyIds.push(d.rowId)
    } else {
      footerRaw.push(d)
    }
  }
  const sameIds = bodyIds.length === prev.bodyIds.length && bodyIds.every((id, i) => id === prev.bodyIds[i])
  const footer = footerRaw.map((d, i) => {
    const old = prev.footer[i]
    return old && displayEqual(old, d) ? old : d
  })
  const sameFooter = footer.length === prev.footer.length && footer.every((d, i) => d === prev.footer[i])
  const adjIds: Id[] = []
  for (const d of footer) {
    if (d.kind === 'adjustment' && d.rowId !== undefined) { body[d.rowId] = d; adjIds.push(d.rowId) }
  }
  const sameAdj = adjIds.length === prev.adjIds.length && adjIds.every((id, i) => id === prev.adjIds[i])
  const outBody = sameIds ? prev.bodyIds : bodyIds
  const outAdj = sameAdj ? prev.adjIds : adjIds
  return {
    bodyIds: outBody,
    body,
    footer: sameFooter ? prev.footer : footer,
    adjIds: outAdj,
    navIds: outBody === prev.bodyIds && outAdj === prev.adjIds ? prev.navIds : outBody.concat(outAdj),
    warnings: totals.warnings
  }
}

/**
 * Phase 20 — where the active cell goes when the column set changes (format switch). The same logical column when it
 * still exists; otherwise the nearest surviving column, measured along the OLD column order (left neighbour wins a tie),
 * so `GST %` → `Total` when GST is switched off. `oldKeys` = every column of the old layout; `newKeys` = the navigable
 * columns of the new one. Returns null only when there is nowhere to go.
 */
export function remapColumnKey(oldKeys: readonly string[], newKeys: readonly string[], key: string): string | null {
  if (newKeys.includes(key)) return key
  const at = oldKeys.indexOf(key)
  if (at >= 0) {
    for (let d = 1; d < oldKeys.length; d++) {
      const l = oldKeys[at - d]
      if (l !== undefined && newKeys.includes(l)) return l
      const r = oldKeys[at + d]
      if (r !== undefined && newKeys.includes(r)) return r
    }
  }
  return newKeys[0] ?? null
}
