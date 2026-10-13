/**
 * Phase 16 — grid clipboard model (pure): the Quot3 JSON flavour and the paste planner. The planner decides, for a
 * pasted matrix and a target cell, which cells receive which text, which are rejected (numeric cells that cannot hold the
 * text), and how many rows are needed — it never mutates anything and never drops rows.
 */
import { sanitizeNumericPaste } from '../gridEdit'
import { normalize } from '../richtext/runs'
import type { Run, Runs } from '../types'

/** MIME of the Quot3-only flavour (cell formatting survives a paste inside Quot3). */
export const QUOT3_GRID_MIME = 'application/x-quot3-grid'

export interface GridClipCell { text: string; runs?: Runs }
export interface Quot3GridPayload { v: 1; cells: GridClipCell[][] }

export function serializeQuot3Payload(cells: GridClipCell[][]): string {
  const p: Quot3GridPayload = { v: 1, cells }
  return JSON.stringify(p)
}

function cleanRun(x: unknown): Run | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (typeof o['t'] !== 'string') return null
  const r: Run = { t: o['t'] }
  if (o['b'] === 1) r.b = 1
  if (o['r'] === 1) r.r = 1
  if (o['hl'] === 1) r.hl = 1
  return r
}

/** Lenient, non-throwing parse of the Quot3 flavour; anything malformed → `null` (caller falls back to plain TSV). */
export function parseQuot3Payload(raw: string | null | undefined): Quot3GridPayload | null {
  if (!raw) return null
  let j: unknown
  try { j = JSON.parse(raw) } catch { return null }
  if (typeof j !== 'object' || j === null) return null
  const o = j as Record<string, unknown>
  if (o['v'] !== 1 || !Array.isArray(o['cells']) || o['cells'].length === 0) return null
  const cells: GridClipCell[][] = []
  for (const row of o['cells'] as unknown[]) {
    if (!Array.isArray(row)) return null
    const out: GridClipCell[] = []
    for (const c of row) {
      if (typeof c !== 'object' || c === null || typeof (c as Record<string, unknown>)['text'] !== 'string') return null
      const cc = c as Record<string, unknown>
      const cell: GridClipCell = { text: cc['text'] as string }
      if (Array.isArray(cc['runs'])) {
        const runs = (cc['runs'] as unknown[]).map(cleanRun)
        if (runs.every((r) => r !== null)) cell.runs = normalize(runs as Runs)
      }
      out.push(cell)
    }
    cells.push(out)
  }
  return { v: 1, cells }
}

/** What the planner needs to know about each navigable column (index = position in the grid's navigable columns). */
export interface PasteCol { key: string; numeric: boolean; typable: boolean; allowNegative: boolean }
export interface PasteCell { row: number; col: number; text: string; runs?: Runs }
export interface PasteReject { row: number; col: number; colKey: string; text: string }
export interface PastePlan {
  cells: PasteCell[]
  /** Body rows that must exist (`startRow + matrix rows`); the caller creates them before applying. */
  rowsNeeded: number
  rejected: PasteReject[]
  /** Pasted columns that fell off the right edge of the grid (reported, never silent). */
  clippedCols: number
  /** Cells that landed on a read-only column. */
  skipped: number
}

/** Repeat one cell over a `rows × cols` block (a single value pasted onto a selected range). */
export function repeatCell(cell: GridClipCell, rows: number, cols: number): GridClipCell[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => cell))
}

/**
 * Plan a paste of `matrix` with its top-left on (startRow, startCol). Text cells: newlines/tabs inside a cell become
 * spaces (KB §5); runs from the Quot3 flavour are kept for the item-name column only. Numeric cells: blank clears the
 * cell, otherwise the text goes through `sanitizeNumericPaste` (commas, ₹, spaces tolerated) and a non-number is
 * REJECTED for that cell only — the rest still pastes.
 */
export function planPaste(matrix: GridClipCell[][], startRow: number, startCol: number, cols: readonly PasteCol[]): PastePlan {
  const cells: PasteCell[] = []
  const rejected: PasteReject[] = []
  let clipped = 0
  let skipped = 0
  let maxWidth = 0
  matrix.forEach((line, ri) => {
    maxWidth = Math.max(maxWidth, line.length)
    line.forEach((src, ci) => {
      const col = cols[startCol + ci]
      if (!col) return
      const row = startRow + ri
      const colIndex = startCol + ci
      if (!col.typable) { skipped++; return }
      if (col.numeric) {
        const t = src.text.replace(/[\u00a0\s]+/g, ' ').trim()
        if (t === '') { cells.push({ row, col: colIndex, text: '' }); return }
        const ok = sanitizeNumericPaste(t, '', 0, 0, col.allowNegative)
        if (ok === null) rejected.push({ row, col: colIndex, colKey: col.key, text: src.text })
        else cells.push({ row, col: colIndex, text: ok })
        return
      }
      const text = src.text.replace(/[\r\n\t]+/g, ' ')
      const cell: PasteCell = { row, col: colIndex, text }
      if (col.key === 'name' && src.runs) cell.runs = src.runs
      cells.push(cell)
    })
  })
  clipped = Math.max(0, startCol + maxWidth - cols.length)
  return { cells, rowsNeeded: startRow + matrix.length, rejected, clippedCols: clipped, skipped }
}

/** One short status sentence for a finished paste (empty when nothing needs saying). */
export function describePaste(plan: PastePlan, colLabel: (key: string) => string): string {
  const parts: string[] = []
  if (plan.rejected.length > 0) {
    const first = plan.rejected[0] as PasteReject
    const n = plan.rejected.length
    parts.push(`${n} cell${n === 1 ? '' : 's'} not pasted — "${first.text.trim().slice(0, 20)}" is not a number for ${colLabel(first.colKey)}${n > 1 ? ' (and others)' : ''}`)
  }
  if (plan.clippedCols > 0) parts.push(`${plan.clippedCols} column${plan.clippedCols === 1 ? '' : 's'} beyond the last column were ignored`)
  if (plan.skipped > 0) parts.push(`${plan.skipped} read-only cell${plan.skipped === 1 ? '' : 's'} skipped`)
  return parts.join('. ')
}
