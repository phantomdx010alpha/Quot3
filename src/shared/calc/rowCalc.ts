import { D, round2, toMoney, tryD, type Decimal } from '../money'
import type { BillRow, Dec, FormatDef } from '../types'
import { classifyRow, hasOverride, hasQty, hasRate, rowName } from './classifyRow'

export interface RowCalc {
  total: Dec | null
  gstAmt: Dec | null
  amount: Dec | null
  isOverride: boolean
  /** qty × rate (2 dp) ignoring any override; null unless both are present and valid. Shown in the override tooltip. */
  auto: Dec | null
  /** Stable codes: MISSING_NAME, MISSING_QTY_OR_RATE, INVALID_NUMBER, NEGATIVE_QTY_RATE. */
  warnings: string[]
}

/** Does this format compute GST columns? Data-driven (never by format name). */
export const formatHasGst = (format: FormatDef): boolean => format.columns.some((c) => c.key === 'gstAmt')

/** Phase 149: does this format have any money at all (a Total column)? Stock transfer has none: no totals, no maths, no number checks. Data-driven. */
export const formatHasMoney = (format: FormatDef): boolean => format.columns.some((c) => c.key === 'total')

/**
 * D-M2 / D-M3.
 * total  = override (as typed, 2 dp) if set; else qty × rate rounded to 2 dp; else null (only one of qty/rate).
 * gstAmt = total × gstRate / 100 (2 dp) from the EFFECTIVE total; amount = total + gstAmt. Blank GST % = 0.
 * Adjustments never carry GST (D-C2): gstAmt null, amount = total. Non-GST formats have no gstAmt/amount.
 * Whether a row is *counted* is decided by computeBill from its kind; partial rows still report a typed total.
 */
export function calcRow(format: FormatDef, row: BillRow): RowCalc {
  const warnings: string[] = []
  const kind = classifyRow(row)
  if (!formatHasMoney(format)) {
    // Phase 149: qty is free text here and nothing is multiplied; only a missing name is worth a flag.
    if (kind === 'item' && rowName(row) === '') warnings.push('MISSING_NAME')
    return { total: null, gstAmt: null, amount: null, isOverride: false, auto: null, warnings }
  }
  const isOverride = hasOverride(row)
  const qty = hasQty(row) ? tryD(row.qty) : null
  const rate = hasRate(row) ? tryD(row.rate) : null
  const ovr = isOverride ? tryD(row.totalOverride) : null

  if ((hasQty(row) && !qty) || (hasRate(row) && !rate) || (isOverride && !ovr)) warnings.push('INVALID_NUMBER')
  if ((qty && qty.isNegative()) || (rate && rate.isNegative())) warnings.push('NEGATIVE_QTY_RATE') // D-M7: rejected at input
  if (kind === 'item' && rowName(row) === '') warnings.push('MISSING_NAME') // D-C1
  if (kind === 'item' && !isOverride && (!hasQty(row) || !hasRate(row))) warnings.push('MISSING_QTY_OR_RATE')

  const autoD: Decimal | null = qty && rate ? round2(qty.times(rate)) : null
  const auto: Dec | null = autoD ? toMoney(autoD) : null
  const total: Decimal | null = ovr ? round2(ovr) : autoD

  if (!total) return { total: null, gstAmt: null, amount: null, isOverride: ovr !== null, auto, warnings }

  const totalStr = toMoney(total)
  if (!formatHasGst(format)) return { total: totalStr, gstAmt: null, amount: null, isOverride: ovr !== null, auto, warnings }
  if (kind === 'adjustment') return { total: totalStr, gstAmt: null, amount: totalStr, isOverride: true, auto, warnings }

  const gstPct = row.gstRate !== null && row.gstRate.trim() !== '' ? tryD(row.gstRate) : null
  if (row.gstRate !== null && row.gstRate.trim() !== '' && !gstPct) warnings.push('INVALID_NUMBER')
  const gst = round2(total.times(gstPct ?? D(0)).dividedBy(100))
  return {
    total: totalStr,
    gstAmt: toMoney(gst),
    amount: toMoney(total.plus(gst)),
    isOverride: ovr !== null,
    auto,
    warnings
  }
}

/** Test/perf hook: how many times the real `calcRow` ran through the cache (Phase 13). */
export const calcStats = { computed: 0 }
const calcCache = new WeakMap<FormatDef, WeakMap<BillRow, RowCalc>>()

/**
 * Phase 13 — incremental recalculation. Rows are immutable (an edit replaces the row object), so a row object that
 * was already calculated for this format has an unchanged result: reuse it. Only the edited row is recomputed; the
 * footer is then re-summed from the cached per-row results. Callers must treat the result as read-only.
 */
export function calcRowCached(format: FormatDef, row: BillRow): RowCalc {
  let perFormat = calcCache.get(format)
  if (!perFormat) { perFormat = new WeakMap(); calcCache.set(format, perFormat) }
  const hit = perFormat.get(row)
  if (hit) return hit
  calcStats.computed++
  const c = calcRow(format, row)
  perFormat.set(row, c)
  return c
}
