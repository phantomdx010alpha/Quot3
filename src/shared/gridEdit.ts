/**
 * Pure cell-edit helpers (Phase 11): raw text of a cell, applying committed text back onto a BillRow, and the
 * numeric draft validator. No DOM, no store. Phase 12 adds paste sanitising; Phase 13 the Total override; Phases
 * 14/15 replace the plain-text name handling with the runs engine.
 */
import { isNumericStr, tryD, toDec } from './money'
import type { BillRow, Run, Runs } from './types'
import type { GridColumn } from './gridModel'
import { applyTextChange, runsEqual } from './richtext/runs'

/** Phase 13: the Total cell is typable — editing it sets a manual override (Delete / empty / Ctrl+Backspace reset to auto). */
export const TOTAL_OVERRIDE_EDITABLE = true

/** Column keys whose text is entered as a number. */
export function isNumericColumn(col: Pick<GridColumn, 'kind' | 'key'>): boolean {
  return col.kind === 'num' || col.key === 'total'
}
/** Can the user type into this column right now? (Navigable ≠ typable: Total is navigable only.) */
export function isTypable(col: Pick<GridColumn, 'editable' | 'key'>): boolean {
  return col.editable && (col.key !== 'total' || TOTAL_OVERRIDE_EDITABLE)
}
/** Leading '-' is allowed only in Total (adjustments/discounts); qty, rate and GST % are never negative (D-M7). */
export function allowsNegative(colKey: string): boolean { return colKey === 'total' }

/** `1.5`, `-`, `.`, `12.` … : what a numeric cell may hold WHILE being typed. */
export function isValidNumericDraft(text: string, allowNegative: boolean): boolean {
  if (!/^-?\d*\.?\d*$/.test(text)) return false
  return allowNegative || !text.startsWith('-')
}

/**
 * Phase 12 — paste/drop sanitiser for numeric cells. Strips what people copy along with a number (spaces, thousands
 * commas incl. Indian grouping, a ₹ / Rs / INR prefix, NBSP, a trailing `/-`), then checks the RESULTING cell text is a
 * valid draft. Returns the text to insert, or `null` = reject the whole paste (nothing is inserted). Never guesses:
 * `1e3`, `12abc`, `1.2.3`, `(5)` are rejected, and a `-` is only accepted where negatives are allowed and it ends up leading.
 */
export function sanitizeNumericPaste(raw: string, current: string, start: number, end: number, allowNegative: boolean): string | null {
  let t = raw.replace(/[\u00a0\s]+/g, '').replace(/^(?:₹|rs\.?|inr)/i, '').replace(/\/-$/, '').replace(/,/g, '')
  t = t.replace(/^\u2212/, '-') // unicode minus
  if (t === '') return null
  const result = current.slice(0, start) + t + current.slice(end)
  return isValidNumericDraft(result, allowNegative) ? t : null
}

export function runsToPlain(runs: Runs): string {
  let s = ''
  for (const r of runs) s += r.t
  return s
}

/**
 * Plain-text replacement of item-name runs that keeps styling where it can (typing at the end continues the last
 * run's style; deleting from the end truncates). Any other edit flattens to one unstyled run — the runs engine
 * (Phase 14/15) replaces this for mid-text edits.
 */
export function setPlainName(runs: Runs, text: string): Runs {
  const old = runsToPlain(runs)
  if (text === old) return runs
  if (text === '') return []
  if (old !== '' && text.startsWith(old)) {
    const last = runs[runs.length - 1] as Run
    return [...runs.slice(0, -1), { ...last, t: last.t + text.slice(old.length) }]
  }
  if (old.startsWith(text)) {
    const out: Run[] = []
    let left = text.length
    for (const r of runs) {
      if (left <= 0) break
      out.push(r.t.length <= left ? r : { ...r, t: r.t.slice(0, left) })
      left -= r.t.length
    }
    return out
  }
  return [{ t: text }]
}

/**
 * Phase 13 — Total cell. Blank = reset to auto (clears the override). Merely visiting the cell (text numerically equal
 * to what it showed) changes nothing, so an auto total never becomes an override by accident. Anything else valid sets
 * the override (stored as typed, canonical; the calc rounds to 2 dp). Invalid drafts (`-`, `.`) revert. Negatives are
 * allowed here (discount adjustments, D-M7).
 */
function applyTotalText(row: BillRow, text: string, display: string): Partial<BillRow> | null {
  let t = text.trim()
  if (t === '') return row.totalOverride === null ? null : { totalOverride: null }
  if (!/\d/.test(t)) return null // '-', '.', '-.' : unfinished draft reverts
  if (!isNumericStr(t)) {
    if (t.endsWith('.')) t += '0'
    if (t.startsWith('.') || t.startsWith('-.')) t = t.replace('.', '0.')
    if (!isNumericStr(t)) return null
  }
  const d = tryD(t)
  if (!d) return null
  const shown = display.trim() === '' ? null : tryD(display.trim())
  if (shown && shown.equals(d)) return null
  const val = toDec(d)
  return val === row.totalOverride ? null : { totalOverride: val }
}

/** The text a cell shows while it is being edited. `display` is the grid's formatted string (used for derived cells). */
export function cellRawText(row: BillRow, colKey: string, display: string): string {
  switch (colKey) {
    case 'name': return runsToPlain(row.nameRuns)
    case 'qty': return row.qty ?? ''
    case 'rate': return row.rate ?? ''
    case 'gstRate': return row.gstRate ?? ''
    default: {
      const ex = row.extras[colKey]
      return ex ? ex.text : display
    }
  }
}

/**
 * Committed text → row patch. Returns `null` when nothing changes or the text is not committable (an invalid numeric
 * draft such as "-" or "." reverts to the previous value; it never clears it). Empty text clears.
 */
export function applyCellText(
  row: BillRow,
  col: Pick<GridColumn, 'key' | 'kind' | 'editable' | 'isExtra'>,
  text: string,
  /** `display` = the text the cell showed when editing began (the Total cell uses it to ignore an unchanged visit). */
  ctx: { display?: string } = {}
): Partial<BillRow> | null {
  if (!isTypable(col)) return null
  const k = col.key
  if (k === 'total') return applyTotalText(row, text, ctx.display ?? '')
  if (k === 'name') {
    // Phase 15: the runs engine keeps per-letter formatting through any edit (prefix/suffix diff).
    const runs = applyTextChange(row.nameRuns, text)
    return runsEqual(runs, row.nameRuns) ? null : { nameRuns: runs }
  }
  if (k === 'qty' || k === 'rate' || k === 'gstRate') {
    let t = text.trim()
    if (t.endsWith('.')) t += '0'
    if (t.startsWith('.')) t = '0' + t
    let val: string | null
    if (t === '') val = null
    else {
      if (!isNumericStr(text.trim()) || t.startsWith('-')) return null
      const d = tryD(t)
      if (!d) return null
      val = toDec(d)
    }
    return val === row[k] ? null : { [k]: val }
  }
  if (col.isExtra) {
    const cur = row.extras[k]
    if ((cur?.text ?? '') === text) return null
    return { extras: { ...row.extras, [k]: { ...(cur ?? {}), text } } }
  }
  return null
}
