/**
 * Cell navigation / edit-mode state machine (Phase 10). PURE: no DOM, no Electron, no Node.
 * Spec (binding): docs/reference/KEYBOARD_CELL_RULES.md. The DOM layer (Phase 11) forwards key events to
 * `navReduce`, then applies the returned effects. All offsets are UTF-16 code units (same as DOM selection offsets).
 *
 * Conventions
 *  - `MOVE` ALWAYS means "arrive Append, caret at end of the destination text" (KB §2); the returned state already
 *    reflects that. The DOM must create any `ENSURE_ROW` row BEFORE applying the `MOVE` that follows it.
 *  - `NATIVE` = the reducer has no opinion; let the browser/other phases act (text-level editing, clipboard, undo, ...).
 *  - `IGNORE` = swallow the key (preventDefault) and do nothing.
 *  - In Free mode the real caret lives in the DOM. The reducer tracks it best-effort for edge detection; the DOM layer
 *    must call `syncCaret()` after native edits / mouse / selectionchange so edge detection stays true.
 */

// ---------- tunables (single place; owner may flip) ----------
/** Consecutive Left presses in Append mode that unlock to Free (D-K1). 1 = unlock immediately. */
export const LEFT_UNLOCK_PRESSES = 2
/** D-K3: should Left at the start edge in Free mode jump to the previous cell? */
export const LEFT_EDGE_LEAVES_CELL = false
/** Default PageUp/PageDown distance when the DOM does not supply `pageRows`. */
export const DEFAULT_PAGE_ROWS = 20

export interface NavOptions {
  leftUnlockPresses: number
  leftEdgeLeavesCell: boolean
  /** Phase 74 (KB §11, D-K5..D-K7): Append-mode Left jumps straight to the previous cell (no arming press, D-K1 skipped). Absent = false = today's behaviour. */
  smoothArrows?: boolean
}
export const DEFAULT_NAV_OPTIONS: NavOptions = { leftUnlockPresses: LEFT_UNLOCK_PRESSES, leftEdgeLeavesCell: LEFT_EDGE_LEAVES_CELL }

/**
 * Phase 74: the options for the `nav.smoothArrows` setting. ON: `leftEdgeLeavesCell` is true (Left at the very start of the
 * text leaves the cell; Right at the very end already does) and Append-mode Left jumps cell-to-cell. OFF: exactly `DEFAULT_NAV_OPTIONS`.
 */
export function navOptionsFor(smoothArrows: boolean): NavOptions {
  return smoothArrows ? { leftUnlockPresses: LEFT_UNLOCK_PRESSES, leftEdgeLeavesCell: true, smoothArrows: true } : DEFAULT_NAV_OPTIONS
}

// ---------- types ----------
export type Mode = 'append' | 'free'
export interface CellPos { row: number; col: number }
/** Active cell (state.row/col) is the anchor of a Shift-range; `anchor` differs only after Ctrl+A. */
export interface Range { anchor: CellPos; focus: CellPos }

export interface NavState {
  row: number
  col: number
  mode: Mode
  /** Caret offset inside the active cell's text (UTF-16 units). */
  caret: number
  /** First Left press in Append has been seen (visual hint). */
  leftArmed: boolean
  range: Range | null
  /** Free-mode Ctrl+A already selected all text of the cell; the next Ctrl+A selects all cells. */
  textAllSelected: boolean
}

export interface GridShape {
  rowCount: number
  colCount: number
  cellText(r: number, c: number): string
  cellKind(c: number): 'text' | 'num'
  /** Optional: may column c hold a leading '-'? Default true (Phase 12 narrows: only Total). */
  allowNegative?(c: number): boolean
  /** Phase 104 (D-K10): is column c an EXTRA column? Only there does Down on the bottom-most row add a tail row. Default false. */
  isExtraCol?(c: number): boolean
}

export interface KeyInput {
  /** KeyboardEvent.key */
  key: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  /** Visible rows per page for PageUp/PageDown. */
  pageRows?: number
}

