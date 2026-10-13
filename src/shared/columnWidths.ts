import type { GridColumn } from './gridModel'

/**
 * Phase 23 — column width policy (pure). Widths are per FORMAT and per column key (extra columns included), clamped to
 * [MIN, MAX]; they are display-only and persisted in the `grid.colWidths` setting. A column without an override keeps its
 * registry width (the flexible Item Name column stays flexible until the user sizes it; resetting returns it to flexible).
 */
export const MIN_COL_WIDTH_PX = 40
export const MAX_COL_WIDTH_PX = 640
/** Keyboard resize step (Ctrl+Alt+] / Ctrl+Alt+[). */
export const COL_WIDTH_STEP_PX = 16
export const COL_WIDTHS_SETTING_KEY = 'grid.colWidths'
/** Columns that stay pinned to the left while the grid scrolls horizontally (in this order). */
export const STICKY_COL_KEYS: readonly string[] = ['slNo', 'name']

export type ColWidths = Record<string, number>
/** formatId → colKey → px */
export type ColWidthOverrides = Record<string, ColWidths>

export function clampColWidth(px: number): number {
  if (!Number.isFinite(px)) return MIN_COL_WIDTH_PX
  return Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_COL_WIDTH_PX, Math.round(px)))
}

/** Untrusted persisted value → clean overrides (bad shapes and non-finite numbers dropped, widths clamped). */
export function sanitizeColWidths(v: unknown): ColWidthOverrides {
  const out: ColWidthOverrides = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [fmt, cols] of Object.entries(v as Record<string, unknown>)) {
    if (!cols || typeof cols !== 'object' || Array.isArray(cols)) continue
    const m: ColWidths = {}
    for (const [k, w] of Object.entries(cols as Record<string, unknown>)) if (typeof w === 'number' && Number.isFinite(w)) m[k] = clampColWidth(w)
    if (Object.keys(m).length) out[fmt] = m
  }
  return out
}

/** Columns with the format's overrides applied. An overridden column becomes fixed-width (`flex: false`). Never mutates `cols`. */
export function applyColWidths(cols: readonly GridColumn[], widths: ColWidths | undefined): GridColumn[] {
  if (!widths) return cols.slice()
  return cols.map((c) => {
    const w = widths[c.key]
    return w === undefined ? c : { ...c, widthPx: clampColWidth(w), flex: false }
  })
}

export function setColWidth(o: ColWidthOverrides, formatId: string, key: string, px: number): ColWidthOverrides {
  return { ...o, [formatId]: { ...(o[formatId] ?? {}), [key]: clampColWidth(px) } }
}
export function resetColWidth(o: ColWidthOverrides, formatId: string, key: string): ColWidthOverrides {
  const cur = o[formatId]
  if (!cur || !(key in cur)) return o
  const { [key]: _gone, ...rest } = cur
  const { [formatId]: _old, ...others } = o
  return Object.keys(rest).length ? { ...others, [formatId]: rest } : others
}
export function resetFormatColWidths(o: ColWidthOverrides, formatId: string): ColWidthOverrides {
  if (!(formatId in o)) return o
  const { [formatId]: _old, ...others } = o
  return others
}

/** Width a column currently renders at, for keyboard steps (flex columns count as their minimum). */
export function currentColWidth(cols: readonly GridColumn[], key: string): number | null {
  return cols.find((c) => c.key === key)?.widthPx ?? null
}

/** Left offset (px) of each sticky column = sum of the sticky columns before it (only those actually present). */
export function stickyOffsets(cols: readonly GridColumn[]): Record<string, number> {
  const out: Record<string, number> = {}
  let left = 0
  for (const k of STICKY_COL_KEYS) {
    const c = cols.find((x) => x.key === k)
    if (!c) continue
    out[k] = left
    left += c.widthPx
  }
  return out
}

/**
 * First `max` user-perceived characters (grapheme clusters), so a cut never splits an emoji, a ZWJ sequence, a flag or a
 * combining mark (RTL text is cut in logical order, which is what the cell shows). Falls back to code points without Intl.Segmenter.
 */
export function sliceGraphemes(text: string, max: number): string {
  if (max <= 0) return ''
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter
  const parts = Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment) : Array.from(text)
  return parts.length <= max ? text : parts.slice(0, max).join('')
}
