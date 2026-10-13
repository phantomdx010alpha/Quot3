// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { GridStatus } from '../GridStatus'
import { renderProbe } from '../renderProbe'
import { caretOffset, setCaret } from '../gridDom'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useBehaviourStore } from '../../../stores/behaviourStore'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function mount(): void {
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement('div', null, createElement(BillGrid), createElement(GridStatus))) })
}
// Phase 75: the arrow-key tests below describe the legacy (OFF) behaviour; smooth arrows (default ON) has its own describe at the end.
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false }); useBehaviourStore.setState({ smoothArrows: false }) })
afterEach(() => { act(() => root.unmount()); host.remove(); renderProbe.enabled = false; renderProbe.reset() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const rowEl = (i: number) => [...host.querySelectorAll<HTMLElement>('[data-row-id]')][i]!
const span = (r: number, col: string) => rowEl(r).querySelector<HTMLElement>(`[data-col="${col}"] .q3-gc__text`)!
const activeSpan = () => host.querySelector<HTMLElement>('.q3-gc[data-active] .q3-gc__text')!
const status = () => host.querySelector('.q3-gstatus strong')!.textContent
const rowId = (i: number) => rowEl(i).dataset.rowId!
const stored = (i: number) => useBillStore.getState().rows[i]!

function focusGrid(): void { act(() => { grid().focus() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
function keys(...ks: string[]): void { for (const k of ks) key(k) }
function beforeInput(inputType: string, data: string | null, target: Element = activeSpan()): InputEvent {
  const ev = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(ev) })
  return ev
}

describe('arrival and Append mode (KB §2)', () => {
  it('focusing the grid activates the first cell: Append, caret at end, editable, status APPEND', () => {
    mount(); focusGrid()
    const s = activeSpan()
    expect(s).toBe(span(0, 'name'))
    expect(s.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(document.activeElement).toBe(s)
    expect(caretOffset(s)).toBe(s.textContent!.length)
    expect(status()).toBe('APPEND')
    expect(grid().dataset.mode).toBe('append')
  })
  it('typing appends and never replaces', () => {
    mount(); focusGrid()
    const before = activeSpan().textContent!
    const ev = key('x')
    expect(ev.defaultPrevented).toBe(true)
    expect(activeSpan().textContent).toBe(before + 'x')
    key('y')
    expect(activeSpan().textContent).toBe(before + 'xy')
    expect(caretOffset(activeSpan())).toBe(before.length + 2)
  })
  it('even if the browser moved the caret, Append re-parks it at the end before typing', () => {
    mount(); focusGrid()
    const before = activeSpan().textContent!
    setCaret(activeSpan(), 2)
    key('z')
    expect(activeSpan().textContent).toBe(before + 'z')
  })
  it('arrival by Tab/Enter/arrows is Append at end of the destination', () => {
    mount(); focusGrid()
    key('Tab')
    expect(activeSpan()).toBe(span(0, 'rate'))
    expect(caretOffset(activeSpan())).toBe(2)
    key('Enter')
    expect(activeSpan()).toBe(span(1, 'rate'))
    key('ArrowUp'); key('ArrowLeft')
    expect(activeSpan()).toBe(span(0, 'rate')) // Left on a filled cell only arms; it does not move
  })
})

describe('Left twice unlocks, Free mode, F2, Esc (KB §3/§9)', () => {
  it('Left arms (hint, no caret move) then unlocks one char left of the end', () => {
    mount(); focusGrid()
    const len = activeSpan().textContent!.length
    key('ArrowLeft')
    expect(grid().hasAttribute('data-armed')).toBe(true)
    expect(caretOffset(activeSpan())).toBe(len)
    expect(status()).toBe('APPEND')
    key('ArrowLeft')
    expect(status()).toBe('EDIT')
    expect(grid().classList.contains('q3-grid--free')).toBe(true)
    expect(caretOffset(activeSpan())).toBe(len - 1)
  })
  it('Left, X, Left stays Append', () => {
    mount(); focusGrid()
    key('ArrowLeft'); key('x'); key('ArrowLeft')
    expect(status()).toBe('APPEND')
  })
  it('F2 → Free at end; Esc → Append, content kept; Esc in Append bubbles (not prevented)', () => {
    mount(); focusGrid()
    const t = activeSpan().textContent!
    key('F2')
    expect(status()).toBe('EDIT')
    expect(caretOffset(activeSpan())).toBe(t.length)
    const e1 = key('Escape')
    expect(e1.defaultPrevented).toBe(true)
    expect(status()).toBe('APPEND')
    expect(activeSpan().textContent).toBe(t)
    const e2 = key('Escape')
    expect(e2.defaultPrevented).toBe(false)
  })
  it('Home unlocks and goes to the start; Free Right walks to the end edge then leaves', () => {
    mount(); focusGrid()
    key('Home')
    expect(status()).toBe('EDIT')
    expect(caretOffset(activeSpan())).toBe(0)
    key('End')
    expect(caretOffset(activeSpan())).toBe(activeSpan().textContent!.length)
    key('ArrowLeft')
    key('ArrowRight')
    expect(activeSpan()).toBe(span(0, 'name'))
    key('ArrowRight')
    expect(activeSpan()).toBe(span(0, 'rate'))
    expect(status()).toBe('APPEND')
  })
  it('native text keys in Free mode are not prevented (browser edits in place)', () => {
    mount(); focusGrid()
    key('F2')
    expect(key('q').defaultPrevented).toBe(false)
    expect(key('Backspace').defaultPrevented).toBe(false)
    expect(key('Delete').defaultPrevented).toBe(false)
  })
})

describe('commit, Delete, trailing row', () => {
  it('leaving a cell commits its draft into the store', () => {
    mount(); focusGrid()
    const base = stored(0).nameRuns.map((r) => r.t).join('')
    key('!'); key('Tab')
    expect(stored(0).nameRuns.map((r) => r.t).join('')).toBe(base + '!')
    expect(span(0, 'name').textContent).toBe(base + '!')
    expect(span(0, 'name').hasAttribute('contenteditable')).toBe(false)
  })
  it('Delete in Append clears the whole cell (committed); Delete in Free is native', () => {
    mount(); focusGrid()
    key('Tab') // rate 90
    key('Delete')
    expect(activeSpan().textContent).toBe('')
    expect(stored(0).rate).toBeNull()
    key('Tab') // qty
    key('F2')
    expect(key('Delete').defaultPrevented).toBe(false)
    expect(stored(0).qty).toBe('10')
  })
  it('numeric commit normalises and updates derived cells (amount) when the cell is left', () => {
    mount(); focusGrid()
    key('Tab'); key('Delete'); key('5'); key('.'); key('Tab')
    expect(stored(0).rate).toBe('5')
    expect(span(0, 'total').textContent).toBe('50.00')
  })
  it('Sl.No (non-editable) is skipped: Shift+Tab from row 1 first cell → row 0 last cell', () => {
    mount(); focusGrid()
    key('Enter')
    key('Tab', { shiftKey: true })
    expect(activeSpan()).toBe(span(0, 'tomato'))
  })
  it('Tab past the last cell creates a trailing row and lands in its first cell', () => {
    mount()
    // Phase 80: with extra columns the rows below the items are navigable free-cell rows; this is the plain (no extra column) case.
    act(() => { useBillStore.getState().loadBill({ ...legacyGridBill(), extraCols: [] }) })
    focusGrid()
    for (let i = 0; i < 40; i++) key('ArrowDown') // clamps at the last body row
    const before = useBillStore.getState().view.bodyIds.length
    for (let i = 0; i < 12 && useBillStore.getState().view.bodyIds.length === before; i++) key('Tab')
    const ids = useBillStore.getState().view.bodyIds
    expect(ids.length).toBe(before + 1)
    expect(activeSpan()).toBe(span(before, 'name'))
    expect(host.querySelectorAll('[data-row-id]').length).toBe(before + 1)
  })
})

describe('Total override and numeric filtering', () => {
  it('Total is typable: visiting changes nothing, typing sets an override, Delete resets to auto', () => {
    mount(); focusGrid()
    key('Tab'); key('Tab'); key('Tab') // name → rate → qty → total
    expect(activeSpan()).toBe(span(0, 'total'))
    expect(activeSpan().getAttribute('contenteditable')).toBe('plaintext-only')
    const auto = activeSpan().textContent!
    key('Tab'); key('Tab', { shiftKey: true }) // leave and come back without editing
    expect(stored(0).totalOverride).toBeNull()
    key('Delete'); key('7'); key('5'); key('0'); key('Tab')
    expect(stored(0).totalOverride).toBe('750')
    expect(span(0, 'total').textContent).toBe('750.00')
    expect(rowEl(0).querySelector('[data-col="total"]')!.hasAttribute('data-override')).toBe(true)
    // go back, Delete = reset to auto
    key('Tab', { shiftKey: true })
    expect(activeSpan()).toBe(span(0, 'total'))
    key('Delete'); key('Tab')
    expect(stored(0).totalOverride).toBeNull()
    expect(span(0, 'total').textContent).toBe(auto)
    expect(rowEl(0).querySelector('[data-col="total"]')!.hasAttribute('data-override')).toBe(false)
  })
  it('numeric cell ignores letters, accepts digits and one dot', () => {
    mount(); focusGrid()
    key('Tab'); key('Delete')
    expect(key('a').defaultPrevented).toBe(true)
    key('1'); key('.'); key('5')
    expect(activeSpan().textContent).toBe('1.5')
    key('.'); key('-')
    expect(activeSpan().textContent).toBe('1.5')
  })
  it('beforeinput is the final gate: invalid numeric insert and newline are prevented; native undo is prevented', () => {
    mount(); focusGrid()
    key('Tab')
    expect(beforeInput('insertText', 'x').defaultPrevented).toBe(true)
    expect(beforeInput('insertFromPaste', '1e3').defaultPrevented).toBe(true)
    expect(beforeInput('insertParagraph', null).defaultPrevented).toBe(true)
    expect(beforeInput('historyUndo', null).defaultPrevented).toBe(true)
    expect(beforeInput('historyRedo', null).defaultPrevented).toBe(true)
    expect(beforeInput('insertText', '7').defaultPrevented).toBe(false)
  })
  it('pasted newlines in a text cell become spaces', () => {
    mount(); focusGrid()
    const t = activeSpan().textContent!
    const ev = beforeInput('insertFromPaste', 'a\nb')
    expect(ev.defaultPrevented).toBe(true)
    expect(activeSpan().textContent).toBe(t + 'a b')
  })
})

describe('Phase 12 numeric entry and Sl.No', () => {
  it('pasting "1,250" into a numeric cell inserts 1250; garbage pastes insert nothing', () => {
    mount(); focusGrid()
    key('Tab'); key('Delete')
    expect(beforeInput('insertFromPaste', '1,250').defaultPrevented).toBe(true)
    expect(activeSpan().textContent).toBe('1250')
    beforeInput('insertFromPaste', 'abc')
    expect(activeSpan().textContent).toBe('1250')
  })
  it('qty and rate reject a pasted negative; typing "-" is ignored', () => {
    mount(); focusGrid()
    key('Tab'); key('Delete')
    beforeInput('insertFromPaste', '-5')
    expect(activeSpan().textContent).toBe('')
    key('-')
    expect(activeSpan().textContent).toBe('')
  })
  it('Sl.No: a named row with qty or rate gets the next number; clearing both un-numbers it', () => {
    mount()
    const st = () => useBillStore.getState()
    const blank = st().rows.findIndex((r) => r.nameRuns.length === 0 && r.qty === null && r.rate === null)
    const id = st().rows[blank]!.id
    act(() => { st().setCellText(id, 'name', 'Widget') })
    expect(st().view.body[id]?.cells.slNo).toBe('')
    act(() => { st().setCellText(id, 'qty', '3') })
    const n = st().view.body[id]?.cells.slNo
    expect(n).not.toBe('')
    expect(Number(n)).toBeGreaterThan(0)
    act(() => { st().setCellText(id, 'qty', '') })
    expect(st().view.body[id]?.cells.slNo).toBe('')
    act(() => { st().setCellText(id, 'rate', '10') })
    expect(st().view.body[id]?.cells.slNo).toBe(n)
  })
  it('keyboard-only flow: name, Tab, rate, Tab, qty -> amount appears and the row is numbered', () => {
    mount(); focusGrid()
    const st = () => useBillStore.getState()
    const blank = st().rows.findIndex((r) => r.nameRuns.length === 0 && r.qty === null && r.rate === null)
    const id = st().rows[blank]!.id
    act(() => { st().setCellText(id, 'name', '') })
    // walk to the blank row's Item Name by repeated Down from the first cell
    for (let i = 0; i < blank; i++) key('ArrowDown')
    for (const ch of 'Nut') key(ch)
    key('Tab'); key('5'); key('0')
    key('Tab'); key('2')
    key('Tab')
    expect(st().rows[blank]!.rate).toBe('50')
    expect(st().rows[blank]!.qty).toBe('2')
    expect(st().view.body[id]?.cells.slNo).not.toBe('')
    expect(st().view.body[id]?.cells.total).toBe('100.00')
  })
})

describe('Phase 13 override, reset, incremental calc', () => {
  const st = () => useBillStore.getState()
  it('Total accepts a leading minus; qty does not', () => {
    mount(); focusGrid()
    key('Tab'); key('Tab'); key('Tab'); key('Delete')
    key('-'); key('5')
    expect(activeSpan().textContent).toBe('-5')
  })
  it('override survives a qty change; reset restores auto; footer follows', () => {
    mount()
    const id = rowId(0)
    const r0 = stored(0)
    const qty = Number(r0.qty)
    act(() => { st().setCellText(id, 'total', '1000') })
    expect(st().view.body[id]?.cells.total).toBe('1000.00')
    expect(st().view.body[id]?.override).toBe(true)
    expect(st().view.body[id]?.ovrAuto).toBeDefined()
    const grand = () => st().view.footer[st().view.footer.length - 1]!.cells.total
    const g1 = grand()
    act(() => { st().setCellText(id, 'qty', String(qty + 1)) })
    expect(st().view.body[id]?.cells.total).toBe('1000.00') // override kept
    expect(grand()).toBe(g1)
    act(() => { st().resetTotal(id) })
    expect(st().view.body[id]?.override).toBeUndefined()
    expect(st().view.body[id]?.cells.total).toBe((Number(r0.rate) * (qty + 1)).toFixed(2))
    expect(grand()).not.toBe(g1)
    expect(st().resetTotal(id)).toBe(false)
  })
  it('Ctrl+Backspace on an overridden Total resets it (and is consumed)', () => {
    mount(); focusGrid()
    act(() => { st().setCellText(rowId(0), 'total', '1000') })
    key('Tab'); key('Tab'); key('Tab')
    expect(activeSpan().textContent).toBe('1000.00')
    const ev = key('Backspace', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(stored(0).totalOverride).toBeNull()
    expect(activeSpan().textContent).not.toBe('1000.00')
  })
  it('GST format computes GST from the overridden total; format switch keeps the override', () => {
    mount()
    const id = rowId(0)
    act(() => { st().patchRow(id, { gstRate: '18' }); st().setCellText(id, 'total', '1000'); st().setFormatId('gst') })
    expect(st().view.body[id]?.cells.gstAmt).toBe('180.00')
    expect(st().view.body[id]?.cells.amount).toBe('1180.00')
    act(() => { st().setFormatId('non_gst') })
    expect(st().view.body[id]?.cells.total).toBe('1000.00')
    expect(stored(0).totalOverride).toBe('1000')
  })
  it('only the edited cell+derived cells re-render; the marker appears via the total cell only', () => {
    mount(); renderProbe.reset(); renderProbe.enabled = true
    act(() => { st().setCellText(rowId(3), 'total', '999') })
    const hit = renderProbe.cells.filter((c) => c.startsWith(rowId(3) + ':'))
    expect(hit.length).toBe(renderProbe.cells.length)
    expect(hit.length).toBeLessThanOrEqual(2)
  })
  it('context menu on an overridden Total offers reset', () => {
    mount()
    act(() => { st().setCellText(rowId(0), 'total', '1000') })
    const cell = rowEl(0).querySelector<HTMLElement>('[data-col="total"]')!
    act(() => { cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })) })
    const item = host.querySelector<HTMLButtonElement>('[role=menuitem]')!
    expect(item).toBeTruthy()
    act(() => { item.click() })
    expect(stored(0).totalOverride).toBeNull()
    expect(host.querySelector('[role=menu]')).toBeNull()
    // a non-overridden total has no menu
    act(() => { cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })) })
    expect(host.querySelector('[role=menu]')).toBeNull()
  })
})