export type NavEffect =
  | { type: 'MOVE'; row: number; col: number }
  | { type: 'SET_MODE'; mode: Mode }
  | { type: 'SET_CARET'; pos: number | 'end' | 'start' }
  | { type: 'SET_ARMED'; armed: boolean }
  | { type: 'INSERT_TEXT'; text: string; at: 'end' }
  | { type: 'CLEAR_CELL' }
  | { type: 'CLEAR_RANGE'; from: CellPos; to: CellPos }
  | { type: 'PAGE_ESCAPE' }
  | { type: 'ENSURE_ROW'; index: number }
  | { type: 'EXTEND_RANGE'; to: CellPos; from?: CellPos }
  | { type: 'COLLAPSE_RANGE' }
  | { type: 'NATIVE' }
  | { type: 'IGNORE' }

export interface NavResult { state: NavState; effects: NavEffect[] }

// ---------- small pure helpers (exported for the DOM layer and tests) ----------
export function createNavState(row = 0, col = 0): NavState {
  return { row, col, mode: 'append', caret: 0, leftArmed: false, range: null, textAllSelected: false }
}

/** Arrival rule (KB §2): Append, caret at end. Use after click on border, programmatic focus, undo/redo, Save/New row. */
export function arriveAt(shape: GridShape, row: number, col: number): NavState {
  const r = clamp(row, 0, Math.max(0, shape.rowCount - 1))
  const c = clamp(col, 0, Math.max(0, shape.colCount - 1))
  return { ...createNavState(r, c), caret: shape.cellText(r, c).length }
}

/** Mouse click inside the text of the active cell → Free at that caret (KB §3). */
export function clickInText(shape: GridShape, row: number, col: number, caret: number): NavState {
  const len = shape.cellText(row, col).length
  return { ...createNavState(row, col), mode: 'free', caret: clamp(caret, 0, len) }
}

/** Reconcile the tracked caret with the real DOM caret (after native edits, selectionchange, mouse). */
export function syncCaret(state: NavState, caret: number): NavState {
  return state.caret === caret ? state : { ...state, caret: Math.max(0, caret) }
}

export function rangeBounds(r: Range): { top: number; left: number; bottom: number; right: number } {
  return {
    top: Math.min(r.anchor.row, r.focus.row), bottom: Math.max(r.anchor.row, r.focus.row),
    left: Math.min(r.anchor.col, r.focus.col), right: Math.max(r.anchor.col, r.focus.col)
  }
}

/**
 * Numeric-cell character predicate (KB §4): digits; one '.'; '-' only as the very first character and only when
 * `allowNegative`. Invalid characters are ignored silently. `caret` is where the character would be inserted.
 */
export function isNumericCharAllowed(ch: string, text: string, caret: number, allowNegative = true): boolean {
  if (ch.length !== 1) return false
  if (ch >= '0' && ch <= '9') return !(text.startsWith('-') && caret <= 0)
  if (ch === '.') return !text.includes('.') && !(text.startsWith('-') && caret <= 0)
  if (ch === '-') return allowNegative && caret <= 0 && !text.startsWith('-')
  return false
}

export function prevWordStart(text: string, caret: number): number {
  let i = Math.min(caret, text.length)
  while (i > 0 && /\s/.test(text[i - 1] as string)) i--
  while (i > 0 && !/\s/.test(text[i - 1] as string)) i--
  return i
}
export function nextWordEnd(text: string, caret: number): number {
  let i = Math.max(0, caret)
  while (i < text.length && /\s/.test(text[i] as string)) i++
  while (i < text.length && !/\s/.test(text[i] as string)) i++
  return i
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n }
const used = (shape: GridShape, r: number, c: number): boolean => shape.cellText(r, c).trim() !== ''

/** Last used cell (Ctrl+End): intersection of the last used row and last used column, Excel style. */
export function lastUsedCell(shape: GridShape): CellPos {
  let row = -1, col = -1
  for (let r = 0; r < shape.rowCount; r++) for (let c = 0; c < shape.colCount; c++) {
    if (used(shape, r, c)) { if (r > row) row = r; if (c > col) col = c }
  }
  return row < 0 ? { row: 0, col: 0 } : { row, col }
}

