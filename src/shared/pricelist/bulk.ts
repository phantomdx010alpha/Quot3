/**
 * Phase 235 (M23) - bulk tools (pure; decimal.js only through shared/money). Every function RETURNS a preview list of changes and
 * never mutates; `applyChanges` writes them. "Fill column from another column" is a ONE-TIME action, not a live formula.
 */
import { D, isNumericStr, round2, roundInt, toDec } from '../money'
import { fromPlain, plain, runsEqual } from '../richtext/runs'
import type { Runs } from '../types'
import { NAME_COLUMN_KEY, type PriceColumn, type PriceRow } from './types'

export interface CellChange { rowId: string; columnKey: string; before: string; after: string }
export interface NameChange { rowId: string; before: Runs; after: Runs }
export interface BulkScope { rowIds?: ReadonlySet<string>; skipSections?: boolean }
export interface BulkPreview { changes: CellChange[]; skipped: number }
export type Rounding = 'none' | 'two' | 'whole'

const inScope = (r: PriceRow, s: BulkScope): boolean => r.kind === 'item' && (!s.rowIds || s.rowIds.has(r.id))
function roundTo(v: ReturnType<typeof D>, mode: Rounding): string { return toDec(mode === 'two' ? round2(v) : mode === 'whole' ? roundInt(v) : v) }
const hasValue = (v: string | undefined): v is string => v !== undefined && v !== '' && isNumericStr(v)

/** Adjust every non-empty price in `columnKey` by +/- `percent` (e.g. "10", "-5"). Empty / non-numeric cells are skipped. Never goes below 0. */
export function adjustPercent(rows: readonly PriceRow[], columnKey: string, percent: string, scope: BulkScope = {}, rounding: Rounding = 'two'): BulkPreview {
  const p = D(percent)
  const factor = D(100).plus(p).div(100)
  return adjust(rows, columnKey, scope, (v) => v.times(factor), rounding)
}
/** Adjust by a fixed amount ("+2", "-1.5"). */
export function adjustAmount(rows: readonly PriceRow[], columnKey: string, amount: string, scope: BulkScope = {}, rounding: Rounding = 'two'): BulkPreview {
  const a = D(amount)
  return adjust(rows, columnKey, scope, (v) => v.plus(a), rounding)
}
function adjust(rows: readonly PriceRow[], columnKey: string, scope: BulkScope, f: (v: ReturnType<typeof D>) => ReturnType<typeof D>, rounding: Rounding): BulkPreview {
  const changes: CellChange[] = []
  let skipped = 0
  for (const r of rows) {
    if (!inScope(r, scope)) continue
    const before = r.cells[columnKey]
    if (!hasValue(before)) { skipped++; continue }
    let n = f(D(before))
    if (n.isNegative()) n = D(0)
    const after = roundTo(n, rounding)
    if (after !== before) changes.push({ rowId: r.id, columnKey, before, after })
  }
  return { changes, skipped }
}

/** Fill `toKey` from `fromKey` times (1 + percent/100). By default only EMPTY targets are filled; `overwrite` also replaces values. */
export function fillFromColumn(rows: readonly PriceRow[], fromKey: string, toKey: string, percent: string, opts: BulkScope & { overwrite?: boolean; rounding?: Rounding } = {}): BulkPreview {
  const factor = D(100).plus(D(percent)).div(100)
  const changes: CellChange[] = []
  let skipped = 0
  for (const r of rows) {
    if (!inScope(r, opts)) continue
    const src = r.cells[fromKey]
    const cur = r.cells[toKey] ?? ''
    if (!hasValue(src) || (cur !== '' && !opts.overwrite)) { skipped++; continue }
    const after = roundTo(D(src).times(factor), opts.rounding ?? 'two')
    if (after !== cur) changes.push({ rowId: r.id, columnKey: toKey, before: cur, after })
  }
  return { changes, skipped }
}

