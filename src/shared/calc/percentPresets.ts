/**
 * Phase 82 - the % calculator's preset chips (CALCULATOR_PANEL_RULES section 3), setting `calc.percentPresets`: a comma list,
 * each 0 < p <= 1000, at most 8 chips, default 18, 5, 3. Pure; stored as the canonical comma text ("18, 5, 3").
 * Also the three results per percent (% of total, total + %, total - %) - decimal.js via `money.ts`, never JS numbers.
 */
import { D, toDec, type Decimal } from '../money'
import { formatCalcValue } from './expression'

export const PERCENT_PRESETS_KEY = 'calc.percentPresets'
export const DEFAULT_PERCENT_PRESETS: readonly string[] = Object.freeze(['18', '5', '3'])
export const PERCENT_PRESETS_MAX = 8
export const PERCENT_MAX = '1000'

export type PresetsCheck = { ok: true; presets: string[]; text: string } | { ok: false; message: string }

/** One typed percent (also used by the panel's typed-% field): canonical string, or null when not a number in (0, 1000]. */
export function parsePercent(raw: string): string | null {
  const t = raw.trim().replace(/%$/, '').trim()
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t) || t.replace('.', '').length > 12) return null
  const d = D(t)
  return d.gt(0) && d.lte(PERCENT_MAX) ? toDec(d) : null
}

/** Strict check of what the owner typed in Settings: blank = back to the default; duplicates are collapsed (first wins). */
export function validatePercentPresets(input: unknown): PresetsCheck {
  if (typeof input !== 'string') return { ok: false, message: 'Percent presets: type numbers separated by commas.' }
  if (input.trim() === '') return { ok: true, presets: [...DEFAULT_PERCENT_PRESETS], text: DEFAULT_PERCENT_PRESETS.join(', ') }
  const out: string[] = []
  for (const part of input.split(',')) {
    if (part.trim() === '') continue
    const p = parsePercent(part)
    if (p === null) return { ok: false, message: `"${part.trim().slice(0, 20)}" is not a valid percent (more than 0, at most ${PERCENT_MAX}).` }
    if (!out.includes(p)) out.push(p)
  }
  if (out.length === 0) return { ok: true, presets: [...DEFAULT_PERCENT_PRESETS], text: DEFAULT_PERCENT_PRESETS.join(', ') }
  if (out.length > PERCENT_PRESETS_MAX) return { ok: false, message: `At most ${PERCENT_PRESETS_MAX} percent presets.` }
  return { ok: true, presets: out, text: out.join(', ') }
}

/** Lenient read of the stored value (anything unreadable = the default); never throws. */
export function readPercentPresets(all: Record<string, unknown>): string[] {
  const v = all[PERCENT_PRESETS_KEY]
  const c = typeof v === 'string' ? validatePercentPresets(v) : null
  return c && c.ok ? c.presets : [...DEFAULT_PERCENT_PRESETS]
}

export interface PercentResults {
  /** `percent` % of the total. */
  of: string
  /** total + that amount. */
  plus: string
  /** total - that amount. */
  minus: string
}

/** The three results for a total (canonical decimal string) and a percent; display text (<= 10 dp, no trailing zeros). null on bad input. */
export function percentResults(total: string, percent: string): PercentResults | null {
  const p = parsePercent(percent)
  let t: Decimal
  try { t = D(total) } catch { return null }
  if (p === null) return null
  const part = t.times(D(p)).div(100)
  return { of: formatCalcValue(part), plus: formatCalcValue(t.plus(part)), minus: formatCalcValue(t.minus(part)) }
}
