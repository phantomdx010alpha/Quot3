import { defaultExtraColHeader } from './billModel'
import { sliceGraphemes } from './columnWidths'
import type { BillRow, ExtraColDef } from './types'

/**
 * Phase 21 — pure extra-column management (spec: EXTRA_COLS_UNITS_RULES §5). Extra columns belong to the BILL, not the
 * format, so none of this knows about formats. Nothing here mutates its inputs; unchanged rows keep their identity
 * (the grid's per-row calc cache is keyed on row objects).
 */

/** Practical cap (the paper engine already forces A4 beyond a few; this only stops runaway growth). */
export const MAX_EXTRA_COLS = 12
/** Header text is single-line; longer input is cut here (the cell ellipsises, the full text shows on focus). */
export const MAX_EXTRA_HEADER_LEN = 40

/** Number of extra columns on the bill — the paper engine's `extraColCount` input (PAPER_ENGINE_RULES §1). */
export function extraColCount(extraCols: readonly ExtraColDef[]): number { return extraCols.length }

/** Single line, collapsed whitespace, trimmed, capped. May return '' (callers decide what an empty header means). */
export function sanitizeExtraHeader(raw: string): string {
  return sliceGraphemes(raw.replace(/\s+/g, ' ').trim(), MAX_EXTRA_HEADER_LEN).trim()
}

/** Smallest `cN` key used neither by a column nor by any row's extras (so a re-added column never resurrects old orphan data). */
export function nextExtraColKey(extraCols: readonly ExtraColDef[], rows: readonly BillRow[]): string {
  const used = new Set<string>(extraCols.map((c) => c.key))
  for (const r of rows) for (const k of Object.keys(r.extras)) used.add(k)
  let n = 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

/** Smallest "Col N" not already used as a header (case-insensitive), so defaults stay distinct after removals/renames. */
export function nextExtraColHeader(extraCols: readonly ExtraColDef[]): string {
  const used = new Set(extraCols.map((c) => c.header.toLowerCase()))
  let n = 1
  while (used.has(defaultExtraColHeader(n).toLowerCase())) n++
  return defaultExtraColHeader(n)
}

/** Any entered text or mark in the column? (Decides whether removal asks for confirmation.) */
export function extraColHasData(rows: readonly BillRow[], key: string): boolean {
  for (const r of rows) {
    const c = r.extras[key]
    if (c && (c.text.trim() !== '' || c.marked)) return true
  }
  return false
}

/** Appends a column (default header, empty cells). `null` at the cap. */
export function addExtraCol(extraCols: readonly ExtraColDef[], rows: readonly BillRow[]): { extraCols: ExtraColDef[]; col: ExtraColDef } | null {
  if (extraCols.length >= MAX_EXTRA_COLS) return null
  const col: ExtraColDef = { key: nextExtraColKey(extraCols, rows), header: nextExtraColHeader(extraCols), kind: 'units' }
  return { extraCols: [...extraCols, col], col }
}

/** Drops the column and its cells from every row (the undo entry keeps both). `null` when the key is unknown. */
export function removeExtraCol(extraCols: readonly ExtraColDef[], rows: readonly BillRow[], key: string): { extraCols: ExtraColDef[]; rows: BillRow[]; removed: ExtraColDef } | null {
  const removed = extraCols.find((c) => c.key === key)
  if (!removed) return null
  const next = rows.map((r) => {
    if (!(key in r.extras)) return r
    const { [key]: _gone, ...rest } = r.extras
    return { ...r, extras: rest }
  })
  return { extraCols: extraCols.filter((c) => c.key !== key), rows: next, removed }
}

/**
 * Renames a column. `null` = no change (unknown key, or the sanitised header is empty or equal to the current one — an
 * emptied header is treated as "keep the old one" rather than inventing a name).
 */
export function renameExtraCol(extraCols: readonly ExtraColDef[], key: string, header: string): ExtraColDef[] | null {
  const h = sanitizeExtraHeader(header)
  const cur = extraCols.find((c) => c.key === key)
  if (!cur || h === '' || h === cur.header) return null
  return extraCols.map((c) => (c.key === key ? { ...c, header: h } : c))
}

/**
 * Phase 22 — Mark/Unmark one cell of an extra column (EXTRA_COLS_UNITS_RULES §3). Returns the row with the cell marked (text kept,
 * cell created if absent) or unmarked (text kept; an empty unmarked cell is dropped). Never mutates `row`.
 */
export function toggleMarkCell(row: BillRow, key: string): { row: BillRow; marked: boolean } {
  const cur = row.extras[key]
  if (cur?.marked) {
    const { [key]: _old, ...rest } = row.extras
    const extras = cur.text === '' ? rest : { ...rest, [key]: { text: cur.text } }
    return { row: { ...row, extras }, marked: false }
  }
  return { row: { ...row, extras: { ...row.extras, [key]: { text: cur?.text ?? '', marked: true } } }, marked: true }
}
