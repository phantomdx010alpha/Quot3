import { type MoveTarget } from '@shared/rows/moveRows'
import { flushSync } from 'react-dom'
import { MODIFIER_ONLY_KEYS, arriveAt, clickInText, createNavState, navOptionsFor, navReduce, rangeBounds, syncCaret, type GridShape, type NavEffect, type NavState } from '@shared/nav/cellNav'
import { allowsNegative, cellRawText, isNumericColumn, isTypable, isValidNumericDraft, sanitizeNumericPaste } from '@shared/gridEdit'
import { buildGridColumns, type GridColumn } from '@shared/gridModel'
import { displayedTailCount, freeNavIds, getFreeCell, isFreeRowId, parseFreeRowId } from '@shared/freeCells'
import { resolveFormat } from '@shared/format/registry'
import { useBillStore } from '../../stores/billStore'
import { useBehaviourStore } from '../../stores/behaviourStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { applyFormat, type FormatKind } from '@shared/richtext/format'
import { applyTextChange } from '@shared/richtext/runs'
import { parseTsv, formatTsv, looksLikeTsv } from '@shared/tsv/tsvCodec'
import { QUOT3_GRID_MIME, describePaste, parseQuot3Payload, planPaste, repeatCell, serializeQuot3Payload, type GridClipCell, type PasteCol } from '@shared/tsv/gridClip'
import { hasStyle } from '@shared/richtext/format'
import { historyHooks, runAsOneEntry } from '../../stores/historyHooks'
import type { HistSel } from '@shared/history/undoStack'
import { undoNotice } from '@shared/history/historyView'
import { appendText, caretOffset, insertTextAtSelection, renderRuns, selectionOffsets, setCaret, setSelectionRange, textOf } from './gridDom'

/** Phase 119: how long the native copy / cut / paste event gets to arrive before the bridge fallback runs. */
export const CLIPBOARD_FALLBACK_MS = 60

/**
 * Phase 11 — the single event pipeline of the grid. One listener per event type on the grid root forwards to the pure
 * `navReduce` (src/shared/nav/cellNav.ts, spec KEYBOARD_CELL_RULES.md) and applies the returned effects to the DOM.
 *
 * Ownership: while a cell is active+typable its text span is contenteditable and the DOM owns the draft text; the
 * draft is committed to the bill store when the cell is left (move, blur, Delete). Navigable columns are the
 * registry-`editable` ones + extras (Sl.No, GST Amt, Amount are skipped); Total is navigable but read-only until
 * Phase 13. Nothing here touches layout per keystroke beyond the one active span.
 */
export class GridController {
  private nav: NavState = createNavState()
  private active: { rowId: string; colKey: string } | null = null
  private pendingClick = false
  private rangeMarked: HTMLElement[] = []
  /** Phase 16: mouse-drag range — the cell the button went down on, and whether the pointer has left it. */
  private dragFrom: { row: number; col: number } | null = null
  private dragged = false
  private detach: (() => void) | null = null
  pageRows = 20

  /** Phase 119: set by the native clipboard events; the Ctrl+C/X/V fallback timer checks it. */
  private clipSeen = false
  private clipTimer: ReturnType<typeof setTimeout> | null = null
  /** Phase 122: the current range was made by selecting whole rows (Shift+Space / Sl.No click); only then does Delete remove rows. */
  private rowSel = false
  private lastCopy: { tsv: string; matrix: GridClipCell[][] } | null = null

  constructor(private root: HTMLElement) {}

  // ---------- wiring ----------
  attach(): () => void {
    const r = this.root
    // Phase 21: the header rename input lives inside the grid root; its keys, typing and clipboard stay native.
    const hdr = (e: Event): boolean => !!(e.target as HTMLElement | null)?.closest?.('.q3-gh__input')
    const kd = (e: Event): void => { if (!hdr(e)) this.onKeyDown(e as KeyboardEvent) }
    const bi = (e: Event): void => { if (!hdr(e)) this.onBeforeInput(e as InputEvent) }
    const md = (e: Event): void => { if (!hdr(e)) this.onMouseDown(e as MouseEvent) }
    const mu = (): void => this.onMouseUp()
    const dc = (): void => this.onDoubleClick()
    const fi = (e: Event): void => this.onFocusIn(e as FocusEvent)
    const fo = (e: Event): void => this.onFocusOut(e as FocusEvent)
    r.addEventListener('keydown', kd)
    r.addEventListener('beforeinput', bi)
    r.addEventListener('mousedown', md)
    r.addEventListener('mouseup', mu)
    r.addEventListener('dblclick', dc)
    r.addEventListener('focusin', fi)
    r.addEventListener('focusout', fo)
    const cp = (e: Event): void => { if (!hdr(e)) this.onCopy(e as ClipboardEvent, false) }
    const ct = (e: Event): void => { if (!hdr(e)) this.onCopy(e as ClipboardEvent, true) }
    const ps = (e: Event): void => { if (!hdr(e)) this.onPaste(e as ClipboardEvent) }
    const mm = (e: Event): void => this.onMouseMove(e as MouseEvent)
    r.addEventListener('copy', cp); r.addEventListener('cut', ct); r.addEventListener('paste', ps); r.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    const resetFn = (): void => this.resetActiveTotal()
    const formatFn = (kind: FormatKind, sel?: { start: number; end: number }): boolean => this.formatActive(kind, sel)
    const openFn = (): void => this.openFormatPalette()
    const refocusFn = (): void => this.refocus()
    const copyFn = (): void => { this.refocus(); document.execCommand?.('copy') }
    const cutFn = (): void => { this.refocus(); document.execCommand?.('cut') }
    const pasteFn = (): void => { void this.pasteFromBridge() }
    useGridUiStore.setState({ resetTotal: resetFn, format: formatFn, openFormatPalette: openFn, refocus: refocusFn, copy: copyFn, cut: cutFn, paste: pasteFn, selectRow: () => this.selectActiveRow(), deleteRows: () => { this.deleteSelectedRows() }, moveRow: (t) => { this.moveActiveRow(t) } })
    // Phase 17: the history reads/restores the selection and commits an uncommitted draft through this port.
    const port = { get: () => this.histSel(), restore: (sel: HistSel | null) => this.restoreSel(sel), flush: () => this.commit() }
    historyHooks.selection = port
    this.detach = () => {
      if (historyHooks.selection === port) historyHooks.selection = null
      if (this.clipTimer !== null) { clearTimeout(this.clipTimer); this.clipTimer = null }
      if (useGridUiStore.getState().resetTotal === resetFn) useGridUiStore.setState({ resetTotal: null, format: null, openFormatPalette: null, refocus: null, formatPalette: null, copy: null, cut: null, paste: null, selectRow: null, deleteRows: null, moveRow: null, notice: '' })
      r.removeEventListener('keydown', kd); r.removeEventListener('beforeinput', bi); r.removeEventListener('mousedown', md)
      r.removeEventListener('copy', cp); r.removeEventListener('cut', ct); r.removeEventListener('paste', ps); r.removeEventListener('mousemove', mm)
      window.removeEventListener('mouseup', mu)
      r.removeEventListener('mouseup', mu); r.removeEventListener('dblclick', dc); r.removeEventListener('focusin', fi); r.removeEventListener('focusout', fo)
      useGridUiStore.getState().set('idle', false)
    }
    return () => { this.leave(); this.detach?.() }
  }