/** Excel-style data-edge jump along a column (Ctrl+Up / Ctrl+Down). Returns the target row. */
export function dataEdgeRow(shape: GridShape, row: number, col: number, dir: 1 | -1): number {
  const last = shape.rowCount - 1
  const inb = (r: number): boolean => r >= 0 && r <= last
  const next = row + dir
  if (!inb(next)) return row
  if (used(shape, row, col) && used(shape, next, col)) {
    let r = next
    while (inb(r + dir) && used(shape, r + dir, col)) r += dir
    return r
  }
  let r = next
  while (inb(r) && !used(shape, r, col)) r += dir
  return inb(r) ? r : dir === 1 ? last : 0
}

// ---------- internals ----------
const fx = (...e: NavEffect[]): NavEffect[] => e
const ok = (state: NavState, ...effects: NavEffect[]): NavResult => ({ state, effects })

interface Step { row: number; col: number; ensure?: number }
function stepNext(shape: GridShape, row: number, col: number): Step {
  if (col + 1 < shape.colCount) return { row, col: col + 1 }
  if (row + 1 < shape.rowCount) return { row: row + 1, col: 0 }
  return { row: shape.rowCount, col: 0, ensure: shape.rowCount } // Tab past the last row → fresh trailing row
}
function stepPrev(shape: GridShape, row: number, col: number): Step | null {
  if (col > 0) return { row, col: col - 1 }
  if (row > 0) return { row: row - 1, col: shape.colCount - 1 }
  return null
}

/** Phase 119: keys that never mean anything on their own (Ctrl+C etc. arrive as a letter key with the flag set). */
export const MODIFIER_ONLY_KEYS: ReadonlySet<string> = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super', 'Symbol', 'SymbolLock'])

/**
 * The single reducer. Never throws; unknown keys → NATIVE. Any key other than a consecutive Left press in Append
 * disarms the Left-unlock hint (KB §3).
 */