describe('range, mouse, focus', () => {
  it('Shift+Down marks a range; Delete clears it as one update; arrival is Append', () => {
    mount(); focusGrid()
    key('Tab') // rate row 0 (90)
    key('ArrowDown', { shiftKey: true })
    expect(host.querySelectorAll('[data-in-range]').length).toBe(2)
    key('Delete')
    expect(stored(0).rate).toBeNull()
    expect(stored(1).rate).toBeNull()
    expect(host.querySelectorAll('[data-in-range]').length).toBe(0)
    expect(status()).toBe('APPEND')
  })
  it('mousedown on cell padding → Append at end; click inside the text → Free', () => {
    mount()
    const cellDiv = span(2, 'name').parentElement!
    act(() => { cellDiv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })) })
    expect(activeSpan()).toBe(span(2, 'name'))
    expect(status()).toBe('APPEND')
    expect(caretOffset(activeSpan())).toBe(span(2, 'name').textContent!.length)
    const s = span(3, 'name')
    act(() => { s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })) })
    setCaret(s, 1) // the browser would place the caret at the pointer
    act(() => { s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })) })
    expect(activeSpan()).toBe(s)
    expect(status()).toBe('EDIT')
    expect(caretOffset(s)).toBe(1)
  })
  it('focus leaving the grid commits the draft and keeps the cell active', () => {
    mount(); focusGrid()
    const base = activeSpan().textContent!
    key('Z')
    const outside = document.createElement('button'); document.body.appendChild(outside)
    act(() => { outside.focus() })
    expect(stored(0).nameRuns.map((r) => r.t).join('')).toBe(base + 'Z')
    outside.remove()
  })
  it('store updates elsewhere never clobber the cell being edited', () => {
    mount(); focusGrid()
    key('Q')
    const t = activeSpan().textContent
    act(() => { useBillStore.getState().setCellText(rowId(5), 'name', 'changed elsewhere') })
    expect(activeSpan().textContent).toBe(t)
    expect(span(5, 'name').textContent).toBe('changed elsewhere')
  })
})

