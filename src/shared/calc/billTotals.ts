import { D, fmtMoney, fmtQty, round2, roundInt, sum, toMoney, type Decimal } from '../money'
import type { BillRow, Dec, FormatDef, Id, RowKind } from '../types'
import { classifyRow, hasQty, hasRate, rowName } from './classifyRow'
import { calcRowCached, formatHasGst, type RowCalc } from './rowCalc'

export type DisplayKind = RowKind | 'itemsTotal' | 'adjustmentsTotal' | 'grandTotal' | 'roundOff'

export interface DisplayRow {
  kind: DisplayKind
  rowId?: Id
  slNo?: number
  /** Phase 13: the Total shown is a manual override (body rows only). */
  override?: true
  /** The auto qty × rate value, when there is one (tooltip for an overridden total). */
  ovrAuto?: string
  /** Keyed by column key (slNo, name, qty, rate, total, gstRate, gstAmt, amount) and by extra-column key. */
  cells: Record<string, string>
}

export interface BillTotals {
  /** Non-adjustment rows in entry order (item/blank/partial), then the footer in the owner's order. */
  display: DisplayRow[]
  slNo: Record<Id, number | null>
  itemsTotal: Dec
  itemsGst: Dec
  /** GST formats: sum of Amount over items. Non-GST: equals itemsTotal. */
  itemsAmount: Dec
  adjustments: { rowId: Id; total: Dec }[]
  adjustmentsTotal: Dec
  /** The round-off amount (0.00 when disabled or already whole). Shown as a footer line only for the legacy `roundOff` option; with `roundGrand` it is kept internally. */
  roundOff: Dec
  grandTotal: Dec
  counts: { itemRows: number; adjustmentRows: number; paperRows: number }
  /** `CODE:rowId` strings. */
  warnings: string[]
}

export interface ComputeOptions {
  /** Add an explicit "Round off" line so the final total is a whole rupee (MASTERPLAN D-M5; off by default). */
  roundOff?: boolean
  /**
   * Phase 76 (M8 §6): round the GRAND total to the nearest whole rupee (ROUND_HALF_UP) WITHOUT a displayed line. The difference is
   * kept in `BillTotals.roundOff`; the footer shows the rounded final total only. Wins over `roundOff` when both are set.
   * Callers get this from `getBillOptions` (shared/calc/billOptions.ts), never by hand.
   */
  roundGrand?: boolean
  /**
   * Phase 79 (M8 §7): number of non-empty extra-only tail rows below the Final total; they take paper space, so
   * `counts.paperRows` = items + adjustments + tail rows. Callers get it from `getBillOptions`. Never affects any amount.
   */
  tailRowCount?: number
}

export const FOOTER_LABELS = {
  total: 'Total',
  itemsTotal: 'Items total',
  adjustmentsTotal: 'Adjustments total',
  roundOff: 'Round off',
  grandTotal: 'Final total'
} as const

function rowCells(row: BillRow, calc: RowCalc, slNo: number | null): Record<string, string> {
  const cells: Record<string, string> = {
    slNo: slNo === null ? '' : String(slNo),
    name: rowName(row),
    qty: fmtQty(row.qty),
    rate: fmtQty(row.rate),
    total: calc.total === null ? '' : fmtMoney(calc.total),
    gstRate: fmtQty(row.gstRate),
    gstAmt: calc.gstAmt === null ? '' : fmtMoney(calc.gstAmt),
    amount: calc.amount === null ? '' : fmtMoney(calc.amount)
  }
  for (const [k, c] of Object.entries(row.extras)) cells[k] = c.text
  return cells
}

/**
 * Whole-bill math (MASTERPLAN §8, §11). Pure. Items total = sum of effective, already-rounded row totals
 * (D-M4). Footer order: Items total → adjustment rows → Adjustments total → Final total; with no adjustments
 * (and no round-off) a single "Total". Adjustments are untaxed and, in GST formats, touch the Amount column only.
 */