export function navReduce(state: NavState, key: KeyInput, shape: GridShape, opts: NavOptions = DEFAULT_NAV_OPTIONS): NavResult {
  if (shape.rowCount <= 0 || shape.colCount <= 0) return ok(state, { type: 'IGNORE' })
  const k = key.key
  // Phase 119 (D-K12): a modifier / lock key pressed ALONE is inert: no collapse of a range, no mode, caret or focus change.
  if (MODIFIER_ONLY_KEYS.has(k)) return ok(state, { type: 'IGNORE' })
  const ctrl = !!key.ctrl, shift = !!key.shift, alt = !!key.alt, meta = !!key.meta
  const row0 = clamp(state.row, 0, shape.rowCount - 1), col0 = clamp(state.col, 0, shape.colCount - 1)
  const text = shape.cellText(row0, col0)
  const len = text.length
  const isNum = shape.cellKind(col0) === 'num'
  const append = state.mode === 'append'
  const caret = append ? len : clamp(state.caret, 0, len)
  const lastRow = shape.rowCount - 1, lastCol = shape.colCount - 1

  // base state: same cell, disarmed
  let s: NavState = { ...state, row: row0, col: col0, caret, leftArmed: false, textAllSelected: false }
  const isLetterCombo = ctrl && !alt && !meta && k.length === 1

  // range handling: keys that keep a range alive; everything else collapses it first
  const keepsRange =
    (shift && !ctrl && !alt && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) ||
    k === 'Delete' || k === 'Backspace' || k === 'Escape' ||
    (isLetterCombo && !shift && k.toLowerCase() === 'a') ||
    (isLetterCombo && 'cxvzy'.includes(k.toLowerCase()))
  const hadRange = s.range !== null
  if (hadRange && !keepsRange) s = { ...s, range: null }
  const collapseFx: NavEffect[] = hadRange && !keepsRange ? fx({ type: 'COLLAPSE_RANGE' }) : []
  const out = (r: NavResult): NavResult => (collapseFx.length ? { state: r.state, effects: [...collapseFx, ...r.effects] } : r)

  const arrive = (row: number, col: number): NavState => ({
    ...s, row, col, mode: 'append', caret: shape.cellText(row, col).length, leftArmed: false, range: null, textAllSelected: false
  })
  const moveTo = (row: number, col: number): NavResult => {
    if (row === s.row && col === s.col) return ok(s, { type: 'IGNORE' })
    return ok(arrive(row, col), { type: 'MOVE', row, col })
  }
  const goStep = (st: Step | null): NavResult => {
    if (!st) return ok(s, { type: 'IGNORE' })
    const ns = arrive(st.row, st.col)
    ns.caret = st.ensure !== undefined ? 0 : ns.caret
    return ok(ns, ...(st.ensure !== undefined ? fx({ type: 'ENSURE_ROW', index: st.ensure }) : []), { type: 'MOVE', row: st.row, col: st.col })
  }
  const emptyCell = len === 0

  // ---------- printable characters ----------
  if (!ctrl && !alt && !meta && k !== 'Dead' && Array.from(k).length === 1) {
    const at = append ? len : caret
    if (isNum && !isNumericCharAllowed(k, text, at, shape.allowNegative ? shape.allowNegative(col0) : true)) {
      return out(ok(s, { type: 'IGNORE' }))
    }
    if (append) return out(ok({ ...s, caret: len + k.length }, { type: 'INSERT_TEXT', text: k, at: 'end' }))
    return out(ok({ ...s, caret: caret + k.length }, { type: 'NATIVE' }))
  }

  // ---------- Ctrl+A ----------
  if (isLetterCombo && !shift && k.toLowerCase() === 'a') {
    const all = (): NavResult => ok(
      { ...s, range: { anchor: { row: 0, col: 0 }, focus: { row: lastRow, col: lastCol } } },
      { type: 'EXTEND_RANGE', from: { row: 0, col: 0 }, to: { row: lastRow, col: lastCol } })
    if (append || state.textAllSelected || emptyCell || hadRange) return all()
    return ok({ ...s, textAllSelected: true, caret: len }, { type: 'NATIVE' })
  }

  switch (k) {
    // ---------- Left ----------
    case 'ArrowLeft': {
      if (alt) return out(ok(s, { type: 'NATIVE' }))
      if (shift && !ctrl) {
        if (s.range) return extendRange(s, shape, 0, -1)
        if (append && !emptyCell) return ok({ ...s, mode: 'free', caret: Math.max(0, len - 1) }, { type: 'SET_MODE', mode: 'free' }, { type: 'NATIVE' })
        if (caret === 0) return extendRange(s, shape, 0, -1)
        return ok({ ...s, caret: caret - 1 }, { type: 'NATIVE' })
      }
      if (ctrl) { // Ctrl+Left / Ctrl+Shift+Left
        if (append && !emptyCell) {
          const to = shift ? len : prevWordStart(text, len)
          return ok({ ...s, mode: 'free', caret: to }, { type: 'SET_MODE', mode: 'free' }, { type: 'SET_CARET', pos: to }, ...(shift ? fx({ type: 'NATIVE' }) : []))
        }
        if (!append && caret > 0) {
          const to = prevWordStart(text, caret)
          return ok({ ...s, caret: to }, shift ? { type: 'NATIVE' } : { type: 'SET_CARET', pos: to })
        }
        return out(leaveLeft(s, shape, opts, emptyCell, moveTo))
      }
      // plain Left
      if (append) {
        if (emptyCell || opts.smoothArrows === true) return out(leaveLeft(s, shape, opts, true, moveTo)) // smooth ON: no arming press, jump to the neighbour (caret at end)
        if (state.leftArmed || opts.leftUnlockPresses <= 1) {
          return ok({ ...s, mode: 'free', caret: len - 1 }, { type: 'SET_ARMED', armed: false }, { type: 'SET_MODE', mode: 'free' }, { type: 'SET_CARET', pos: len - 1 })
        }
        return ok({ ...s, leftArmed: true }, { type: 'SET_ARMED', armed: true })
      }
      if (caret > 0) return out(ok({ ...s, caret: caret - 1 }, { type: 'SET_CARET', pos: caret - 1 }))
      return out(leaveLeft(s, shape, opts, emptyCell, moveTo))
    }

    // ---------- Right ----------
    case 'ArrowRight': {
      if (alt) return out(ok(s, { type: 'NATIVE' }))
      if (shift && !ctrl) {
        if (s.range) return extendRange(s, shape, 0, 1)
        if (append || caret >= len) return extendRange(s, shape, 0, 1) // at end edge → begin range
        return ok({ ...s, caret: caret + 1 }, { type: 'NATIVE' })
      }
      if (ctrl) {
        if (!append && caret < len) {
          const to = nextWordEnd(text, caret)
          return ok({ ...s, caret: to }, shift ? { type: 'NATIVE' } : { type: 'SET_CARET', pos: to })
        }
        return out(goStep(rightStep(shape, s)))
      }
      if (append || caret >= len) return out(goStep(rightStep(shape, s)))
      return out(ok({ ...s, caret: caret + 1 }, { type: 'SET_CARET', pos: caret + 1 }))
    }

    // ---------- Up / Down ----------
    case 'ArrowUp':
    case 'ArrowDown': {
      const dir = k === 'ArrowDown' ? 1 : -1
      if (alt) return out(ok(s, { type: 'NATIVE' }))
      if (shift && !ctrl) return extendRange(s, shape, dir, 0)
      if (ctrl) return out(moveTo(dataEdgeRow(shape, s.row, s.col, dir), s.col))
      // Phase 104 (D-K10): Down on the bottom-most row of an EXTRA column opens one more (extra-only tail) row and moves into it.
      // Every other column keeps "Down at the last row does nothing". Independent of smooth arrows (ON and OFF behave the same).
      if (dir === 1 && s.row >= lastRow && shape.isExtraCol?.(s.col) === true) {
        const ns = arrive(shape.rowCount, s.col); ns.caret = 0
        return out(ok(ns, { type: 'ENSURE_ROW', index: shape.rowCount }, { type: 'MOVE', row: shape.rowCount, col: s.col }))
      }
      return out(moveTo(clamp(s.row + dir, 0, lastRow), s.col))
    }

    // ---------- Tab / Enter ----------
    case 'Tab': {
      if (ctrl || alt) return out(ok(s, { type: 'NATIVE' }))
      return out(shift ? goStep(stepPrev(shape, s.row, s.col)) : goStep(stepNext(shape, s.row, s.col)))
    }
    case 'Enter': {
      if (ctrl || alt) return out(ok(s, { type: 'NATIVE' }))
      if (shift) return out(moveTo(Math.max(0, s.row - 1), s.col))
      if (s.row >= lastRow) { // Enter on the last row opens a fresh row so entry never stalls
        const ns = arrive(shape.rowCount, s.col); ns.caret = 0
        return out(ok(ns, { type: 'ENSURE_ROW', index: shape.rowCount }, { type: 'MOVE', row: shape.rowCount, col: s.col }))
      }
      return out(moveTo(s.row + 1, s.col))
    }

    // ---------- Home / End / pages ----------
    case 'Home': {
      if (alt) return out(ok(s, { type: 'NATIVE' }))
      if (ctrl && !shift) return out(moveTo(0, 0))
      if (append) return ok({ ...s, mode: 'free', caret: 0 }, { type: 'SET_MODE', mode: 'free' }, { type: 'SET_CARET', pos: 'start' }, ...(shift ? fx({ type: 'NATIVE' }) : []))
      return ok({ ...s, caret: 0 }, shift ? { type: 'NATIVE' } : { type: 'SET_CARET', pos: 'start' })
    }
    case 'End': {
      if (alt) return out(ok(s, { type: 'NATIVE' }))
      if (ctrl && !shift) { const l = lastUsedCell(shape); return out(moveTo(l.row, l.col)) }
      if (append) return ok(s, { type: 'IGNORE' }) // already at the end
      return ok({ ...s, caret: len }, shift ? { type: 'NATIVE' } : { type: 'SET_CARET', pos: 'end' })
    }
    case 'PageUp':
    case 'PageDown': {
      if (ctrl || alt || shift) return out(ok(s, { type: 'NATIVE' }))
      const n = Math.max(1, key.pageRows ?? DEFAULT_PAGE_ROWS)
      return out(moveTo(clamp(s.row + (k === 'PageDown' ? n : -n), 0, lastRow), s.col))
    }

    // ---------- F2 / Esc ----------
    case 'F2': {
      if (!append) return out(ok(s, { type: 'IGNORE' }))
      return out(ok({ ...s, mode: 'free', caret: len }, { type: 'SET_MODE', mode: 'free' }, { type: 'SET_CARET', pos: 'end' }))
    }
    case 'Escape': {
      if (s.range) return ok({ ...s, range: null, mode: 'append', caret: len }, { type: 'COLLAPSE_RANGE' }, { type: 'SET_MODE', mode: 'append' }, { type: 'SET_CARET', pos: 'end' })
      if (!append) return ok({ ...s, mode: 'append', caret: len }, { type: 'SET_MODE', mode: 'append' }, { type: 'SET_CARET', pos: 'end' }) // D-K2: content kept
      return ok(s, { type: 'PAGE_ESCAPE' })
    }

    // ---------- Delete / Backspace ----------
    case 'Delete':
    case 'Backspace': {
      if (s.range) {
        const b = rangeBounds(s.range)
        return ok({ ...s, range: null, mode: 'append', caret: 0 }, { type: 'CLEAR_RANGE', from: { row: b.top, col: b.left }, to: { row: b.bottom, col: b.right } }, { type: 'SET_MODE', mode: 'append' })
      }
      if (ctrl || alt) return ok(s, { type: 'NATIVE' })
      if (k === 'Delete') {
        if (append) return ok({ ...s, caret: 0 }, { type: 'CLEAR_CELL' }) // D-K4
        return ok(s, { type: 'NATIVE' })
      }
      return ok({ ...s, caret: Math.max(0, caret - 1) }, { type: 'NATIVE' })
    }

    default:
      return out(ok(s, { type: 'NATIVE' })) // Ctrl+B/Z/C/V, function keys, IME, … belong to later phases
  }
}

