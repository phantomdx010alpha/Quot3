import { CLAMPS } from '../theme/tokens'

/**
 * Phase 49 - density and font-size preferences (pure). `null` = "let the theme decide". A number is applied on top of the
 * active theme as an inline token and is held inside the same safe ranges a theme is clamped to (CLAMPS), so a preference can
 * never break the 20-visible-rows rule.
 */
export interface UiPrefs {
  /** Grid row height in px (`--row-height`). */
  rowHeight: number | null
  /** Grid font size in px (`--grid-font-size`). */
  gridFontSize: number | null
}

export const DEFAULT_UI_PREFS: UiPrefs = { rowHeight: null, gridFontSize: null }
export const UI_PREF_KEYS = { rowHeight: 'ui.rowHeight', gridFontSize: 'ui.gridFontSize' } as const
export const ROW_HEIGHT_RANGE = { min: CLAMPS['--row-height']!.min, max: CLAMPS['--row-height']!.max }
export const GRID_FONT_RANGE = { min: CLAMPS['--grid-font-size']!.min, max: CLAMPS['--grid-font-size']!.max }

export type UiPrefCheck = { ok: true; value: UiPrefs } | { ok: false; field: keyof UiPrefs; message: string }

const part = (v: unknown, r: { min: number; max: number }, label: string, field: keyof UiPrefs): { ok: true; v: number | null } | { ok: false; field: keyof UiPrefs; message: string } => {
  if (v === null || v === undefined || v === '') return { ok: true, v: null }
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isInteger(n)) return { ok: false, field, message: `${label} must be a whole number.` }
  if (n < r.min || n > r.max) return { ok: false, field, message: `${label} must be between ${r.min} and ${r.max}.` }
  return { ok: true, v: n }
}

/** Strict check for what the user typed (numbers or null). */
export function validateUiPrefs(input: { rowHeight: unknown; gridFontSize: unknown }): UiPrefCheck {
  const a = part(input.rowHeight, ROW_HEIGHT_RANGE, 'Row height', 'rowHeight')
  if (!a.ok) return a
  const b = part(input.gridFontSize, GRID_FONT_RANGE, 'Grid font size', 'gridFontSize')
  if (!b.ok) return b
  return { ok: true, value: { rowHeight: a.v, gridFontSize: b.v } }
}

/** Lenient read of stored values: anything unreadable or out of range is treated as "no preference" (never throws). */
export function readUiPrefs(stored: { rowHeight?: unknown; gridFontSize?: unknown }): UiPrefs {
  const one = (v: unknown, r: { min: number; max: number }): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max ? v : null
  return { rowHeight: one(stored.rowHeight, ROW_HEIGHT_RANGE), gridFontSize: one(stored.gridFontSize, GRID_FONT_RANGE) }
}

/** The inline tokens a preference set produces (empty when every preference is "theme decides"). */
export function uiPrefTokens(p: UiPrefs): Record<string, string> {
  const out: Record<string, string> = {}
  if (p.rowHeight !== null) out['--row-height'] = `${p.rowHeight}px`
  if (p.gridFontSize !== null) out['--grid-font-size'] = `${p.gridFontSize}px`
  return out
}