  // ---------- Phase 80: free cells (total rows + tail rows) ----------
  /**
   * Keyboard-navigation row ids in display order. With no extra columns this is the store's `view.navIds` (body + adjustments);
   * with extra columns it also holds the editable total rows (`fx:`) and the tail rows (`tr:`). Memoised on its inputs.
   */
  private navMemo: { v: unknown; f: unknown; e: unknown; t: unknown; s: number; ids: string[] } | null = null
  private navIds(): string[] {
    const st = useBillStore.getState()
    if (st.extraCols.length === 0) return st.view.navIds
    const shown = useGridUiStore.getState().tailShown
    const m = this.navMemo
    if (m && m.v === st.view.navIds && m.f === st.view.footer && m.e === st.extraCols && m.t === st.tailRows && m.s === shown) return m.ids
    const ids = freeNavIds(st.view.bodyIds, st.view.footer, st.extraCols.length, displayedTailCount(st.tailRows, shown))
    this.navMemo = { v: st.view.navIds, f: st.view.footer, e: st.extraCols, t: st.tailRows, s: shown, ids }
    return ids
  }
  /** Keep every tail row that is on screen on screen while a store write may trim stored (empty) trailing ones - the active cell must not vanish under the caret. */
  private freezeTail(): void {
    const ui = useGridUiStore.getState()
    ui.setTailShown(displayedTailCount(useBillStore.getState().tailRows, ui.tailShown))
  }
  /** A free row's non-extra cells (labels, amounts) are navigable but never typable. */
  private typableAt(rowId: string, col: Pick<GridColumn, 'editable' | 'key' | 'isExtra'>): boolean {
    return isTypable(col) && (!isFreeRowId(rowId) || col.isExtra)
  }
  /** Text of a cell on a free row: its stored extra cell, or (read-only cells) the footer display text - for those the edit text IS the display text. */
  private freeText(rowId: string, colKey: string): string {
    const st = useBillStore.getState()
    if (st.extraCols.some((c) => c.key === colKey)) return getFreeCell(st.footerExtras, st.tailRows, rowId, colKey)?.text ?? ''
    const ref = parseFreeRowId(rowId)
    if (ref?.kind !== 'footer') return ''
    return st.view.footer.find((d) => d.kind === ref.key)?.cells[colKey] ?? ''
  }

  // ---------- model access ----------
  /** Phase 24: memoised on (formatId, extraCols) identity — it was rebuilt several times per keystroke. Treat the result as read-only. */
  private colsMemo: { f: string; e: unknown; cols: GridColumn[] } | null = null
  private navCols(): GridColumn[] {
    const s = useBillStore.getState()
    const m = this.colsMemo
    if (m && m.f === s.formatId && m.e === s.extraCols) return m.cols
    const cols = buildGridColumns(resolveFormat(s.formatId), s.extraCols).filter((c) => c.editable)
    this.colsMemo = { f: s.formatId, e: s.extraCols, cols }
    return cols
  }

  /**
   * Phase 24: the attribute-selector scan was the dominant cost of every key (several lookups per keystroke, each a linear
   * walk of rows × cells). Cache the span per (row, col); a hit is trusted only while it is still connected AND still
   * sits under the same row id and column key (rows/cells are React-keyed, so a surviving node keeps its identity).
   */
  private cellCache = new Map<string, HTMLElement>()
  private cellEl(rowId: string, colKey: string): HTMLElement | null {
    const k = `${rowId}\u0000${colKey}`
    const hit = this.cellCache.get(k)
    if (hit && hit.isConnected && hit.closest('[data-row-id]')?.getAttribute('data-row-id') === rowId && hit.closest('[data-col]')?.getAttribute('data-col') === colKey) return hit
    const el = this.root.querySelector<HTMLElement>(`[data-row-id="${rowId}"] [data-col="${colKey}"] .q3-gc__text`)
    if (el) {
      if (this.cellCache.size > 4000) this.cellCache.clear()
      this.cellCache.set(k, el)
    } else this.cellCache.delete(k)
    return el
  }
  private cellDiv(el: HTMLElement): HTMLElement | null { return el.closest<HTMLElement>('.q3-gc') }
  /** Phase 78: the row element of a cell (`data-active-row` is set / cleared on it directly, never through React). */
  private rowDiv(el: HTMLElement): HTMLElement | null { return el.closest<HTMLElement>('.q3-gr') }
  private activeEl(): HTMLElement | null { return this.active ? this.cellEl(this.active.rowId, this.active.colKey) : null }

  /** Snapshot of the grid as the reducer sees it. The active cell reports its LIVE (uncommitted) DOM text. */
  private shape(cols: GridColumn[]): GridShape {
    const st = useBillStore.getState()
    const ids = this.navIds()
    if (this.byIdMemo?.rows !== st.rows) this.byIdMemo = { rows: st.rows, map: new Map(st.rows.map((r) => [r.id, r])) } // Phase 24: rebuilt only when the rows array changes
    const byId = this.byIdMemo.map
    const act = this.active
    const live = this.activeEl()
    return {
      rowCount: ids.length,
      colCount: cols.length,
      cellText: (r, c) => {
        const rowId = ids[r]; const col = cols[c]
        if (rowId === undefined || !col) return ''
        if (act && live && act.rowId === rowId && act.colKey === col.key) return textOf(live)
        if (isFreeRowId(rowId)) return this.freeText(rowId, col.key)
        const row = byId.get(rowId)
        return row ? cellRawText(row, col.key, st.view.body[rowId]?.cells[col.key] ?? '') : ''
      },
      cellKind: (c) => { const col = cols[c]; return col && isNumericColumn(col) ? 'num' : 'text' },
      allowNegative: (c) => { const col = cols[c]; return col ? allowsNegative(col.key) : false },
      isExtraCol: (c) => cols[c]?.isExtra === true
    }
  }

  private byIdMemo: { rows: unknown; map: Map<string, import('@shared/types').BillRow> } | null = null
  private colOf(colKey: string): GridColumn | undefined { return this.navCols().find((c) => c.key === colKey) }

  // ---------- activation / commit ----------
  /** Write the active cell's draft into the store (no DOM rewrite). */
  private commit(): void {
    const el = this.activeEl()
    if (!this.active || !el || el.dataset.editing !== '1') return
    const id = this.active.rowId
    if (isFreeRowId(id)) { this.freezeTail(); useBillStore.getState().setFreeCells([{ rowId: id, colKey: this.active.colKey, text: textOf(el) }]); return }
    const was = useBillStore.getState().view.adjIds.includes(id)
    useBillStore.getState().setCellText(id, this.active.colKey, textOf(el))
    // Phase 19: the row just moved between body and adjustment block — let React move its DOM now, so the next cell lookup is not stale.
    if (useBillStore.getState().view.adjIds.includes(id) !== was) flushSync(() => { /* render */ })
  }