export function computeBill(format: FormatDef, rows: readonly BillRow[], opts: ComputeOptions = {}): BillTotals {
  const gst = formatHasGst(format)
  const gstFooter = format.footer === 'total_gst_amount'
  const slNo: Record<Id, number | null> = {}
  const warnings: string[] = []
  const body: DisplayRow[] = []
  const adjRows: { row: BillRow; calc: RowCalc }[] = []
  const itemTotals: Dec[] = []
  const itemGsts: Dec[] = []
  const itemAmounts: Dec[] = []
  let itemRows = 0
  let n = 0

  for (const row of rows) {
    const kind = classifyRow(row)
    const calc = calcRowCached(format, row)
    for (const w of calc.warnings) warnings.push(`${w}:${row.id}`)

    if (kind === 'adjustment') {
      slNo[row.id] = null
      adjRows.push({ row, calc })
      continue
    }
    let sl: number | null = null
    if (kind === 'item') {
      itemRows++
      if (rowName(row) !== '' && (hasQty(row) || hasRate(row))) sl = ++n
      if (calc.total !== null) {
        itemTotals.push(calc.total)
        if (gst) {
          itemGsts.push(calc.gstAmt ?? '0.00')
          itemAmounts.push(calc.amount ?? calc.total)
        }
      }
    }
    slNo[row.id] = sl
    // Partial rows are shown and flagged but never totalled.
    body.push({
      kind, rowId: row.id, ...(sl !== null ? { slNo: sl } : {}),
      ...(calc.isOverride ? { override: true as const, ...(calc.auto !== null ? { ovrAuto: fmtMoney(calc.auto) } : {}) } : {}),
      cells: rowCells(row, calc, sl)
    })
  }

  const tailRows = Number.isInteger(opts.tailRowCount) && (opts.tailRowCount as number) > 0 ? (opts.tailRowCount as number) : 0
  const itemsTotalD = sum(itemTotals)
  const itemsGstD = sum(itemGsts)
  const itemsAmountD = gst ? sum(itemAmounts) : itemsTotalD
  const adjustments = adjRows.map(({ row, calc }) => ({ rowId: row.id, total: calc.total ?? '0.00' }))
  const adjustmentsTotalD = sum(adjustments.map((a) => a.total))
  const preRound: Decimal = itemsAmountD.plus(adjustmentsTotalD)
  const roundOffD = opts.roundOff || opts.roundGrand ? roundInt(preRound).minus(preRound) : D(0)
  const grandD = round2(preRound.plus(roundOffD))

  // Footer cells. 'total' footers use the Total column; GST footers: items row fills total/gstAmt/amount,
  // every other footer row (adjustments, round-off, final) uses the Amount column only.
  const valueCell = (v: Decimal, full?: boolean): Record<string, string> =>
    gstFooter
      ? full
        ? { total: fmtMoney(itemsTotalD), gstAmt: fmtMoney(itemsGstD), amount: fmtMoney(v) }
        : { amount: fmtMoney(v) }
      : { total: fmtMoney(v) }
  const footerRow = (kind: DisplayKind, label: string, v: Decimal, full?: boolean): DisplayRow => ({
    kind,
    cells: { name: label, ...valueCell(v, full) }
  })

  const display = body
  const showRoundOff = !roundOffD.isZero() && opts.roundGrand !== true // roundGrand: the amount is kept in `roundOff`, no line is shown
  if (adjRows.length === 0 && !showRoundOff) {
    display.push(footerRow('grandTotal', FOOTER_LABELS.total, grandD, true))
  } else {
    display.push(footerRow('itemsTotal', FOOTER_LABELS.itemsTotal, itemsAmountD, true))
    if (adjRows.length > 0) {
      for (const { row, calc } of adjRows) {
        const cells = rowCells(row, calc, null)
        if (gstFooter) {
          // adjustments add to the Amount column only
          cells['amount'] = cells['total'] ?? ''
          cells['total'] = ''
        }
        display.push({ kind: 'adjustment', rowId: row.id, cells })
      }
      display.push(footerRow('adjustmentsTotal', FOOTER_LABELS.adjustmentsTotal, adjustmentsTotalD))
    }
    if (showRoundOff) display.push(footerRow('roundOff', FOOTER_LABELS.roundOff, roundOffD))
    display.push(footerRow('grandTotal', FOOTER_LABELS.grandTotal, grandD))
  }

  return {
    display,
    slNo,
    itemsTotal: toMoney(itemsTotalD),
    itemsGst: toMoney(itemsGstD),
    itemsAmount: toMoney(itemsAmountD),
    adjustments,
    adjustmentsTotal: toMoney(adjustmentsTotalD),
    roundOff: toMoney(roundOffD),
    grandTotal: toMoney(grandD),
    counts: { itemRows, adjustmentRows: adjRows.length, paperRows: itemRows + adjRows.length + tailRows },
    warnings
  }
}
