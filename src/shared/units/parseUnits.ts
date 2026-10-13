/**
 * parseUnits — EXTRA_COLS_UNITS_RULES.md §2. Pure; units are decimal.js-backed canonical strings.
 * One cell = one code/units pair; only the text after the LAST separator is a quantity.
 */
import type { Dec } from '../types'
import { D, toDec } from '../money'

export interface ParsedUnits { code: string | null; units: Dec; parsed: boolean }

/** hyphen-minus, en dash, em dash, minus sign, equals */
const SEPARATORS = new Set(['-', '\u2013', '\u2014', '\u2212', '='])
const WRAPPERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
const CLOSERS = new Set([')', '}', ']'])
const UNITS_RE = /^\d+(\.\d+)?$/

const NOT_PARSED: ParsedUnits = { code: null, units: '0', parsed: false }

export function parseUnits(text: string | null | undefined): ParsedUnits {
  let s = (text ?? '').trim()
  if (s === '') return { ...NOT_PARSED }

  // 1. strip ONE matching wrapping pair, then any stray trailing closers
  const close = WRAPPERS[s[0] as string]
  if (close !== undefined && s.length >= 2 && s[s.length - 1] === close) s = s.slice(1, -1).trim()
  while (s.length > 0 && CLOSERS.has(s[s.length - 1] as string)) s = s.slice(0, -1).trimEnd()

  // 2. last separator
  let at = -1
  for (let i = s.length - 1; i >= 0; i--) {
    if (SEPARATORS.has(s[i] as string)) { at = i; break }
  }
  if (at < 0) return { ...NOT_PARSED }

  // 3. after-separator must be a non-negative decimal; code must be non-empty
  //    (a bare "-5" has no code, so it is not a code/units pair)
  const after = s.slice(at + 1).trim()
  const code = s.slice(0, at).trim()
  if (!UNITS_RE.test(after) || code === '') return { ...NOT_PARSED }
  return { code, units: toDec(D(after)), parsed: true }
}
