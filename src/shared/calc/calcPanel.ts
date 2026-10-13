/**
 * Phase 83 - pure helpers for the calculator drawer: persisted prefs (`calc.open`, `calc.mode`), the live grand total read from
 * the grid footer, and the number text the panel shows. No React, no DOM, no Electron. Money stays decimal strings.
 */
import { evaluateExpression, type CalcResult } from './expression'
import { parsePercent, percentResults, type PercentResults } from './percentPresets'

export type CalcMode = 'calc' | 'percent'
export const CALC_PREF_KEYS = { open: 'calc.open', mode: 'calc.mode' } as const
export interface CalcPrefs { open: boolean; mode: CalcMode }
/** Closed by default on first run (CALCULATOR_PANEL_RULES section 1). */
export const DEFAULT_CALC_PREFS: CalcPrefs = { open: false, mode: 'calc' }

/** Lenient read of stored values: anything unreadable means the default (never throws). */
export function readCalcPrefs(stored: { open?: unknown; mode?: unknown }): CalcPrefs {
  return { open: stored.open === true, mode: stored.mode === 'percent' ? 'percent' : 'calc' }
}

export const otherMode = (m: CalcMode): CalcMode => (m === 'calc' ? 'percent' : 'calc')

/** Minimal shape of a grid footer row (structural, so this file imports nothing from the grid). */
export interface FooterLike { kind: string; cells: Record<string, string> }

/** The bill's grand total (after round-off when enabled) as a canonical decimal string, or null when there is none. GST formats show it in Amount. */
export function grandTotalOf(footer: readonly FooterLike[]): string | null {
  for (let i = footer.length - 1; i >= 0; i--) {
    const d = footer[i]!
    if (d.kind !== 'grandTotal') continue
    const raw = (d.cells['amount'] ?? d.cells['total'] ?? '').replace(/,/g, '').trim()
    return /^-?\d+(\.\d+)?$/.test(raw) ? raw : null
  }
  return null
}

/** Indian digit grouping of the integer part of a plain number text ("1234567.5" -> "12,34,567.5"). Anything that is not a plain number is returned unchanged. */
export function groupCalcText(text: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(text)
  if (!m) return text
  const int = m[2]!
  const grouped = int.length <= 3 ? int : int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3)
  return `${m[1]}${grouped}${m[3] ?? ''}`
}

export interface CalcLine {
  /** What the panel shows beside the field: grouped result text, an error message, or '' for an empty field. */
  shown: string
  /** True when the input is non-empty and not valid yet. */
  error: boolean
  /** The plain result text Enter puts back into the field (no grouping), when ok. */
  text: string | null
}

/** Live line for the expression field. An empty field is neither a result nor an error. */
export function calcLine(input: string): CalcLine {
  if (input.trim() === '') return { shown: '', error: false, text: null }
  const r: CalcResult = evaluateExpression(input)
  return r.ok ? { shown: groupCalcText(r.text), error: false, text: r.text } : { shown: r.error, error: true, text: null }
}

/** Enter = `=`: the result replaces the expression. Returns null when the input is empty or invalid (the field is left as it is). */
export function commitExpression(input: string): string | null {
  const l = calcLine(input)
  return l.text
}

export interface PercentRow { percent: string; results: PercentResults }

/** The preset chips' rows plus the typed % (when valid and not already a preset) for a total; null total gives no rows. */
export function percentRows(total: string | null, presets: readonly string[], typed: string): PercentRow[] {
  if (total === null) return []
  const list = [...presets]
  const t = typed.trim() === '' ? null : parsePercent(typed)
  if (t !== null && !list.includes(t)) list.push(t)
  const out: PercentRow[] = []
  for (const p of list) {
    const results = percentResults(total, p)
    if (results) out.push({ percent: p, results })
  }
  return out
}

/** True when the typed % field has text that is not a valid percent (shown as an inline error). */
export const typedPercentInvalid = (typed: string): boolean => typed.trim() !== '' && parsePercent(typed) === null