/** Find / replace in text cells of the chosen columns (literal, never a regex). */
export function findReplaceCells(rows: readonly PriceRow[], columns: readonly PriceColumn[], find: string, replace: string, opts: { caseSensitive?: boolean; columnKeys?: ReadonlySet<string>; rowIds?: ReadonlySet<string> } = {}): CellChange[] {
  if (find === '') return []
  const out: CellChange[] = []
  const fl = opts.caseSensitive ? find : find.toLowerCase()
  for (const r of rows) {
    if (opts.rowIds && !opts.rowIds.has(r.id)) continue
    for (const c of columns) {
      if (c.role === 'name' || c.role === 'price' || c.type !== 'text' || (opts.columnKeys && !opts.columnKeys.has(c.key))) continue
      const before = r.cells[c.key] ?? ''
      const after = replaceLiteral(before, fl, find.length, replace, !!opts.caseSensitive)
      if (after !== before) out.push({ rowId: r.id, columnKey: c.key, before, after })
    }
  }
  return out
}
function replaceLiteral(text: string, needleCmp: string, len: number, rep: string, cs: boolean): string {
  const hay = cs ? text : text.toLowerCase()
  if (hay.length !== text.length) return text // case folding changed the length: do not guess
  let out = ''
  let i = 0
  for (;;) {
    const j = hay.indexOf(needleCmp, i)
    if (j < 0) return out + text.slice(i)
    out += text.slice(i, j) + rep
    i = j + len
  }
}

/** Find / replace in item NAMES, run-preserving only for a whole-name result: the replaced text takes the style of the first replaced character's run. */
export function findReplaceNames(rows: readonly PriceRow[], find: string, replace: string, caseSensitive = false): NameChange[] {
  if (find === '') return []
  const out: NameChange[] = []
  for (const r of rows) {
    const before = plain(r.nameRuns)
    const after = replaceLiteral(before, caseSensitive ? find : find.toLowerCase(), find.length, replace, caseSensitive)
    if (after !== before) out.push({ rowId: r.id, before: r.nameRuns, after: fromPlain(after) })
  }
  return out
}

/** Name clean-up: trim, collapse spaces, line breaks -> a space. Keeps the run styles (only whitespace characters change). */
export function cleanNames(rows: readonly PriceRow[]): NameChange[] {
  const out: NameChange[] = []
  for (const r of rows) {
    if (r.kind === 'section') continue
    const before = r.nameRuns
    const after = cleanRuns(before)
    if (!runsEqual(before, after)) out.push({ rowId: r.id, before, after })
  }
  return out
}
function cleanRuns(runs: Runs): Runs {
  const chars: { ch: string; run: number }[] = []
  runs.forEach((run, ri) => { for (const ch of Array.from(run.t)) chars.push({ ch: /[\s\u00A0]/.test(ch) ? ' ' : ch, run: ri }) })
  const kept: { ch: string; run: number }[] = []
  for (const c of chars) { if (c.ch === ' ' && (kept.length === 0 || kept[kept.length - 1]!.ch === ' ')) continue; kept.push(c) }
  while (kept.length > 0 && kept[kept.length - 1]!.ch === ' ') kept.pop()
  const out: Runs = []
  for (const c of kept) {
    const src = runs[c.run]!
    const last = out[out.length - 1]
    if (last && last.b === src.b && last.r === src.r && last.hl === src.hl) last.t += c.ch
    else { const n: Runs[number] = { t: c.ch }; if (src.b) n.b = 1; if (src.r) n.r = 1; if (src.hl) n.hl = 1; out.push(n) }
  }
  return out
}

/** Write cell changes into rows (a new array; untouched rows keep their identity). The name column key is ignored here (use name changes). */
export function applyChanges(rows: readonly PriceRow[], changes: readonly CellChange[]): PriceRow[] {
  const byRow = new Map<string, CellChange[]>()
  for (const c of changes) { if (c.columnKey === NAME_COLUMN_KEY) continue; (byRow.get(c.rowId) ?? byRow.set(c.rowId, []).get(c.rowId)!).push(c) }
  return rows.map((r) => {
    const cs = byRow.get(r.id)
    if (!cs) return r
    const cells = { ...r.cells }
    for (const c of cs) { if (c.after === '') delete cells[c.columnKey]; else cells[c.columnKey] = c.after }
    return { ...r, cells }
  })
}
export function applyNameChanges(rows: readonly PriceRow[], changes: readonly NameChange[]): PriceRow[] {
  const m = new Map(changes.map((c) => [c.rowId, c.after]))
  return rows.map((r) => (m.has(r.id) ? { ...r, nameRuns: m.get(r.id)! } : r))
}
