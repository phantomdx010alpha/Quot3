/**
 * Phase 238 (M23) - Price List grid model (pure: no DOM, no Electron, no Node). API_CONTRACTS.md M23-8.
 * The page edits rows with the bill grid's OWN state machine (`shared/nav/cellNav.ts` `navReduce`) and its paste planner
 * (`shared/tsv/gridClip.ts` `planPaste`). This file is the thin adapter between a tab's columns / rows and those engines:
 * which columns are shown, the text of a cell, writing a cell back (name = rich-text runs, price = canonical decimal string),
 * paste / clear / fill / copy over a rectangle. Money is never a JS number (rule 4.3): price cells go through `sanitizeCell`.
 */
import { applyTextChange, plain } from '../richtext/runs'
import { formatTsv } from '../tsv/tsvCodec'
import { planPaste, type GridClipCell, type PasteCol, type PastePlan } from '../tsv/gridClip'
import { isValidNumericDraft } from '../gridEdit'
import type { GridShape } from '../nav/cellNav'
import { newRow, sanitizeCell } from './rows'
import { NAME_COLUMN_KEY, type PriceColumn, type PriceRow } from './types'

export interface GridCol {
  key: string
  label: string
  numeric: boolean
  isName: boolean
  role: PriceColumn['role']
  align: PriceColumn['align']
  widthPx: number
  frozen: boolean
  choices: string[] | null
}

/** The columns shown, in order (hidden ones are skipped). The item-name column is always first and always shown. */
export function gridColumns(columns: readonly PriceColumn[]): GridCol[] {
  const out: GridCol[] = []
  for (const c of columns) {
    if (c.hidden && c.role !== 'name') continue
    out.push({
      key: c.key, label: c.label, isName: c.role === 'name', role: c.role, align: c.align, widthPx: c.widthPx, frozen: c.frozen,
      numeric: c.type === 'number' || c.role === 'price', choices: c.type === 'choice' ? (c.choices ?? []) : null
    })
  }
  out.sort((a, b) => Number(b.isName) - Number(a.isName))
  return out
}

const asColumn = (c: GridCol): Pick<PriceColumn, 'type' | 'role' | 'choices'> =>
  ({ type: c.numeric ? 'number' : c.choices ? 'choice' : 'text', role: c.role, ...(c.choices ? { choices: c.choices } : {}) })

export const cellText = (row: PriceRow, col: GridCol): string => (col.isName ? plain(row.nameRuns) : (row.cells[col.key] ?? ''))

/** A section row (a divider such as "BIG PANNA") has only a name: every other cell is read-only. */
export const isTypable = (row: PriceRow, col: GridCol): boolean => col.isName || row.kind !== 'section'

/**
 * The row with `text` written into column `col`; `null` when the text is not valid for that column (a non-number in a price column,
 * a value that is not one of a choice column's choices). Name cells keep their bold / red / highlight runs (`applyTextChange`).
 */
export function withCellText(row: PriceRow, col: GridCol, text: string): PriceRow | null {
  if (!isTypable(row, col)) return null
  if (col.isName) {
    const t = text.replace(/[\r\n\t]+/g, ' ')
    return plain(row.nameRuns) === t ? row : { ...row, nameRuns: applyTextChange(row.nameRuns, t) }
  }
  const s = sanitizeCell(asColumn(col), text)
  if (s === null) return null
  if ((row.cells[col.key] ?? '') === s) return row
  const cells = { ...row.cells }
  if (s === '') delete cells[col.key]
  else cells[col.key] = s
  return { ...row, cells }
}

/** A draft may be typed into a number column only while it can still become a number ("12", "12.", ".5"). */
export const isDraftAllowed = (col: GridCol, text: string): boolean => !col.numeric || isValidNumericDraft(text, false)

export function gridShape(rows: readonly PriceRow[], cols: readonly GridCol[]): GridShape {
  return {
    rowCount: rows.length,
    colCount: cols.length,
    cellText: (r, c) => { const row = rows[r], col = cols[c]; return row && col ? cellText(row, col) : '' },
    cellKind: (c) => (cols[c]?.numeric ? 'num' : 'text'),
    allowNegative: () => false
  }
}

export interface Bounds { top: number; left: number; bottom: number; right: number }

const pasteCols = (cols: readonly GridCol[]): PasteCol[] => cols.map((c) => ({ key: c.key, numeric: c.numeric, typable: true, allowNegative: false }))

export interface PasteResult { rows: PriceRow[]; plan: PastePlan; written: number; notWritten: number }

