/**
 * Phase 80 - pure helpers for the extra-column FREE cells (M8 section 7): the cells on the Items total / Adjustments total /
 * Final total (or single Total) rows and the extra-only tail rows below the Final total. No DOM, no store.
 *
 * The grid addresses these rows with virtual row ids so the one keyboard / clipboard pipeline treats them like any row:
 * `fx:<footerKey>` for a footer row, `tr:<index>` for a tail row. Stored state stays minimal (empty cells dropped, trailing
 * empty tail rows trimmed); the one blank entry row shown below the last tail row is display padding only.
 */
import type { ExtraCell, FooterExtraKey, FooterExtras, TailRow } from './types'
import { FOOTER_EXTRA_KEYS } from './types'

export const FREE_FOOTER_PREFIX = 'fx:'
export const FREE_TAIL_PREFIX = 'tr:'

export type FreeRowRef = { kind: 'footer'; key: FooterExtraKey } | { kind: 'tail'; index: number }

export const footerRowId = (key: FooterExtraKey): string => FREE_FOOTER_PREFIX + key
export const tailRowId = (index: number): string => FREE_TAIL_PREFIX + index

export function parseFreeRowId(id: string): FreeRowRef | null {
  if (id.startsWith(FREE_FOOTER_PREFIX)) {
    const k = id.slice(FREE_FOOTER_PREFIX.length)
    return (FOOTER_EXTRA_KEYS as readonly string[]).includes(k) ? { kind: 'footer', key: k as FooterExtraKey } : null
  }
  if (id.startsWith(FREE_TAIL_PREFIX)) {
    const raw = id.slice(FREE_TAIL_PREFIX.length)
    const n = Number(raw)
    return /^\d+$/.test(raw) && Number.isSafeInteger(n) ? { kind: 'tail', index: n } : null
  }
  return null
}
export const isFreeRowId = (id: string): boolean => parseFreeRowId(id) !== null

/** The footer display kind -> its free-cell key (`itemsTotal`, `adjustmentsTotal`, `grandTotal`); null for adjustment / round-off rows. */
export function footerKeyOfKind(kind: string): FooterExtraKey | null {
  return (FOOTER_EXTRA_KEYS as readonly string[]).includes(kind) ? (kind as FooterExtraKey) : null
}

/** How many tail rows the grid shows: every stored one, plus one blank entry row; `shown` (UI-only, grows on Enter) can raise it. */
export function displayedTailCount(tailRows: readonly TailRow[] | undefined, shown: number): number {
  return Math.max((tailRows?.length ?? 0) + 1, shown)
}

/**
 * Keyboard-navigation row ids in DISPLAY order: body rows, then each footer row that is editable (adjustment rows by their real
 * id, total rows by `fx:` id; the round-off line is skipped), then the tail rows. With no extra columns there is nothing free to
 * edit, so this equals the old `bodyIds + adjustment ids` order.
 */
export function freeNavIds(
  bodyIds: readonly string[],
  footer: ReadonlyArray<{ kind: string; rowId?: string }>,
  extraColCount: number,
  tailCount: number
): string[] {
  const out = [...bodyIds]
  for (const d of footer) {
    if (d.kind === 'adjustment' && d.rowId !== undefined) out.push(d.rowId)
    else if (extraColCount > 0) {
      const k = footerKeyOfKind(d.kind)
      if (k) out.push(footerRowId(k))
    }
  }
  if (extraColCount > 0) for (let i = 0; i < tailCount; i++) out.push(tailRowId(i))
  return out
}

export function getFreeCell(footerExtras: FooterExtras | undefined, tailRows: readonly TailRow[] | undefined, rowId: string, colKey: string): ExtraCell | undefined {
  const ref = parseFreeRowId(rowId)
  if (!ref) return undefined
  if (ref.kind === 'footer') return footerExtras?.[ref.key]?.[colKey]
  return tailRows?.[ref.index]?.extras[colKey]
}

export interface FreeState { footerExtras: FooterExtras | undefined; tailRows: TailRow[] | undefined }

const isEmptyCell = (c: ExtraCell | undefined): boolean => !c || (c.text === '' && !c.marked)

/** Canonical minimal state: no empty cells, no empty footer keys, no trailing empty tail rows; `undefined` when nothing is left. */
function minimal(fe: Record<string, Record<string, ExtraCell>>, tr: TailRow[]): FreeState {
  const footer: FooterExtras = {}
  for (const key of FOOTER_EXTRA_KEYS) {
    const cells = fe[key]
    if (cells && Object.keys(cells).length > 0) footer[key] = cells
  }
  let n = tr.length
  while (n > 0 && Object.keys((tr[n - 1] as TailRow).extras).length === 0) n--
  return { footerExtras: Object.keys(footer).length > 0 ? footer : undefined, tailRows: n > 0 ? tr.slice(0, n) : undefined }
}

/** Set (or, with `undefined`, remove) one free cell. Returns the new state, or `null` when nothing changes / the id is not a free row. */
export function putFreeCell(footerExtras: FooterExtras | undefined, tailRows: readonly TailRow[] | undefined, rowId: string, colKey: string, cell: ExtraCell | undefined): FreeState | null {
  return putFreeCells(footerExtras, tailRows, [{ rowId, colKey, cell }])
}

