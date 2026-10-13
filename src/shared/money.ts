/**
 * The ONLY place money / quantity / rate / percentage arithmetic happens (decimal.js, precision 28,
 * ROUND_HALF_UP — MASTERPLAN §8 D-M1). Values travel as canonical decimal strings; never use JS-number math
 * on them anywhere else.
 */
import DecimalBase from 'decimal.js'
import type { Dec } from './types'

const Dc = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_UP })
export type Decimal = DecimalBase

const STRICT_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/
const NUMERIC_RE = /^-?(\d+\.?\d*|\.\d+)$/

/**
 * Parse to Decimal. `null` / `undefined` / blank string → 0. Throws on anything non-numeric
 * (no exponents, hex, NaN or Infinity — those are never valid cell input).
 */
export function D(v: Dec | Decimal | number | null | undefined): Decimal {
  if (v === null || v === undefined) return new Dc(0)
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Not a number: ${v}`)
    return new Dc(v)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return new Dc(0)
    if (!STRICT_RE.test(s)) throw new Error(`Not a decimal string: "${v}"`)
    return new Dc(s)
  }
  return new Dc(v)
}

/** Non-throwing parse for user text: blank or invalid → null. */
export function tryD(s: Dec | null | undefined): Decimal | null {
  if (s === null || s === undefined) return null
  const t = s.trim()
  return STRICT_RE.test(t) ? new Dc(t) : null
}

/** A complete, valid numeric string as typed in a cell: optional leading `-`, digits, one optional `.` ("12.", ".5" ok). */
export function isNumericStr(s: string): boolean {
  return NUMERIC_RE.test(s)
}

/** ROUND_HALF_UP to 2 decimal places. */
export function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, DecimalBase.ROUND_HALF_UP)
}

/** ROUND_HALF_UP to a whole number (the round-off line and Phase 76's `roundGrand`; half rounds away from zero, so -2.5 -> -3). */
export function roundInt(d: Decimal): Decimal {
  return d.toDecimalPlaces(0, DecimalBase.ROUND_HALF_UP)
}

/** Canonical decimal string: plain notation (never exponent), trailing zeros trimmed, `-0` → "0". */
export function toDec(d: Decimal): Dec {
  return d.isZero() ? '0' : d.toFixed()
}

/** Money as a canonical 2-dp string ("1250.50", "90.00"): rounds HALF_UP; zero is always "0.00". */
export function toMoney(d: Decimal): Dec {
  const r = round2(d)
  return r.isZero() ? '0.00' : r.toFixed(2)
}

export const add = (a: Dec | Decimal, b: Dec | Decimal): Decimal => D(a).plus(D(b))
export const mul = (a: Dec | Decimal, b: Dec | Decimal): Decimal => D(a).times(D(b))

/** Exact sum of already-rounded values (D-M4: never re-round a sum of unrounded values). */
export function sum(values: readonly (Dec | Decimal)[]): Decimal {
  let acc = new Dc(0)
  for (const v of values) acc = acc.plus(D(v))
  return acc
}

/** Qty / rate / percent for display: trimmed (`10.0` → `10`, `12.50` → `12.5`). Blank → "". */
export function fmtQty(v: Dec | null | undefined): string {
  const d = tryD(v)
  return d ? toDec(d) : ''
}

function groupIndian(int: string): string {
  if (int.length <= 3) return int
  const head = int.slice(0, -3)
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + int.slice(-3)
}

/**
 * Money for display, always 2 dp. `indian` groups as 1,07,500.00; `symbol` prefixes ₹ (after the minus sign).
 * Grid money cells use the plain form (no options).
 */
export function fmtMoney(v: Dec | Decimal, opts: { indian?: boolean; symbol?: boolean } = {}): string {
  const r = round2(D(v))
  const neg = r.isNegative() && !r.isZero()
  const [int = '0', frac = '00'] = r.abs().toFixed(2).split('.')
  const body = `${opts.indian ? groupIndian(int) : int}.${frac}`
  return `${neg ? '-' : ''}${opts.symbol ? '₹' : ''}${body}`
}