/**
 * Paste a matrix with its top-left on (startRow, startCol). Rows that do not exist yet are created (blank, `newId()`), cells that
 * are not valid for their column (or sit on a section row's read-only cells) are reported, never silently dropped.
 */
export function pasteInto(rows: readonly PriceRow[], cols: readonly GridCol[], matrix: GridClipCell[][], startRow: number, startCol: number, tabId: string, newId: () => string): PasteResult {
  const plan = planPaste(matrix, startRow, startCol, pasteCols(cols))
  const out = rows.slice()
  while (out.length < plan.rowsNeeded) out.push(newRow(newId(), tabId, out.length))
  let written = 0
  let notWritten = plan.rejected.length
  for (const c of plan.cells) {
    const row = out[c.row], col = cols[c.col]
    if (!row || !col) continue
    let next = withCellText(row, col, c.text)
    if (next === null) { notWritten++; continue }
    if (col.isName && c.runs && c.runs.length > 0) next = { ...next, nameRuns: c.runs.map((r) => ({ ...r })) }
    out[c.row] = next
    written++
  }
  return { rows: out, plan, written, notWritten }
}

/** Clear every typable cell in `b`. A name cell empties its runs; section rows keep their (empty) price cells. */
export function clearBounds(rows: readonly PriceRow[], cols: readonly GridCol[], b: Bounds): PriceRow[] {
  return rows.map((row, r) => {
    if (r < b.top || r > b.bottom) return row
    let cur = row
    for (let c = b.left; c <= b.right; c++) { const col = cols[c]; if (col) cur = withCellText(cur, col, '') ?? cur }
    return cur
  })
}

/** Ctrl+D: copy the top row of `b` into the rows below it (all columns of the range). A single row copies from the row above. */
export function fillDown(rows: readonly PriceRow[], cols: readonly GridCol[], b: Bounds): PriceRow[] {
  const single = b.top === b.bottom
  const srcRow = single ? b.top - 1 : b.top
  const src = rows[srcRow]
  if (!src) return rows.slice()
  return rows.map((row, r) => {
    if (r < (single ? b.top : b.top + 1) || r > b.bottom) return row
    let cur = row
    for (let c = b.left; c <= b.right; c++) { const col = cols[c]; if (col) cur = withCellText(cur, col, cellText(src, col)) ?? cur }
    if (cols.slice(b.left, b.right + 1).some((c) => c.isName) && src.nameRuns.length > 0) cur = { ...cur, nameRuns: src.nameRuns.map((x) => ({ ...x })) }
    return cur
  })
}

/** Ctrl+R: copy the left column of `b` into the columns to its right. A single column copies from the column on the left. */
export function fillRight(rows: readonly PriceRow[], cols: readonly GridCol[], b: Bounds): PriceRow[] {
  const single = b.left === b.right
  const srcCol = cols[single ? b.left - 1 : b.left]
  if (!srcCol) return rows.slice()
  return rows.map((row, r) => {
    if (r < b.top || r > b.bottom) return row
    let cur = row
    const text = cellText(row, srcCol)
    for (let c = single ? b.left : b.left + 1; c <= b.right; c++) { const col = cols[c]; if (col && !col.isName) cur = withCellText(cur, col, text) ?? cur }
    return cur
  })
}

/** The cells of `b` as clipboard cells (names carry their runs for the Quot3 flavour). */
export function boundsToClip(rows: readonly PriceRow[], cols: readonly GridCol[], b: Bounds): GridClipCell[][] {
  const out: GridClipCell[][] = []
  for (let r = b.top; r <= b.bottom; r++) {
    const row = rows[r]
    if (!row) continue
    const line: GridClipCell[] = []
    for (let c = b.left; c <= b.right; c++) {
      const col = cols[c]
      if (!col) continue
      line.push(col.isName && row.nameRuns.length > 0 ? { text: cellText(row, col), runs: row.nameRuns.map((x) => ({ ...x })) } : { text: cellText(row, col) })
    }
    out.push(line)
  }
  return out
}

export const clipToTsv = (cells: GridClipCell[][]): string => formatTsv(cells.map((l) => l.map((c) => c.text)))

/** True for a fresh row nobody typed into (it is not saved and not counted until it holds something). */
export const isBlankRow = (row: PriceRow): boolean => row.kind === 'item' && plain(row.nameRuns) === '' && Object.keys(row.cells).length === 0

export { NAME_COLUMN_KEY }