  /**
   * Phase 19: commit the active cell's draft and, if that moved its row between the body and the adjustment block
   * (name + total only ⇒ adjustment; a qty/rate added back ⇒ item), re-activate the SAME cell at its new place
   * (Append, caret at end) — the active cell follows the row. Used by commits that do not leave the cell.
   */
  private commitFollow(): void {
    const a = this.active
    const el = this.activeEl()
    if (!a || !el || el.dataset.editing !== '1') return
    const st = useBillStore.getState()
    if (isFreeRowId(a.rowId)) { this.freezeTail(); st.setFreeCells([{ rowId: a.rowId, colKey: a.colKey, text: textOf(el) }]); return }
    const before = st.view.adjIds.includes(a.rowId)
    st.setCellText(a.rowId, a.colKey, textOf(el))
    if (useBillStore.getState().view.adjIds.includes(a.rowId) === before) return
    flushSync(() => { /* let React move the row's DOM */ })
    const fresh = this.activeEl()
    if (!fresh || fresh === el) return
    this.active = null
    const next = this.prepare(a.rowId, a.colKey)
    if (next) {
      setCaret(next, 'end')
      const at = this.locate(this.navCols())
      if (at) this.nav = { ...this.nav, row: at.row, col: at.col, caret: textOf(next).length }
    }
    this.syncUi()
  }

  /** Commit and restore the display text; the cell stops being editable. */
  private leave(commit = true): void {
    const el = this.activeEl()
    if (el && this.active) {
      if (commit) this.commit()
      delete el.dataset.editing
      el.removeAttribute('contenteditable')
      this.paint(el, this.active.rowId, this.active.colKey)
      el.scrollLeft = 0
      this.cellDiv(el)?.removeAttribute('data-active')
      this.rowDiv(el)?.removeAttribute('data-active-row')
    }
    this.active = null
  }

  /** Display text of a cell (item names keep their styled runs). */
  private paint(el: HTMLElement, rowId: string, colKey: string): void {
    const st = useBillStore.getState()
    if (isFreeRowId(rowId)) { el.textContent = this.freeText(rowId, colKey); return }
    const row = colKey === 'name' ? st.rows.find((r) => r.id === rowId) : undefined
    if (row) renderRuns(el, row.nameRuns)
    else el.textContent = st.view.body[rowId]?.cells[colKey] ?? ''
  }
  private paintRaw(el: HTMLElement, row: { nameRuns: import('@shared/types').Runs } | undefined, colKey: string, raw: string): void {
    if (colKey === 'name' && row) renderRuns(el, row.nameRuns)
    else el.textContent = raw
  }

  // ---------- Phase 15: rich-text formatting of the active item-name cell ----------
  /**
   * Format the active name cell. `sel` (palette/toolbar) overrides the live selection. The cell's uncommitted typed text is
   * diffed into the runs first (so nothing typed is lost), the result is committed to the store at once and the cell is
   * repainted with styled spans; the caret/selection is restored by offset. No selection = whole cell (KB §4).
   */
  formatActive(kind: FormatKind, sel?: { start: number; end: number }): boolean {
    const a = this.active
    const el = this.activeEl()
    if (!a || !el || a.colKey !== 'name') return false
    const st = useBillStore.getState()
    const row = st.rows.find((r) => r.id === a.rowId)
    if (!row) return false
    const editing = el.dataset.editing === '1'
    const typed = editing ? applyTextChange(row.nameRuns, textOf(el)) : row.nameRuns
    const range = sel ?? (editing ? selectionOffsets(el) : { start: 0, end: 0 })
    const next = applyFormat(typed, kind, range.start, range.end)
    st.setNameRuns(a.rowId, next)
    if (editing) {
      el.focus({ preventScroll: true }) // focus first: a focus change may reset the selection, so set it last
      renderRuns(el, next)
      setSelectionRange(el, range.start, range.end)
      this.nav = { ...this.nav, caret: range.end }
    }
    return true
  }

  openFormatPalette(): void {
    const el = this.activeEl()
    if (!el || !this.active || this.active.colKey !== 'name') return
    const sel = el.dataset.editing === '1' ? selectionOffsets(el) : { start: 0, end: 0 }
    const r = el.getBoundingClientRect()
    useGridUiStore.getState().setFormatPalette({ x: r.left, y: r.bottom + 2, start: sel.start, end: sel.end })
  }

  /** Focus the active cell again (after the palette/toolbar), keeping its mode; selection comes from `sel`. */
  refocus(sel?: { start: number; end: number }): void {
    const el = this.activeEl()
    if (!el) return
    el.focus({ preventScroll: true })
    if (sel) setSelectionRange(el, sel.start, sel.end)
  }

  /** Make (rowId, colKey) the active cell: raw text in, contenteditable on (if typable), focus. Caret is the caller's job. */
  private prepare(rowId: string, colKey: string): HTMLElement | null {
    if (this.active && this.active.rowId === rowId && this.active.colKey === colKey) return this.activeEl()
    this.leave()
    const el = this.cellEl(rowId, colKey)
    const col = this.colOf(colKey)
    if (!el || !col) return null
    const st = useBillStore.getState()
    const row = st.rows.find((r) => r.id === rowId)
    const raw = row ? cellRawText(row, colKey, st.view.body[rowId]?.cells[colKey] ?? '') : isFreeRowId(rowId) ? this.freeText(rowId, colKey) : textOf(el)
    this.active = { rowId, colKey }
    if (this.typableAt(rowId, col)) {
      el.dataset.editing = '1'
      el.setAttribute('contenteditable', 'plaintext-only')
    }
    if (textOf(el) !== raw) this.paintRaw(el, row, colKey, raw)
    this.cellDiv(el)?.setAttribute('data-active', '1')
    this.rowDiv(el)?.setAttribute('data-active-row', '1')
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    return el
  }

  /** Arrive on a cell: Append mode, caret at the end of its content (KB §2). */
  activateCell(row: number, col: number): void {
    const cols = this.navCols()
    const rowId = this.navIds()[row]
    const c = cols[Math.min(col, cols.length - 1)]
    if (rowId === undefined || !c) return
    const el = this.prepare(rowId, c.key)
    if (!el) return
    setCaret(el, 'end')
    this.nav = arriveAt(this.shape(cols), row, cols.indexOf(c))
    this.syncUi()
  }

  /** Public: focus the remembered active cell, or the first cell. */
  focusGrid(): void {
    const cols = this.navCols()
    if (this.active) {
      const row = this.navIds().indexOf(this.active.rowId)
      const ci = cols.findIndex((c) => c.key === this.active?.colKey)
      if (row >= 0 && ci >= 0) { this.active = null; this.activateCell(row, ci); return }
    }
    this.activateCell(0, 0)
  }

