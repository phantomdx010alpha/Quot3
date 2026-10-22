/** Phase 190 plain-word renames for the NEW phone layouts only (design section 7). Pure maps; classic, the desktop headers, print and the format
 *  registry never change. Keyed by COLUMN KEY and by screen string, never by format name (rule 4.4). */

export interface PlainWordsContext {
  /** The open format has a `gstAmt` column (a column check, not a format-name check). */
  hasGstAmtColumn: boolean
}

/** The plain label for a format column, or undefined to keep the registry label. "Before GST" only when the format also has a GST amount column:
 *  a Non-GST bill's `total` is its only money column and keeps "Total". */
export function plainLabel(columnKey: string, ctx: PlainWordsContext): string | undefined {
  switch (columnKey) {
    case 'total': return ctx.hasGstAmtColumn ? 'Before GST' : undefined
    case 'gstAmt': return 'GST'
    case 'amount': return 'Line total'
    default: return undefined
  }
}

/** Screen strings of the phone app, today's wording -> the new layouts' wording. */
export const PLAIN_TEXT: Readonly<Record<string, string>> = {
  'Total (typed)': 'Set price yourself',
  'Last export': 'Last backup',
  'Branch and sync': 'Connect to your PC',
  'PO prefix': 'Bill number letters'
}

export const plainText = (today: string): string => PLAIN_TEXT[today] ?? today
