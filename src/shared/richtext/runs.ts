/**
 * Rich-text runs engine (Phase 14). Pure: no DOM, no Electron, no Node.
 *
 * A name cell is `Run[]`: `{ t, b?:1, r?:1, hl?:1 }` (bold / red / highlight). Every function here takes runs in and
 * returns NEW normalised runs (inputs are never mutated). Offsets are UTF-16 code units into `plain(runs)`; they are
 * clamped, and snapped to surrogate-pair boundaries so an emoji is never split. Formatting with a collapsed range
 * (caret, no selection) applies to the WHOLE cell (KEYBOARD_CELL_RULES §4).
 */
import type { Run, Runs } from '../types'

export type RunFlag = 'b' | 'r' | 'hl'
export const RUN_FLAGS: readonly RunFlag[] = ['b', 'r', 'hl']
export type RunStyle = Partial<Record<RunFlag, 1 | boolean>>
export type RangeState = 'all' | 'none' | 'mixed' | 'empty'

const B = 1, R = 2, H = 4
const FLAG_MASK: Record<RunFlag, number> = { b: B, r: R, hl: H }

// ---------- basics ----------
export function plain(runs: Runs): string {
  let s = ''
  for (const r of runs) s += r.t
  return s
}
export function length(runs: Runs): number {
  let n = 0
  for (const r of runs) n += r.t.length
  return n
}
export function fromPlain(text: string): Runs {
  return text === '' ? [] : [{ t: text }]
}

function maskOf(r: Run): number { return (r.b ? B : 0) | (r.r ? R : 0) | (r.hl ? H : 0) }
function maskOfStyle(s: RunStyle): number { return (s.b ? B : 0) | (s.r ? R : 0) | (s.hl ? H : 0) }
function mk(t: string, mask: number): Run {
  const r: Run = { t }
  if (mask & B) r.b = 1
  if (mask & R) r.r = 1
  if (mask & H) r.hl = 1
  return r
}

/** Drop empty runs, canonicalise flags (`1` or absent), merge adjacent runs with the same style. Idempotent. */
export function normalize(runs: Runs): Runs {
  const out: Run[] = []
  let lastMask = -1
  for (const r of runs) {
    if (r.t === '') continue
    const m = maskOf(r)
    const last = out[out.length - 1]
    if (last && m === lastMask) last.t += r.t
    else { out.push(mk(r.t, m)); lastMask = m }
  }
  return out
}
/** Already in normal form: no empty runs, flags are `1` or absent, no two adjacent runs share a style. */
export function isCanonical(runs: Runs): boolean {
  let prev = -1
  for (const r of runs) {
    if (r.t === '') return false
    if ((r.b !== undefined && r.b !== 1) || (r.r !== undefined && r.r !== 1) || (r.hl !== undefined && r.hl !== 1)) return false
    const m = maskOf(r)
    if (m === prev) return false
    prev = m
  }
  return true
}
/** Same text and styling (compared after normalising both). */
export function runsEqual(a: Runs, b: Runs): boolean {
  const x = normalize(a), y = normalize(b)
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) {
    const p = x[i] as Run, q = y[i] as Run
    if (p.t !== q.t || maskOf(p) !== maskOf(q)) return false
  }
  return true
}

// ---------- offsets ----------
const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff
/** Is `off` strictly inside a surrogate pair of `text`? */
function insidePair(text: string, off: number): boolean {
  return off > 0 && off < text.length && isHigh(text.charCodeAt(off - 1)) && isLow(text.charCodeAt(off))
}
/** Clamp to [0, len], swap if reversed, widen to whole surrogate pairs. */
export function resolveRange(runs: Runs, start: number, end: number = start): { start: number; end: number } {
  const text = plain(runs)
  const n = text.length
  let s = Number.isFinite(start) ? Math.trunc(start) : 0
  let e = Number.isFinite(end) ? Math.trunc(end) : s
  if (s > e) [s, e] = [e, s]
  s = Math.min(Math.max(s, 0), n)
  e = Math.min(Math.max(e, 0), n)
  if (s === e) { if (insidePair(text, s)) s--; e = s } // a caret inside a pair moves to its start
  else {
    if (insidePair(text, s)) s--
    if (insidePair(text, e)) e++
  }
  return { start: s, end: e }
}

// ---------- slicing ----------
/** Runs for `[start, end)` (offsets resolved as above). */
export function sliceRuns(runs: Runs, start: number, end: number): Runs {
  const { start: s, end: e } = resolveRange(runs, start, end)
  return cut(runs, s, e)
}
function cut(runs: Runs, s: number, e: number): Runs {
  const out: Run[] = []
  let pos = 0
  for (const r of runs) {
    const a = pos, b = pos + r.t.length
    pos = b
    const lo = Math.max(a, s), hi = Math.min(b, e)
    if (lo < hi) out.push(mk(r.t.slice(lo - a, hi - a), maskOf(r)))
  }
  return normalize(out)
}
export function concatRuns(...parts: Runs[]): Runs {
  const all: Run[] = []
  for (const p of parts) all.push(...p)
  return normalize(all)
}

/** Style of the character at `index` (code-unit index); `{}` when out of range. */
export function styleAt(runs: Runs, index: number): { b?: 1; r?: 1; hl?: 1 } {
  let pos = 0
  for (const r of runs) {
    if (index >= pos && index < pos + r.t.length) return styleOfMask(maskOf(r))
    pos += r.t.length
  }
  return {}
}
function styleOfMask(m: number): { b?: 1; r?: 1; hl?: 1 } {
  const o: { b?: 1; r?: 1; hl?: 1 } = {}
  if (m & B) o.b = 1
  if (m & R) o.r = 1
  if (m & H) o.hl = 1
  return o
}
function maskAt(runs: Runs, index: number): number {
  let pos = 0
  for (const r of runs) {
    if (index >= pos && index < pos + r.t.length) return maskOf(r)
    pos += r.t.length
  }
  return 0
}

