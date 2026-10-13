import type { ComputeOptions } from './billTotals'

/**
 * Phase 76 - the ONE place a bill's calculation options are read (M8 R5). Every caller of `computeBill` for a saved / printed /
 * copied bill (Phase 77: gridModel, billModel, billTsv x2, printModel) passes `getBillOptions(bill)` and nothing else; no caller
 * reads the `calc.roundOff` setting or the bill's flag on its own. Pure.
 *
 * The per-bill flag `roundOff` (DB `bills.round_off`, default 0) decides: 1 = round the grand total to the nearest rupee with
 * no displayed line. Old bills are 0 so their totals never change until they are re-saved with the setting on (Phase 77 sets the
 * flag on save from `calc.roundOff`); imported bills are 0.
 */
export const ROUND_OFF_SETTING_KEY = 'calc.roundOff'

/** The setting, tolerant: default ON, only an explicit `false` turns it off. Used by Phase 77 to choose the flag when a bill is saved. */
export const readRoundOffSetting = (all: Record<string, unknown>): boolean => all[ROUND_OFF_SETTING_KEY] !== false

/** The flag as stored: anything but a truthy 1 / true is 0. */
export const normalizeRoundOff = (v: unknown): 0 | 1 => (v === 1 || v === true ? 1 : 0)

/**
 * Phase 79: the number of paper rows the tail rows occupy = position of the last non-empty tail row (blank rows in between are
 * real rows on paper; trailing blanks are trimmed on save so they never count). Tolerant of junk (returns 0).
 */
export function tailRowCountOf(tailRows: unknown): number {
  if (!Array.isArray(tailRows)) return 0
  for (let i = tailRows.length - 1; i >= 0; i--) {
    const ex = (tailRows[i] as { extras?: unknown } | null)?.extras
    if (ex && typeof ex === 'object' && Object.values(ex as Record<string, { text?: unknown; marked?: unknown } | null>).some((c) => !!c && ((typeof c.text === 'string' && c.text !== '') || !!c.marked))) return i + 1
  }
  return 0
}

export function getBillOptions(bill: { roundOff?: unknown; tailRows?: unknown } | null | undefined): ComputeOptions {
  const o: ComputeOptions = normalizeRoundOff(bill?.roundOff) === 1 ? { roundGrand: true } : {}
  const t = tailRowCountOf(bill?.tailRows)
  if (t > 0) o.tailRowCount = t
  return o
}
