import { getFormat } from '../format/registry'
import type { Paper, PrintMode } from '../types'
import { A4_MAX_ROWS, A5_MAX_ROWS } from './paperConstants'
import type { PaperDecision } from './paperTypes'

/**
 * Phase 36 - `decidePaper`, the A5/A4 decision table of PAPER_ENGINE_RULES §3. Pure: plain values in, a `PaperDecision`
 * out (no DOM, no Electron). Thresholds come from `paperConstants.ts`; the extra-column limit comes from the format
 * definition (`a5ExtraColLimit`) - this file never branches on a format id.
 */
export interface PaperInput {
  mode: PrintMode
  formatId: string
  /** Item rows + adjustment rows that have content. Footer rows and blank rows are NOT counted. */
  rowCount: number
  extraColCount: number
  /** The user's explicit choice - always honoured. */
  forced?: Paper
  /** The render-measure safety net saw A5 content overflow after wrapping (§4). */
  measuredOverflow?: boolean
}

const count = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Pages needed for `rows` on `size` (always at least 1). */
export function pagesFor(size: Paper, mode: PrintMode, rows: number): number {
  const per = size === 'A4' ? A4_MAX_ROWS[mode] : A5_MAX_ROWS[mode]
  return Math.max(1, Math.ceil(count(rows) / per))
}

export function decidePaper(i: PaperInput): PaperDecision {
  const format = getFormat(i.formatId)
  const rows = count(i.rowCount)
  const extras = count(i.extraColCount)
  const limit = format.a5ExtraColLimit
  const a5Max = A5_MAX_ROWS[i.mode]
  const a4Max = A4_MAX_ROWS[i.mode]

  // What the rules recommend, ignoring any forced size (rules 2-4 + the measured-overflow net).
  let suggested: Paper = 'A5'
  const reasons: string[] = []
  const warnings: string[] = []
  let requiresAck = false

  if (extras > limit) {
    suggested = 'A4'
    requiresAck = true
    const why = limit === 0
      ? `${format.label} bills with extra columns print on A4.`
      : `More than ${limit} extra columns — printing on A4 due to layout limits.`
    warnings.push(why)
    reasons.push(why)
  } else if (rows > a5Max) {
    suggested = 'A4'
    reasons.push(`${plural(rows, 'row', 'rows')} exceeds A5 limit of ${a5Max}`)
  } else {
    reasons.push(`Fits A5 (${plural(rows, 'row', 'rows')}, ${plural(extras, 'extra column', 'extra columns')})`)
  }

  let overflowSwitch = false
  if (suggested === 'A5' && i.measuredOverflow === true) {
    suggested = 'A4'
    overflowSwitch = true
    const why = 'Content did not fit A5 after wrapping long text — switched to A4.'
    warnings.push(why)
    reasons.length = 0
    reasons.push(why)
  }

  if (i.forced) {
    const size = i.forced
    const pages = pagesFor(size, i.mode, rows)
    const out: PaperDecision = { size, pages, suggested, reasons: [`Forced ${size}`], warnings: [], requiresAck: false }
    if (size === 'A5' && suggested === 'A4') {
      out.warnings.push(`Content may be cramped on A5 (${plural(rows, 'row', 'rows')} / ${plural(extras, 'extra column', 'extra columns')})`)
    }
    if (size === 'A5' && overflowSwitch) out.reasons.push('Measured content did not fit A5')
    return out
  }

  const pages = suggested === 'A4' ? pagesFor('A4', i.mode, rows) : 1
  if (suggested === 'A4' && pages > 1) reasons.push(`${plural(rows, 'row', 'rows')} exceeds the A4 limit of ${a4Max} per page — printing on ${pages} pages`)
  return { size: suggested, pages, suggested, reasons, warnings, requiresAck }
}