/** Bulk form of `putFreeCell` (one result for a whole paste / clear). */
export function putFreeCells(
  footerExtras: FooterExtras | undefined,
  tailRows: readonly TailRow[] | undefined,
  edits: ReadonlyArray<{ rowId: string; colKey: string; cell: ExtraCell | undefined }>
): FreeState | null {
  const fe: Record<string, Record<string, ExtraCell>> = {}
  for (const [k, v] of Object.entries(footerExtras ?? {})) fe[k] = { ...v }
  const tr: TailRow[] = (tailRows ?? []).map((r) => ({ extras: { ...r.extras } }))
  let changed = false
  for (const e of edits) {
    const ref = parseFreeRowId(e.rowId)
    if (!ref) continue
    const next = isEmptyCell(e.cell) ? undefined : (e.cell as ExtraCell)
    let cells: Record<string, ExtraCell>
    if (ref.kind === 'footer') cells = fe[ref.key] ?? (fe[ref.key] = {})
    else {
      if (next === undefined && ref.index >= tr.length) continue
      while (tr.length <= ref.index) tr.push({ extras: {} })
      cells = (tr[ref.index] as TailRow).extras
    }
    const cur = cells[e.colKey]
    if ((cur?.text ?? '') === (next?.text ?? '') && !!cur?.marked === !!next?.marked && (cur === undefined) === (next === undefined)) continue
    if (next) cells[e.colKey] = next.marked ? { text: next.text, marked: true } : { text: next.text }
    else delete cells[e.colKey]
    changed = true
  }
  return changed ? minimal(fe, tr) : null
}

/** Typed text into free cells (the mark is kept; empty + unmarked removes the cell). `null` = nothing changed. */
export function applyFreeCellTexts(
  footerExtras: FooterExtras | undefined,
  tailRows: readonly TailRow[] | undefined,
  cells: ReadonlyArray<{ rowId: string; colKey: string; text: string }>
): FreeState | null {
  // Resolve against a running copy so two edits to the same cell in one call compose.
  const working = new Map<string, ExtraCell | undefined>()
  const edits: { rowId: string; colKey: string; cell: ExtraCell | undefined }[] = []
  for (const c of cells) {
    const k = `${c.rowId}\u0000${c.colKey}`
    const cur = working.has(k) ? working.get(k) : getFreeCell(footerExtras, tailRows, c.rowId, c.colKey)
    const next: ExtraCell | undefined = c.text === '' && !cur?.marked ? undefined : { text: c.text, ...(cur?.marked ? { marked: true } : {}) }
    working.set(k, next)
    edits.push({ rowId: c.rowId, colKey: c.colKey, cell: next })
  }
  return putFreeCells(footerExtras, tailRows, edits)
}

/** Mark / unmark one free cell (same rules as `toggleMarkCell` for rows). `null` = not a free row. */
export function toggleFreeMark(
  footerExtras: FooterExtras | undefined,
  tailRows: readonly TailRow[] | undefined,
  rowId: string,
  colKey: string
): (FreeState & { marked: boolean }) | null {
  if (!parseFreeRowId(rowId)) return null
  const cur = getFreeCell(footerExtras, tailRows, rowId, colKey)
  const marked = !cur?.marked
  const cell: ExtraCell | undefined = marked ? { text: cur?.text ?? '', marked: true } : cur && cur.text !== '' ? { text: cur.text } : undefined
  const res = putFreeCell(footerExtras, tailRows, rowId, colKey, cell)
  // putFreeCell reports "no change" only when nothing differs; marking an absent cell always differs.
  return { ...(res ?? { footerExtras, tailRows: tailRows ? [...tailRows] : undefined }), marked }
}

/** Drop every free cell of one extra column (the column was removed). */
export function stripFreeColumn(footerExtras: FooterExtras | undefined, tailRows: readonly TailRow[] | undefined, colKey: string): FreeState {
  const fe: Record<string, Record<string, ExtraCell>> = {}
  for (const [k, v] of Object.entries(footerExtras ?? {})) {
    const { [colKey]: _gone, ...rest } = v ?? {}
    fe[k] = rest
  }
  const tr: TailRow[] = (tailRows ?? []).map((r) => {
    const { [colKey]: _gone, ...rest } = r.extras
    return { extras: rest }
  })
  return minimal(fe, tr)
}

/** Any text or mark in this extra column among the free cells? (Removal asks for confirmation then.) */
export function freeColumnHasData(footerExtras: FooterExtras | undefined, tailRows: readonly TailRow[] | undefined, colKey: string): boolean {
  for (const key of FOOTER_EXTRA_KEYS) {
    const c = footerExtras?.[key]?.[colKey]
    if (c && (c.text.trim() !== '' || c.marked)) return true
  }
  for (const r of tailRows ?? []) {
    const c = r.extras[colKey]
    if (c && (c.text.trim() !== '' || c.marked)) return true
  }
  return false
}
