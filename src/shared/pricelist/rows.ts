/** Phase 235 (M23) - Price List rows (pure): create, sanitise cells, insert / move / delete, filter. Money is decimal strings only. */
import { isNumericStr, toDec, D } from '../money'
import { fromPlain, plain, normalize } from '../richtext/runs'
import { normaliseItem } from '../items/normalise'
import type { Runs } from '../types'
import { NAME_COLUMN_KEY, PRICELIST_LIMITS, type PriceColumn, type PriceRow, type RowKind } from './types'

export function newRow(id: string, tabId: string, idx: number, kind: RowKind = 'item', name = ''): PriceRow {
  return { id, tabId, idx, kind, nameRuns: name === '' ? [] : fromPlain(name), cells: {} }
}

export const rowPlain = (r: Pick<PriceRow, 'nameRuns'>): string => plain(r.nameRuns)
/** The order-insensitive key stored as `name_norm` (the matcher and duplicate warning use it). '' for a blank or section row. */
export const rowNameKey = (r: Pick<PriceRow, 'nameRuns' | 'kind'>): string => (r.kind === 'section' ? '' : normaliseItem(plain(r.nameRuns)).key)

/** One cell value for a column: price / number columns accept a complete decimal and are stored canonical ("110.00" -> "110"); invalid -> null. */
export function sanitizeCell(col: Pick<PriceColumn, 'type' | 'role' | 'choices'>, raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (t === '') return ''
  if (col.type === 'number' || col.role === 'price') {
    const s = t.replace(/,/g, '')
    return isNumericStr(s) ? toDec(D(s)) : null
  }
  if (col.type === 'choice') {
    const hit = (col.choices ?? []).find((c) => c.toLowerCase() === t.toLowerCase())
    return hit ?? null
  }
  return Array.from(t).slice(0, PRICELIST_LIMITS.cellMax).join('')
}

/** Stored row -> valid row for its tab's columns: unknown keys kept (orphans are harmless), section rows lose prices, runs normalised. */
export function sanitizeRow(raw: PriceRow, columns: readonly PriceColumn[]): PriceRow {
  const cells: Record<string, string> = {}
  const byKey = new Map(columns.map((c) => [c.key, c]))
  for (const [k, v] of Object.entries(raw.cells ?? {})) {
    if (k === NAME_COLUMN_KEY || typeof v !== 'string') continue
    const col = byKey.get(k)
    if (!col) { cells[k] = v; continue }
    if (raw.kind === 'section' && col.role === 'price') continue
    const s = sanitizeCell(col, v)
    if (s !== null && s !== '') cells[k] = s
  }
  return { ...raw, nameRuns: normalize(raw.nameRuns as Runs), cells }
}

export function setCell(row: PriceRow, col: PriceColumn, raw: string): PriceRow | null {
  if (col.role === 'name') return row
  const s = sanitizeCell(col, raw)
  if (s === null) return null
  if ((row.cells[col.key] ?? '') === s) return row
  const cells = { ...row.cells }
  if (s === '') delete cells[col.key]
  else cells[col.key] = s
  return { ...row, cells }
}

const renumberIdx = (rows: PriceRow[]): PriceRow[] => rows.map((r, i) => (r.idx === i ? r : { ...r, idx: i }))
const inOrder = (rows: readonly PriceRow[]): PriceRow[] => [...rows].sort((a, b) => a.idx - b.idx)

/** Insert `row` at `index` (clamped); idx values are renumbered 0..n-1. */
export function insertRow(rows: readonly PriceRow[], row: PriceRow, index: number): PriceRow[] {
  const l = inOrder(rows)
  l.splice(Math.max(0, Math.min(l.length, index)), 0, row)
  return renumberIdx(l)
}
export const deleteRows = (rows: readonly PriceRow[], ids: ReadonlySet<string>): PriceRow[] => renumberIdx(inOrder(rows).filter((r) => !ids.has(r.id)))

/** Move the rows `ids` up (-1) or down (+1) by one place, keeping their relative order; blocked at the edge. */
export function moveRows(rows: readonly PriceRow[], ids: ReadonlySet<string>, dir: -1 | 1): PriceRow[] {
  const l = inOrder(rows)
  if (dir === -1) for (let i = 1; i < l.length; i++) { if (ids.has(l[i]!.id) && !ids.has(l[i - 1]!.id)) [l[i - 1], l[i]] = [l[i]!, l[i - 1]!] }
  else for (let i = l.length - 2; i >= 0; i--) { if (ids.has(l[i]!.id) && !ids.has(l[i + 1]!.id)) [l[i + 1], l[i]] = [l[i]!, l[i + 1]!] }
  return renumberIdx(l)
}

/** True when an item row has no value in any price column. Section rows never count as "no price". */
export function hasNoPrice(row: PriceRow, columns: readonly PriceColumn[]): boolean {
  if (row.kind === 'section') return false
  return !columns.some((c) => c.role === 'price' && (row.cells[c.key] ?? '') !== '')
}

export interface RowFilter { noPrice?: boolean; contains?: string }
export function filterRows(rows: readonly PriceRow[], columns: readonly PriceColumn[], f: RowFilter): PriceRow[] {
  const q = (f.contains ?? '').trim().toLowerCase()
  return rows.filter((r) => {
    if (f.noPrice && !hasNoPrice(r, columns)) return false
    if (q !== '' && !rowSearchText(r).includes(q)) return false
    return true
  })
}
const rowSearchText = (r: PriceRow): string => [plain(r.nameRuns), ...Object.values(r.cells)].join(' ').toLowerCase()

/** Sort by one column; blanks last, numbers numerically (decimal.js), text with a locale-independent compare. Section rows stay where they are (only item rows between sections are sorted). */
export function sortRows(rows: readonly PriceRow[], col: PriceColumn, dir: 'asc' | 'desc'): PriceRow[] {
  const l = inOrder(rows)
  const out: PriceRow[] = []
  let block: PriceRow[] = []
  const flush = (): void => { out.push(...sortBlock(block, col, dir)); block = [] }
  for (const r of l) { if (r.kind === 'section') { flush(); out.push(r) } else block.push(r) }
  flush()
  return renumberIdx(out)
}
function sortBlock(block: PriceRow[], col: PriceColumn, dir: 'asc' | 'desc'): PriceRow[] {
  const val = (r: PriceRow): string => (col.role === 'name' ? plain(r.nameRuns) : (r.cells[col.key] ?? ''))
  const numeric = col.type === 'number' || col.role === 'price'
  const sign = dir === 'asc' ? 1 : -1
  return block
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((a, b) => {
      if (a.v === '' || b.v === '') return a.v === b.v ? a.i - b.i : a.v === '' ? 1 : -1
      const c = numeric && isNumericStr(a.v) && isNumericStr(b.v) ? D(a.v).comparedTo(D(b.v)) : a.v.toLowerCase() < b.v.toLowerCase() ? -1 : a.v.toLowerCase() > b.v.toLowerCase() ? 1 : 0
      return c === 0 ? a.i - b.i : c * sign
    })
    .map((x) => x.r)
}