  // ---------- Phase 17: selection for undo/redo (ids, so it survives row changes) ----------
  private histSel(): HistSel | null {
    if (!this.active) return null
    const cols = this.navCols()
    const ids = this.navIds()
    let range: HistSel['range'] = null
    const r = this.nav.range
    if (r) {
      const ar = ids[r.anchor.row]; const fr = ids[r.focus.row]; const ac = cols[r.anchor.col]; const fc = cols[r.focus.col]
      if (ar !== undefined && fr !== undefined && ac && fc) range = { anchorRowId: ar, anchorCol: ac.key, focusRowId: fr, focusCol: fc.key }
    }
    return { rowId: this.active.rowId, colKey: this.active.colKey, range }
  }

  /** After undo/redo: the stored cell becomes active in Append mode, caret at the end (UR §2.4); a range is re-marked. */
  private restoreSel(sel: HistSel | null): void {
    if (!sel) return
    this.unmarkRange()
    this.leave(false) // the draft was committed BEFORE the undo; committing again would re-apply stale text
    const cols = this.navCols()
    const ids = this.navIds()
    if (ids.length === 0 || cols.length === 0) return
    let row = ids.indexOf(sel.rowId)
    if (row < 0) row = ids.length - 1
    const col = Math.max(0, cols.findIndex((c) => c.key === sel.colKey))
    this.activateCell(row, col)
    const r = sel.range
    if (r) {
      const ar = ids.indexOf(r.anchorRowId); const fr = ids.indexOf(r.focusRowId)
      const ac = cols.findIndex((c) => c.key === r.anchorCol); const fc = cols.findIndex((c) => c.key === r.focusCol)
      if (ar >= 0 && fr >= 0 && ac >= 0 && fc >= 0) {
        this.nav = { ...this.nav, range: { anchor: { row: ar, col: ac }, focus: { row: fr, col: fc } } }
        this.markRange(cols)
      }
    }
    this.syncUi()
  }

  /** Where the reducer thinks we are, derived from the active cell's identity (rows may have moved). */
  private locate(cols: GridColumn[]): { row: number; col: number } | null {
    if (!this.active) return null
    const row = this.navIds().indexOf(this.active.rowId)
    const col = cols.findIndex((c) => c.key === this.active?.colKey)
    return row >= 0 && col >= 0 ? { row, col } : null
  }

  private syncUi(): void {
    this.root.classList.toggle('q3-grid--free', this.nav.mode === 'free')
    this.root.toggleAttribute('data-armed', this.nav.leftArmed)
    this.root.dataset.mode = this.active ? this.nav.mode : 'idle'
    useGridUiStore.getState().set(this.active ? this.nav.mode : 'idle', this.nav.leftArmed)
  }

  // ---------- keyboard ----------
  private onKeyDown(e: KeyboardEvent): void {
    if (e.isComposing || e.key === 'Process' || e.key === 'Dead') return
    if (MODIFIER_ONLY_KEYS.has(e.key)) return // Phase 119 (D-K12): a bare Ctrl/Shift/Alt/Meta changes nothing (no focus, range, mode or notice)
    if ((e.target as HTMLElement).closest?.('[data-q3-overlay]')) return // Phase 15: the format palette owns its own keys
    if (useGridUiStore.getState().notice) useGridUiStore.getState().setNotice('')
    if (!this.active) {
      const t = (e.target as HTMLElement).closest?.('.q3-gc[data-nav]')
      if (!t) return
      this.focusGrid()
      if (!this.active) return
    }
    const cols = this.navCols()
    const at = this.locate(cols)
    const el = this.activeEl()
    if (!at || !el) { this.leave(); return }
    const typable = el.dataset.editing === '1'
    if (e.key === 'Backspace' && e.ctrlKey && !e.altKey && !e.shiftKey && this.active.colKey === 'total') {
      e.preventDefault() // Ctrl+Backspace on a Total cell = reset to auto (native word-delete would be wrong here)
      this.resetActiveTotal()
      return
    }
    // Phase 17: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z = the ONE bill-wide undo (UR §2.5); the browser's own undo never runs (D-U1).
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      const undo = k === 'z' && !e.shiftKey
      const redo = k === 'y' || (k === 'z' && e.shiftKey)
      if (undo || redo) {
        e.preventDefault()
        const st = useBillStore.getState()
        const label = undo ? st.undoLabel : st.redoLabel
        const ok = undo ? st.undo() : st.redo()
        useGridUiStore.getState().setNotice(undoNotice(undo ? 'undo' : 'redo', ok, label))
        this.syncUi()
        return
      }
    }
    if (this.nav.mode === 'append') {
      // KB §2: Append parks the caret at the end, whatever the browser did meanwhile.
      const len = textOf(el).length
      const sel = selectionOffsets(el)
      if (sel.start !== len || sel.end !== len) setCaret(el, 'end')
    } else {
      this.nav = syncCaret(this.nav, caretOffset(el))
    }
    this.nav = { ...this.nav, row: at.row, col: at.col }