describe('render budget', () => {
  it('typing in Append re-renders nothing; leaving the cell re-renders only the affected cells', () => {
    mount(); focusGrid()
    renderProbe.enabled = true; renderProbe.reset()
    key('a'); key('b'); key('c')
    expect(renderProbe.cells).toEqual([])
    expect(renderProbe.rows).toEqual([])
    key('Tab')
    expect(renderProbe.cells).toEqual([`${rowId(0)}:name`])
    expect(renderProbe.rows).toEqual([])
    expect(renderProbe.grids).toBe(0)
  })
})

describe('Phase 75 smooth arrow keys (ON, KB §11)', () => {
  beforeEach(() => { useBehaviourStore.setState({ smoothArrows: true }) })
  it('Left in Append jumps straight to the previous cell, Append at its end, no arming', () => {
    mount(); focusGrid()
    key('Tab')
    expect(activeSpan()).toBe(span(0, 'rate'))
    key('ArrowLeft')
    expect(grid().hasAttribute('data-armed')).toBe(false)
    expect(activeSpan()).toBe(span(0, 'name'))
    expect(status()).toBe('APPEND')
    expect(caretOffset(activeSpan())).toBe(activeSpan().textContent!.length)
  })
  it('F2 edit mode: Left moves a letter, Left at the very start jumps to the previous cell', () => {
    mount(); focusGrid()
    key('Tab'); key('F2')
    expect(status()).toBe('EDIT')
    const len = activeSpan().textContent!.length
    key('ArrowLeft')
    expect(activeSpan()).toBe(span(0, 'rate'))
    expect(caretOffset(activeSpan())).toBe(len - 1)
    key('Home')
    key('ArrowLeft')
    expect(activeSpan()).toBe(span(0, 'name'))
    expect(status()).toBe('APPEND')
  })
  it('F2 edit mode: Right at the very end jumps to the next cell', () => {
    mount(); focusGrid()
    key('F2')
    key('ArrowRight')
    expect(activeSpan()).toBe(span(0, 'rate'))
    expect(status()).toBe('APPEND')
  })
  it('switching the setting OFF restores arm-then-unlock on the next key', () => {
    mount(); focusGrid()
    useBehaviourStore.setState({ smoothArrows: false })
    key('ArrowLeft')
    expect(grid().hasAttribute('data-armed')).toBe(true)
    expect(activeSpan()).toBe(span(0, 'name'))
  })
})