// Right step: next cell, wrapping like Tab (creates the trailing row at the very end).
function rightStep(shape: GridShape, s: NavState): Step | null { return stepNext(shape, s.row, s.col) }

// Left that leaves the cell: allowed on empty cells always, otherwise only if D-K3 flipped.
function leaveLeft(s: NavState, shape: GridShape, opts: NavOptions, empty: boolean, moveTo: (r: number, c: number) => NavResult): NavResult {
  if (!empty && !opts.leftEdgeLeavesCell) return ok(s, { type: 'IGNORE' })
  const p = stepPrev(shape, s.row, s.col)
  return p ? moveTo(p.row, p.col) : ok(s, { type: 'IGNORE' })
}

// Begin/extend a Shift range by (dr, dc) from the current focus; shrinking back to the anchor ends the range.
function extendRange(s: NavState, shape: GridShape, dr: number, dc: number): NavResult {
  const base = s.range ?? { anchor: { row: s.row, col: s.col }, focus: { row: s.row, col: s.col } }
  const focus = { row: clamp(base.focus.row + dr, 0, shape.rowCount - 1), col: clamp(base.focus.col + dc, 0, shape.colCount - 1) }
  if (focus.row === base.focus.row && focus.col === base.focus.col) return ok({ ...s, range: s.range }, { type: 'IGNORE' })
  const collapsed = focus.row === base.anchor.row && focus.col === base.anchor.col && base.anchor.row === s.row && base.anchor.col === s.col
  if (collapsed) return ok({ ...s, range: null, mode: 'append', caret: shape.cellText(s.row, s.col).length }, { type: 'COLLAPSE_RANGE' })
  return ok({ ...s, range: { anchor: base.anchor, focus } }, { type: 'EXTEND_RANGE', to: focus })
}