    // Phase 122 (D-K13): whole-row selection and row delete. Delete on a plain cell or range keeps D-K4 / the range clear.
    if (!this.nav.range) this.rowSel = false
    // Ctrl+Space selects the row from any cell. Shift+Space does it only in a NUMERIC cell: in a text cell Shift+Space is a typed space
    // (holding Shift for capitals: "ABC DEF"), which must never be swallowed.
    const numericHere = isNumericColumn(cols[at.col] as GridColumn)
    if (e.key === ' ' && !e.altKey && !e.metaKey && ((e.ctrlKey && !e.shiftKey) || (e.shiftKey && !e.ctrlKey && numericHere))) {
      e.preventDefault()
      this.selectActiveRow()
      return
    }
    // Phase 124 (D-K14): Alt+Shift+Up / Down move the active item row. (Alt+Up / Alt+Down are taken by the party address pull-down.)
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      this.moveActiveRow(e.key === 'ArrowUp' ? 'up' : 'down')
      return
    }
    if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey && this.rowSelActive(cols)) {
      e.preventDefault()
      this.deleteSelectedRows()
      return
    }

    // Phase 119: Ctrl+C / X / V. The native event normally follows; if none arrives shortly, the bridge does the work.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'c' || k === 'x' || k === 'v') this.armClipboardFallback(k === 'v' ? 'paste' : k === 'x' ? 'cut' : 'copy')
    }

    // Phase 15 formatting keys (KB §4). Consumed here; item-name cells only (numeric/extra cells ignore them silently).
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase()
      const fmt: FormatKind | 'palette' | null =
        k === 'b' && !e.shiftKey ? 'bold' : k === 'r' && e.shiftKey ? 'redBold' : k === 'h' && !e.shiftKey ? 'highlight'
        : k === 'c' && e.shiftKey ? 'clear' : k === 'k' && e.shiftKey ? 'palette' : null
      if (fmt) {
        e.preventDefault()
        if (fmt === 'palette') this.openFormatPalette()
        else this.formatActive(fmt)
        this.syncUi()
        return
      }
    }

    const res = navReduce(this.nav, { key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, pageRows: this.pageRows }, this.shape(cols), { ...navOptionsFor(useBehaviourStore.getState().smoothArrows), leftUnlockPresses: useBehaviourStore.getState().leftUnlockPresses })
    this.nav = res.state
    const native = res.effects.some((x) => x.type === 'NATIVE' || x.type === 'PAGE_ESCAPE')
    if (!native || (!typable && res.effects.some((x) => x.type === 'NATIVE') && this.isEditKey(e))) e.preventDefault()
    for (const eff of res.effects) this.apply(eff, cols, typable)
    this.syncUi()
  }

  /** Phase 13: drop the active Total cell's manual override; the draft then shows the auto value, caret at the end. */
  resetActiveTotal(): void {
    if (!this.active || this.active.colKey !== 'total' || isFreeRowId(this.active.rowId)) return
    const el = this.activeEl()
    useBillStore.getState().resetTotal(this.active.rowId)
    if (el && el.dataset.editing === '1') {
      this.refreshActiveText()
      setCaret(el, 'end')
      this.nav = { ...this.nav, mode: 'append', caret: textOf(el).length }
      this.syncUi()
    }
  }

  /** Keys that would edit text if the browser handled them (blocked on read-only cells). */
  private isEditKey(e: KeyboardEvent): boolean {
    return e.key === 'Backspace' || e.key === 'Delete' || (!e.ctrlKey && !e.altKey && !e.metaKey && Array.from(e.key).length === 1)
  }

  private apply(eff: NavEffect, cols: GridColumn[], typable: boolean): void {
    const el = this.activeEl()
    switch (eff.type) {
      case 'ENSURE_ROW':
        // Phase 80: with extra columns the last row is a tail row - Enter / Tab past it opens one more (display only until it holds something).
        if (useBillStore.getState().extraCols.length > 0) {
          const ui = useGridUiStore.getState()
          const shown = displayedTailCount(useBillStore.getState().tailRows, ui.tailShown)
          if (eff.index >= this.navIds().length) flushSync(() => ui.setTailShown(shown + 1))
          return
        }
        // Phase 19: navigation continues into the adjustment rows; "last row" is then an adjustment, which never grows the body.
        if (useBillStore.getState().view.adjIds.length > 0) return
        flushSync(() => useBillStore.getState().ensureBodyRows(eff.index + 1))
        return
      case 'MOVE': {
        this.unmarkRange()
        const rowId = this.navIds()[eff.row]
        const col = cols[eff.col]
        if (rowId === undefined || !col) return
        const next = this.prepare(rowId, col.key)
        if (next) setCaret(next, 'end')
        // After a commit the row set can change (adjustments leave the body): re-locate for the nav state.
        const at = this.locate(cols)
        if (at) this.nav = { ...this.nav, row: at.row, col: at.col, caret: textOf(next ?? el ?? document.body).length }
        return
      }
      case 'SET_CARET': if (el) setCaret(el, eff.pos); return
      case 'SET_MODE': case 'SET_ARMED': case 'IGNORE': case 'NATIVE': case 'PAGE_ESCAPE': return
      case 'INSERT_TEXT':
        if (el && typable) { appendText(el, eff.text); setCaret(el, 'end') }
        return
      case 'CLEAR_CELL':
        if (el && typable) { el.textContent = ''; this.commitFollow(); setCaret(this.activeEl() ?? el, 'start') }
        return
      case 'CLEAR_RANGE':
        this.clearBounds({ top: eff.from.row, left: eff.from.col, bottom: eff.to.row, right: eff.to.col }, cols, 'Clear cells')
        return
      case 'EXTEND_RANGE': this.markRange(cols); return
      case 'COLLAPSE_RANGE': this.unmarkRange(); return
    }
  }

  /** After a bulk store write the active cell's draft must reflect the store (it is not React-synced while editing). */
  private refreshActiveText(): void {
    const el = this.activeEl()
    if (!el || !this.active) return
    const st = useBillStore.getState()
    if (isFreeRowId(this.active.rowId)) { el.textContent = this.freeText(this.active.rowId, this.active.colKey); return }
    const row = st.rows.find((r) => r.id === this.active?.rowId)
    if (row) this.paintRaw(el, row, this.active.colKey, cellRawText(row, this.active.colKey, st.view.body[this.active.rowId]?.cells[this.active.colKey] ?? ''))
  }

  // ---------- Phase 16: clear / copy / cut / paste ----------
  private pasteCols(cols: GridColumn[]): PasteCol[] {
    return cols.map((c) => ({ key: c.key, numeric: isNumericColumn(c), typable: isTypable(c), allowNegative: allowsNegative(c.key) }))
  }

  /** Clear every typable cell in `b` as ONE history entry; the active cell's live draft is dropped too. Arrival is Append. */
  private clearBounds(b: { top: number; left: number; bottom: number; right: number }, cols: GridColumn[], label: string): void {
    const el = this.activeEl()
    const typable = !!el && el.dataset.editing === '1'
    const cells: { rowId: string; colKey: string; text: string }[] = []
    const ids = this.navIds()
    for (let r = b.top; r <= b.bottom; r++) for (let c = b.left; c <= b.right; c++) {
      const rowId = ids[r]; const col = cols[c]
      if (rowId !== undefined && col && this.typableAt(rowId, col)) cells.push({ rowId, colKey: col.key, text: '' })
    }
    this.unmarkRange()
    if (el && typable) el.textContent = ''
    const freeCells = cells.filter((c) => isFreeRowId(c.rowId))
    const bodyCells = freeCells.length > 0 ? cells.filter((c) => !isFreeRowId(c.rowId)) : cells
    if (freeCells.length > 0) this.freezeTail()
    runAsOneEntry(label, () => {
      if (bodyCells.length > 0) useBillStore.getState().setCellTexts(bodyCells)
      if (freeCells.length > 0) useBillStore.getState().setFreeCells(freeCells)
    })
    this.refreshActiveText()
    if (el) setCaret(el, 'start')
  }

  /** The cells of `b` as clipboard cells. The active cell reports its live draft; item names carry their runs when styled. */
  private readCells(b: { top: number; left: number; bottom: number; right: number }, cols: GridColumn[]): GridClipCell[][] {
    const st = useBillStore.getState()
    const shape = this.shape(cols)
    const ids = this.navIds()
    const byId = new Map(st.rows.map((r) => [r.id, r]))
    const out: GridClipCell[][] = []
    for (let r = b.top; r <= b.bottom; r++) {
      const line: GridClipCell[] = []
      for (let c = b.left; c <= b.right; c++) {
        const col = cols[c]; const rowId = ids[r]
        const text = shape.cellText(r, c)
        const cell: GridClipCell = { text }
        const row = rowId !== undefined ? byId.get(rowId) : undefined
        if (col?.key === 'name' && row) {
          const live = this.active?.rowId === rowId && this.activeEl()?.dataset.editing === '1'
          const runs = live ? applyTextChange(row.nameRuns, text) : row.nameRuns
          if (hasStyle(runs)) cell.runs = runs
        }
        line.push(cell)
      }
      out.push(line)
    }
    return out
  }

  /**
   * copy / cut (KB §5). A range, or the whole active cell in Append mode, goes to the clipboard as TSV + the Quot3 flavour.
   * In Free mode with no range the browser's own text copy/cut is left alone.
   */
  private onCopy(e: ClipboardEvent, cut: boolean): void {
    if ((e.target as HTMLElement | null)?.closest?.('[data-q3-overlay]')) return
    this.clipSeen = true
    const cd = e.clipboardData
    const d = this.copyData()
    if (!d || !cd) return
    cd.setData('text/plain', d.tsv)
    cd.setData(QUOT3_GRID_MIME, d.quot3)
    this.lastCopy = { tsv: d.tsv, matrix: d.matrix }
    e.preventDefault()
    this.finishCopy(d, cut)
  }

  /** What a copy / cut would put on the clipboard now, or null = not the grid's job (no grid focus; Free mode with no range stays native text copy). */
  private copyData(): { b: { top: number; left: number; bottom: number; right: number }; matrix: GridClipCell[][]; tsv: string; quot3: string; cols: GridColumn[] } | null {
    if (!this.active) return null
    const cols = this.navCols()
    const at = this.locate(cols)
    if (!at) return null
    const range = this.nav.range
    if (!range && this.nav.mode === 'free') return null
    const b = range ? rangeBounds(range) : { top: at.row, left: at.col, bottom: at.row, right: at.col }
    const matrix = this.readCells(b, cols)
    return { b, matrix, tsv: formatTsv(matrix.map((r) => r.map((c) => c.text))), quot3: serializeQuot3Payload(matrix), cols }
  }

  private finishCopy(d: { b: { top: number; left: number; bottom: number; right: number }; matrix: GridClipCell[][]; cols: GridColumn[] }, cut: boolean): void {
    if (cut) {
      this.clearBounds(d.b, d.cols, 'Cut')
      this.nav = { ...this.nav, range: null, mode: 'append', leftArmed: false, caret: 0 }
      this.syncUi()
    } else {
      useGridUiStore.getState().setNotice(d.matrix.length * (d.matrix[0]?.length ?? 0) > 1 ? `Copied ${d.matrix.length} × ${d.matrix[0]?.length ?? 0} cells` : '')
    }
  }

  /**
   * Phase 119: the native copy / cut / paste event is expected right after the Ctrl+key. If it never arrives (the real window
   * never proved it does), do the same through the bridge: copy / cut write the TSV with `clipboard:writeTsv`, paste reads
   * `clipboard:readGrid`. Free mode with no range stays native text editing, so no fallback there.
   */
  private armClipboardFallback(kind: 'copy' | 'cut' | 'paste'): void {
    this.clipSeen = false
    if (this.clipTimer !== null) clearTimeout(this.clipTimer)
    this.clipTimer = setTimeout(() => {
      this.clipTimer = null
      if (this.clipSeen || !this.active) return
      if (kind === 'paste') {
        if (this.nav.mode === 'free' && !this.nav.range) return
        void this.pasteFromBridge()
        return
      }
      const d = this.copyData()
      if (!d) return
      this.lastCopy = { tsv: d.tsv, matrix: d.matrix }
      const w = window.quot3?.clipboard?.writeTsv
      if (!w) { useGridUiStore.getState().setNotice('Clipboard is not available'); return }
      void w({ text: d.tsv }).then((res) => {
        if (!res.ok) { useGridUiStore.getState().setNotice('Could not write to the clipboard'); return }
        this.finishCopy(d, kind === 'cut')
      }, () => useGridUiStore.getState().setNotice('Could not write to the clipboard'))
    }, CLIPBOARD_FALLBACK_MS)
  }

  private matrixFromClip(text: string, quot3: string | null | undefined): GridClipCell[][] | null {
    const q = parseQuot3Payload(quot3)
    if (q) return q.cells
    // Phase 119: the OS clipboard kept only the text (bridge write); if it is exactly what this grid last copied, keep its formatting.
    if (this.lastCopy && text.replace(/\r?\n$/, '') === this.lastCopy.tsv.replace(/\r?\n$/, '')) return this.lastCopy.matrix
    if (looksLikeTsv(text)) return parseTsv(text).map((r) => r.map((t) => ({ text: t })))
    return text === '' ? null : [[{ text }]]
  }

  private onPaste(e: ClipboardEvent): void {
    if ((e.target as HTMLElement | null)?.closest?.('[data-q3-overlay]')) return
    this.clipSeen = true
    const cd = e.clipboardData
    if (!this.active || !cd) return
    const flavour = cd.getData(QUOT3_GRID_MIME)
    const matrix = this.matrixFromClip(cd.getData('text/plain'), flavour)
    // A cell copied inside Quot3 and pasted in Append mode is a cell-level paste (replaces the cell, keeps its formatting);
    // outside text and Free mode stay native text paste.
    const cellLevel = this.nav.mode === 'append' && parseQuot3Payload(flavour) !== null
    if (this.pasteMatrix(matrix, cellLevel)) e.preventDefault()
  }

  /** Palette path: read the clipboard through `clipboard:readGrid` (no paste event exists there). */
  async pasteFromBridge(): Promise<void> {
    this.refocus()
    const res = await window.quot3?.clipboard.readGrid()
    if (!res || !res.ok) { useGridUiStore.getState().setNotice('Clipboard is not available'); return }
    const matrix = this.matrixFromClip(res.data.tsv ?? '', res.data.quot3)
    if (!matrix) { useGridUiStore.getState().setNotice('Nothing to paste'); return }
    this.pasteMatrix(matrix, true)
  }

  /**
   * Apply a pasted matrix at the active cell (or the range's top-left). Returns false = "not mine, let the browser paste
   * text natively" (a single value with no range selected, unless `force` = a cell-level paste). A single value onto a range fills the whole range. The whole
   * paste is one history entry; new rows are created first; nothing is dropped silently (the status line reports rejects).
   */
  private pasteMatrix(matrix: GridClipCell[][] | null, force: boolean): boolean {
    if (!matrix || matrix.length === 0) return false
    const cols = this.navCols()
    const at = this.locate(cols)
    if (!at) return false
    const range = this.nav.range
    const b = range ? rangeBounds(range) : null
    const single = matrix.length === 1 && matrix[0]?.length === 1
    if (single && !b && !force) return false
    const m = single && b ? repeatCell((matrix[0] as GridClipCell[])[0] as GridClipCell, b.bottom - b.top + 1, b.right - b.left + 1) : matrix
    const start = b ? { row: b.top, col: b.left } : at
    const startId = this.navIds()[start.row]
    if (startId !== undefined && isFreeRowId(startId)) return this.pasteFree(m, start, cols)
    if (start.row >= useBillStore.getState().view.bodyIds.length) { useGridUiStore.getState().setNotice('Paste starts in an item row — adjustment rows are typed, not pasted'); return true }
    const plan = planPaste(m, start.row, start.col, this.pasteCols(cols))
    runAsOneEntry('Paste', () => {
      flushSync(() => useBillStore.getState().ensureBodyRows(plan.rowsNeeded))
      const ids = useBillStore.getState().view.bodyIds // paste flows through body rows only (never into the adjustment block)
      const items: { rowId: string; colKey: string; text: string; runs?: import('@shared/types').Runs }[] = []
      for (const c of plan.cells) {
        const rowId = ids[c.row]; const col = cols[c.col]
        if (rowId === undefined || !col) continue
        items.push(c.runs ? { rowId, colKey: col.key, text: c.text, runs: c.runs } : { rowId, colKey: col.key, text: c.text })
      }
      useBillStore.getState().setCellTexts(items)
    })
    this.unmarkRange()
    this.refreshActiveText()
    const el = this.activeEl()
    if (el) setCaret(el, 'end')
    this.nav = { ...this.nav, range: null, mode: 'append', leftArmed: false, caret: el ? textOf(el).length : 0 }
    this.syncUi()
    const label = (k: string): string => cols.find((c) => c.key === k)?.label ?? k
    useGridUiStore.getState().setNotice(describePaste(plan, label))
    return true
  }

  /**
   * Phase 80: a paste that starts on a total row or a tail row. It flows DOWN through the free rows (total rows, then the tail
   * rows, growing the tail as needed) and only extra columns take text; anything that lands elsewhere (item names, amounts,
   * adjustment rows) is skipped and counted in the status line. One history entry.
   */
  private pasteFree(m: GridClipCell[][], start: { row: number; col: number }, cols: GridColumn[]): boolean {
    const ids = this.navIds()
    const tailBase = ids.findIndex((id) => id.startsWith('tr:'))
    const plan = planPaste(m, start.row, start.col, this.pasteCols(cols))
    const items: { rowId: string; colKey: string; text: string }[] = []
    let skipped = 0
    for (const c of plan.cells) {
      const col = cols[c.col]
      const rowId = c.row < ids.length ? ids[c.row] : tailBase >= 0 ? `tr:${c.row - tailBase}` : undefined
      if (!col || !col.isExtra || rowId === undefined || !isFreeRowId(rowId)) { skipped++; continue }
      items.push({ rowId, colKey: col.key, text: c.text })
    }
    this.freezeTail()
    runAsOneEntry('Paste', () => { if (items.length > 0) useBillStore.getState().setFreeCells(items) })
    this.unmarkRange()
    this.refreshActiveText()
    const el = this.activeEl()
    if (el) setCaret(el, 'end')
    this.nav = { ...this.nav, range: null, mode: 'append', leftArmed: false, caret: el ? textOf(el).length : 0 }
    this.syncUi()
    const label = (k: string): string => cols.find((c) => c.key === k)?.label ?? k
    useGridUiStore.getState().setNotice(skipped > 0 ? `Pasted ${items.length} cell${items.length === 1 ? '' : 's'}; ${skipped} skipped (only extra columns take text here)` : describePaste(plan, label))
    return true
  }

  // ---------- range marks (keyboard Shift-range, mouse drag; copy/cut/paste above) ----------
  private markRange(cols: GridColumn[]): void {
    this.unmarkRange()
    if (!this.nav.range) return
    const b = rangeBounds(this.nav.range)
    const ids = this.navIds()
    for (let r = b.top; r <= b.bottom; r++) for (let c = b.left; c <= b.right; c++) {
      const rowId = ids[r]; const col = cols[c]
      const el = rowId !== undefined && col ? this.cellEl(rowId, col.key) : null
      const div = el ? this.cellDiv(el) : null
      if (div) { div.setAttribute('data-in-range', '1'); this.rangeMarked.push(div) }
    }
  }
  private unmarkRange(): void {
    for (const d of this.rangeMarked) d.removeAttribute('data-in-range')
    this.rangeMarked = []
  }

  // ---------- beforeinput: final gate for numeric cells, single-line text, native undo ----------
  private onBeforeInput(e: InputEvent): void {
    const t = e.inputType
    if (t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); return } // Phase 17 owns undo
    const el = this.activeEl()
    if (!el || !this.active) return
    if (t === 'insertParagraph' || t === 'insertLineBreak') { e.preventDefault(); return }
    if (el.dataset.editing !== '1') { e.preventDefault(); return }
    if (t !== 'insertText' && t !== 'insertFromPaste' && t !== 'insertFromDrop' && t !== 'insertReplacementText') return
    const raw = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
    const clean = raw.replace(/[\r\n\t]+/g, ' ')
    const col = this.colOf(this.active.colKey)
    if (col && isNumericColumn(col)) {
      const cur = textOf(el)
      const { start, end } = selectionOffsets(el)
      const neg = allowsNegative(col.key)
      if (t === 'insertFromPaste' || t === 'insertFromDrop') {
        // Phase 12: tolerate what people copy with a number (commas, ₹, spaces); reject anything else whole.
        e.preventDefault()
        const ok = sanitizeNumericPaste(raw, cur, start, end, neg)
        if (ok !== null) insertTextAtSelection(el, ok)
        return
      }
      const result = cur.slice(0, start) + clean + cur.slice(end)
      if (!isValidNumericDraft(result, neg)) { e.preventDefault(); return }
    }
    if (clean !== raw) { e.preventDefault(); insertTextAtSelection(el, clean) }
  }

  // ---------- mouse ----------
  // ---------- Phase 122: whole-row selection and row delete ----------
  /** A body (item) row: not a total / tail / adjustment row. */
  private isBodyIndex(i: number): boolean {
    const id = this.navIds()[i]
    return id !== undefined && useBillStore.getState().view.bodyIds.includes(id)
  }
  /** Select the whole active row (every navigable column) as a range; the active cell stays the first cell of the row. */
  selectActiveRow(): void {
    if (!this.active) return
    const cols = this.navCols()
    const at = this.locate(cols)
    if (!at || !this.isBodyIndex(at.row) || cols.length === 0) { useGridUiStore.getState().setNotice('Only item rows can be selected as a row'); return }
    const el = this.activeEl()
    if (el && el.dataset.editing === '1') this.commit()
    this.nav = { ...this.nav, row: at.row, col: 0, mode: 'append', leftArmed: false, textAllSelected: false, range: { anchor: { row: at.row, col: 0 }, focus: { row: at.row, col: cols.length - 1 } } }
    this.rowSel = true
    this.markRange(cols)
    this.syncUi()
  }
  /** True while the range is whole item rows (made by row selection, still full width, body rows only). */
  private rowSelActive(cols: GridColumn[]): boolean {
    const r = this.nav.range
    if (!this.rowSel || !r || cols.length === 0) return false
    const b = rangeBounds(r)
    if (b.left !== 0 || b.right !== cols.length - 1) return false
    for (let i = b.top; i <= b.bottom; i++) if (!this.isBodyIndex(i)) return false
    return true
  }
  /** Delete the selected rows as ONE history entry; the cursor lands on the first deleted position. Returns whether anything was deleted. */
  deleteSelectedRows(): boolean {
    const cols = this.navCols()
    if (!this.rowSelActive(cols) || !this.nav.range) return false
    const b = rangeBounds(this.nav.range)
    const ids = this.navIds().slice(b.top, b.bottom + 1)
    this.unmarkRange()
    this.rowSel = false
    const changed = useBillStore.getState().deleteRows(ids)
    const el = this.activeEl()
    this.nav = { ...this.nav, row: b.top, col: 0, range: null, mode: 'append', leftArmed: false, caret: 0 }
    if (changed) {
      this.refreshActiveText()
      const e2 = this.activeEl()
      if (e2) setCaret(e2, 'end')
      this.nav = { ...this.nav, caret: e2 ? textOf(e2).length : 0 }
      useGridUiStore.getState().setNotice(ids.length === 1 ? 'Deleted row (extra columns stay)' : `Deleted ${ids.length} rows (extra columns stay)`)
    } else if (el) setCaret(el, 'end')
    this.syncUi()
    return changed
  }

  // ---------- Phase 124: move the active row ----------
  /** Move the active item row (or the single selected row) up / down / to top / to bottom as ONE history entry; the cursor follows the moved item. */
  moveActiveRow(target: MoveTarget): boolean {
    if (!this.active) return false
    const cols = this.navCols()
    const at = this.locate(cols)
    if (!at || !this.isBodyIndex(at.row)) { useGridUiStore.getState().setNotice('Only item rows can be moved'); return false }
    const id = this.navIds()[at.row] as string
    const el = this.activeEl()
    if (el && el.dataset.editing === '1') this.commit()
    const dest = useBillStore.getState().moveRow(id, target)
    if (dest === null) { useGridUiStore.getState().setNotice(target === 'up' || target === 'top' ? 'Already the first row' : 'Already the last item row'); return false }
    const keepCol = at.col
    this.unmarkRange()
    this.rowSel = false
    this.refreshActiveText() // the old cell now holds another item: repaint it from the store so leaving it commits nothing stale
    const colKey = (cols[keepCol] as GridColumn).key
    const destId = this.navIds()[dest]
    const next = destId !== undefined ? this.prepare(destId, colKey) : null
    if (next) setCaret(next, 'end')
    const here = this.locate(cols)
    this.nav = { ...this.nav, row: here ? here.row : dest, col: here ? here.col : keepCol, range: null, mode: 'append', leftArmed: false, textAllSelected: false, caret: next ? textOf(next).length : 0 }
    useGridUiStore.getState().setNotice(`Moved row to ${dest + 1} (extra columns stay)`)
    this.syncUi()
    return true
  }

  private onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const sl = target.closest<HTMLElement>('.q3-gc[data-col="slNo"]')
    if (sl && !sl.hasAttribute('data-nav')) {
      // Phase 122: a click on the row number selects the whole row (item rows only).
      const slRow = this.navIds().indexOf(sl.parentElement?.dataset.rowId ?? '')
      if (slRow >= 0 && this.isBodyIndex(slRow)) {
        e.preventDefault()
        this.unmarkRange()
        this.activateCell(slRow, 0)
        this.selectActiveRow()
      }
      return
    }
    const div = target.closest<HTMLElement>('.q3-gc[data-nav]')
    if (!div) return
    const rowId = div.parentElement?.dataset.rowId
    const colKey = div.dataset.col
    if (!rowId || !colKey) return
    {
      const cols0 = this.navCols()
      const r0 = this.navIds().indexOf(rowId)
      const c0 = cols0.findIndex((c) => c.key === colKey)
      this.dragFrom = r0 >= 0 && c0 >= 0 ? { row: r0, col: c0 } : null
      this.dragged = false
    }
    if (target.closest('.q3-gc__text')) {
      this.prepare(rowId, colKey) // the browser then places the caret where the pointer is
      this.pendingClick = true
    } else {
      e.preventDefault() // border/padding: arrive Append at end
      const cols = this.navCols()
      const row = this.navIds().indexOf(rowId)
      const ci = cols.findIndex((c) => c.key === colKey)
      this.unmarkRange()
      this.activateCell(row, ci)
    }
  }
  /** Phase 16: dragging across cells with the left button builds a range anchored on the cell the drag began in. */
  private onMouseMove(e: MouseEvent): void {
    const from = this.dragFrom
    if (!from || !(e.buttons & 1)) return
    const div = (e.target as HTMLElement).closest?.<HTMLElement>('.q3-gc[data-nav]')
    const rowId = div?.parentElement?.dataset.rowId
    const colKey = div?.dataset.col
    if (!div || !rowId || !colKey) return
    const cols = this.navCols()
    const row = this.navIds().indexOf(rowId)
    const col = cols.findIndex((c) => c.key === colKey)
    if (row < 0 || col < 0) return
    const same = row === from.row && col === from.col
    if (!this.dragged && same) return
    if (!this.dragged) {
      this.dragged = true
      this.pendingClick = false
      this.root.classList.add('q3-grid--dragging')
      this.prepare(this.navIds()[from.row] as string, (cols[from.col] as GridColumn).key)
      this.nav = arriveAt(this.shape(cols), from.row, from.col)
    }
    window.getSelection()?.removeAllRanges() // the pointer must not also select text across cells
    const cur = this.nav.range
    if (cur && cur.focus.row === row && cur.focus.col === col) return
    this.nav = { ...this.nav, mode: 'append', leftArmed: false, range: same ? null : { anchor: { row: from.row, col: from.col }, focus: { row, col } } }
    this.markRange(cols)
    const el = this.activeEl()
    if (el) { el.focus({ preventScroll: true }); setCaret(el, 'end') }
    this.syncUi()
  }
  private onMouseUp(): void {
    this.dragFrom = null
    if (this.dragged) { this.dragged = false; this.pendingClick = false; this.root.classList.remove('q3-grid--dragging'); return }
    if (!this.pendingClick) return
    this.pendingClick = false
    const cols = this.navCols()
    const at = this.locate(cols)
    const el = this.activeEl()
    if (!at || !el) return
    this.unmarkRange()
    this.nav = clickInText(this.shape(cols), at.row, at.col, caretOffset(el)) // KB §3: click inside text → Free
    this.syncUi()
  }
  private onDoubleClick(): void {
    const el = this.activeEl()
    if (!el) return
    this.nav = { ...this.nav, mode: 'free', leftArmed: false, caret: caretOffset(el) }
    this.syncUi()
  }

  // ---------- focus ----------
  private onFocusIn(e: FocusEvent): void {
    if (e.target === this.root) this.focusGrid()
  }
  private onFocusOut(e: FocusEvent): void {
    const to = e.relatedTarget as Node | null
    if (to && this.root.contains(to)) return
    this.commit() // focus left the grid (or the window): persist the draft, keep the cell active
  }
}