// ---------- formatting ----------
/** Is `flag` set on all / none / some of `[start, end)`? A collapsed range means the whole cell. */
export function rangeState(runs: Runs, start: number, end: number, flag: RunFlag): RangeState {
  return stateFor(runs, formatRange(runs, start, end), FLAG_MASK[flag])
}
function formatRange(runs: Runs, start: number, end: number): { start: number; end: number } {
  const r = resolveRange(runs, start, end)
  return r.start === r.end ? { start: 0, end: length(runs) } : r
}
function stateFor(runs: Runs, range: { start: number; end: number }, mask: number): RangeState {
  if (range.start >= range.end) return 'empty'
  let any = false, all = true, pos = 0
  for (const r of runs) {
    const a = pos, b = pos + r.t.length
    pos = b
    if (Math.min(b, range.end) <= Math.max(a, range.start)) continue
    if ((maskOf(r) & mask) === mask) any = true
    else if ((maskOf(r) & mask) === 0) all = false
    else { any = true; all = false }
  }
  if (all && any) return 'all'
  if (!any) return 'none'
  return 'mixed'
}
/** Apply `fn(mask) => mask` to every run piece inside `[s, e)`, leaving the rest alone. */
function mapRange(runs: Runs, s: number, e: number, fn: (m: number) => number): Runs {
  const out: Run[] = []
  let pos = 0
  for (const r of runs) {
    const a = pos, b = pos + r.t.length
    pos = b
    const lo = Math.max(a, s), hi = Math.min(b, e)
    if (lo >= hi) { out.push(r); continue }
    const m = maskOf(r)
    if (a < lo) out.push(mk(r.t.slice(0, lo - a), m))
    out.push(mk(r.t.slice(lo - a, hi - a), fn(m)))
    if (hi < b) out.push(mk(r.t.slice(hi - a), m))
  }
  return normalize(out)
}
/** Toggle one or more flags: remove them if the range already has them ALL, otherwise add them (Excel rule: mixed → on). */
function toggleMask(runs: Runs, start: number, end: number, mask: number): Runs {
  const range = formatRange(runs, start, end)
  if (range.start >= range.end) return normalize(runs)
  const off = stateFor(runs, range, mask) === 'all'
  return mapRange(runs, range.start, range.end, (m) => (off ? m & ~mask : m | mask))
}
export function toggleBold(runs: Runs, start: number, end: number = start): Runs { return toggleMask(runs, start, end, B) }
export function toggleRed(runs: Runs, start: number, end: number = start): Runs { return toggleMask(runs, start, end, R) }
export function toggleHighlight(runs: Runs, start: number, end: number = start): Runs { return toggleMask(runs, start, end, H) }
/** Red + Bold in ONE press. All red+bold already → clears both; otherwise sets both. */
export function setRedBold(runs: Runs, start: number, end: number = start): Runs { return toggleMask(runs, start, end, R | B) }
export function clearFormat(runs: Runs, start: number, end: number = start): Runs {
  const range = formatRange(runs, start, end)
  if (range.start >= range.end) return normalize(runs)
  return mapRange(runs, range.start, range.end, () => 0)
}

// ---------- editing ----------
export interface RunEdit {
  start: number
  /** Omit (or equal `start`) for a pure insert. */
  end?: number
  /** Omit or '' for a pure delete. */
  text?: string
  /** Overrides the inherited style of the inserted text (Phase 15 pending-style typing). */
  style?: RunStyle
}
/**
 * Replace `[start, end)` with `text`. Inserted text takes the style of the first replaced character; for a pure
 * insert, the character to the LEFT of the caret, or (caret at 0) the character to the right. `style` overrides.
 * Offsets are clamped and snapped off surrogate pairs. Returns normalised runs.
 */
export function applyEdit(runs: Runs, edit: RunEdit): Runs {
  const text = edit.text ?? ''
  const { start: s, end: e } = resolveRange(runs, edit.start, edit.end ?? edit.start)
  if (s === e && text === '') return normalize(runs)
  const n = length(runs)
  let mask: number
  if (edit.style) mask = maskOfStyle(edit.style)
  else if (s < e) mask = maskAt(runs, s)
  else if (s > 0) mask = maskAt(runs, s - 1)
  else mask = n > 0 ? maskAt(runs, 0) : 0
  return concatRuns(cut(runs, 0, s), text === '' ? [] : [mk(text, mask)], cut(runs, e, n))
}

/**
 * The new plain text is all we know (e.g. a committed contenteditable): find the changed span by common prefix/suffix
 * (never splitting a surrogate pair) and apply it as one edit, so untouched text keeps its styling.
 */
export function applyTextChange(runs: Runs, newText: string): Runs {
  const old = plain(runs)
  if (old === newText) return normalize(runs)
  if (newText === '') return []
  const max = Math.min(old.length, newText.length)
  let p = 0
  while (p < max && old.charCodeAt(p) === newText.charCodeAt(p)) p++
  if (insidePair(old, p) || insidePair(newText, p)) p--
  let q = 0
  while (q < max - p && old.charCodeAt(old.length - 1 - q) === newText.charCodeAt(newText.length - 1 - q)) q++
  if (insidePair(old, old.length - q) || insidePair(newText, newText.length - q)) q--
  return applyEdit(runs, { start: p, end: old.length - q, text: newText.slice(p, newText.length - q) })
}
