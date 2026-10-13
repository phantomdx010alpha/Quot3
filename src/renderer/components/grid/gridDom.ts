import type { Runs } from '@shared/types'
import { hasStyle } from '@shared/richtext/format'

/** Small DOM helpers for the editable cell span (Phase 11). Offsets are UTF-16 units, like the nav reducer. */

export function textOf(el: HTMLElement): string { return el.textContent ?? '' }

/** Caret offset (selection focus) inside `el`; 0 when the selection is elsewhere. */
export function caretOffset(el: HTMLElement): number {
  const sel = el.ownerDocument.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.focusNode || !el.contains(sel.focusNode)) return 0
  const r = el.ownerDocument.createRange()
  r.selectNodeContents(el)
  r.setEnd(sel.focusNode, sel.focusOffset)
  return r.toString().length
}

/** Selection start/end offsets inside `el` (equal when collapsed). Falls back to the end of the text. */
export function selectionOffsets(el: HTMLElement): { start: number; end: number } {
  const sel = el.ownerDocument.getSelection()
  const len = textOf(el).length
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return { start: len, end: len }
  const rng = sel.getRangeAt(0)
  const pre = el.ownerDocument.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(rng.startContainer, rng.startOffset)
  const start = pre.toString().length
  return { start, end: start + rng.toString().length }
}

export function setCaret(el: HTMLElement, pos: number | 'end' | 'start'): void {
  const doc = el.ownerDocument
  const sel = doc.getSelection()
  if (!sel) return
  const len = textOf(el).length
  const at = pos === 'end' ? len : pos === 'start' ? 0 : Math.max(0, Math.min(pos, len))
  const r = doc.createRange()
  placeBoundary(r, el, at, true)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  if (at === len) el.scrollLeft = el.scrollWidth // keep the end visible in a narrow cell
}

/** Phase 15: a name cell may hold styled child spans, so offsets are resolved against its text nodes in order. */
function placeBoundary(r: Range, el: HTMLElement, offset: number, isStart: boolean): void {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */)
  let left = offset
  let last: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    last = n
    if (left <= n.data.length) { if (isStart) r.setStart(n, left); else r.setEnd(n, left); return }
    left -= n.data.length
  }
  if (last) { if (isStart) r.setStart(last, last.data.length); else r.setEnd(last, last.data.length) }
  else if (isStart) r.setStart(el, 0)
  else r.setEnd(el, 0)
}

/** Select [start,end) of the cell text (collapsed when equal). */
export function setSelectionRange(el: HTMLElement, start: number, end: number): void {
  const doc = el.ownerDocument
  const sel = doc.getSelection()
  if (!sel) return
  const len = textOf(el).length
  const s = Math.max(0, Math.min(start, len)); const e = Math.max(s, Math.min(end, len))
  const r = doc.createRange()
  placeBoundary(r, el, s, true)
  placeBoundary(r, el, e, false)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Phase 15: paint item-name runs into the cell span. Unstyled names stay ONE text node (the Phase 11 shape). */
export function renderRuns(el: HTMLElement, runs: Runs): void {
  if (!hasStyle(runs)) { const t = runs.map((r) => r.t).join(''); if (el.childNodes.length !== 1 || el.textContent !== t || el.firstElementChild) el.textContent = t; return }
  const doc = el.ownerDocument
  const frag = doc.createDocumentFragment()
  for (const run of runs) {
    if (!run.b && !run.r && !run.hl) { frag.appendChild(doc.createTextNode(run.t)); continue }
    const sp = doc.createElement('span')
    sp.className = 'q3-run'
    if (run.b) sp.dataset.b = '1'
    if (run.r) sp.dataset.r = '1'
    if (run.hl) sp.dataset.hl = '1'
    sp.textContent = run.t
    frag.appendChild(sp)
  }
  el.replaceChildren(frag)
}

/** Append text at the end of the cell, inside the last text node so it continues the last run's style. */
export function appendText(el: HTMLElement, text: string): void {
  const walker = el.ownerDocument.createTreeWalker(el, 4)
  let last: Text | null = null
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) last = n
  if (last) last.data += text
  else el.textContent = text
}

/** Replace the current selection (or insert at the caret) with plain text, keeping a single text node. */
export function insertTextAtSelection(el: HTMLElement, text: string): void {
  const { start, end } = selectionOffsets(el)
  const cur = textOf(el)
  if (el.firstElementChild || el.childNodes.length > 1) {
    // Styled name cell: edit through a Range so the inserted text stays inside the run it lands in.
    const r = el.ownerDocument.createRange()
    placeBoundary(r, el, start, true); placeBoundary(r, el, end, false)
    r.deleteContents()
    r.insertNode(el.ownerDocument.createTextNode(text))
    el.normalize()
  } else {
    el.textContent = cur.slice(0, start) + text + cur.slice(end)
  }
  setCaret(el, start + text.length)
}
