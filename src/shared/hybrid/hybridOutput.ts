/**
 * Phase 152 - Hybrid output (rule 9 of MILESTONE14_DESIGN.md 1.6): Print, Save PDF, image copy and text (TSV) copy ask
 * "GST side or non-GST side?" and output ONLY the chosen side, laid out like that format's normal bill.
 *
 * The whole feature rests on one pure function: `billForSide` turns a Hybrid bill into a NORMAL bill (no `hybrid` key,
 * `formatId` = the side, `rows` = that side's table). Every output path then runs unchanged on that bill, so fit-to-page, the
 * hide-adjustments-total setting, the rupee sign, the paper rules and the TSV layout all apply as for any other bill, and
 * nothing of the other table can reach the output (it is not in the object any more). No DOM, no Electron, no Node.
 */
import type { Bill, HybridSide } from '../types'
import { isHybridActive, tableRows } from './hybrid'

export type OutputPurpose = 'print' | 'pdf' | 'image' | 'tsv'

/** The side picker is asked only while the side-by-side Hybrid view is on; a bill whose view is off outputs its primary table as today. */
export const needsSidePick = (bill: Pick<Bill, 'hybrid'>): boolean => isHybridActive(bill)

export const sideLabel = (side: HybridSide): string => (side === 'gst' ? 'GST' : 'Non-GST')

/**
 * The bill for ONE side. Primary side: `bill.rows`. Second side: the second table with its extra cells resolved from the
 * paired primary rows (shared extra columns, rule 7). Bill-level things stay (party, date, PO, extra column definitions,
 * round-off, paper override, footer / total-row free cells). Tail rows (extra-only rows under the Final total) exist under the
 * primary table only (Phase 151 [A]), so the second side has none. A bill without a second table is returned unchanged.
 */
export function billForSide(bill: Bill, side: HybridSide): Bill {
  if (!bill.hybrid) return bill
  const { hybrid: _hybrid, tailRows: _tail, ...rest } = bill
  const rows = tableRows(bill, side)
  const out: Bill = { ...rest, formatId: side, rows }
  if (side === bill.hybrid.primary && bill.tailRows) out.tailRows = bill.tailRows
  return out
}

/** Key presses of the side picker: G = GST side, N = non-GST side, Esc = cancel (nothing is output). Anything with Ctrl / Alt / Meta is not ours. */
export type SidePickKey = { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }
export function sidePickKey(e: SidePickKey): HybridSide | 'cancel' | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  const k = e.key
  if (k === 'g' || k === 'G') return 'gst'
  if (k === 'n' || k === 'N') return 'non_gst'
  if (k === 'Escape') return 'cancel'
  return null
}

/** Dialog title per output path. */
export function sidePickTitle(purpose: OutputPurpose): string {
  if (purpose === 'print') return 'Print which side?'
  if (purpose === 'pdf') return 'Save PDF of which side?'
  if (purpose === 'image') return 'Copy image of which side?'
  return 'Copy text of which side?'
}
