// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { GridStatus } from '../GridStatus'
import { renderProbe } from '../renderProbe'
import { caretOffset, selectionOffsets, setCaret, setSelectionRange } from '../gridDom'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'
import { FormatToolbar } from '../../create/FormatToolbar'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function mount(): void {
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement('div', null, createElement(BillGrid), createElement(GridStatus), createElement(FormatToolbar))) })
}
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false }) })
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


const runsOf = (i: number) => stored(i).nameRuns
const nameKey = (k: string, m: Partial<KeyboardEventInit> = {}) => key(k, m)

describe('Phase 15 — rich-text formatting in name cells', () => {
  it('Ctrl+Shift+R with no selection (Append) makes the whole cell red+bold, consumed, and paints styled spans', () => {
    mount(); focusGrid()
    const plainTxt = activeSpan().textContent!
    const ev = nameKey('R', { ctrlKey: true, shiftKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(runsOf(0)).toEqual([{ t: plainTxt, b: 1, r: 1 }])
    const sp = activeSpan().querySelector('.q3-run')!
    expect(sp.getAttribute('data-r')).toBe('1'); expect(sp.getAttribute('data-b')).toBe('1')
    expect(activeSpan().textContent).toBe(plainTxt)
    expect(caretOffset(activeSpan())).toBe(plainTxt.length) // caret unchanged, still Append
    expect(status()).toBe('APPEND')
  })
  it('select a word in Free mode → Ctrl+Shift+R styles only that word; selection and mode are kept', () => {
    mount(); focusGrid()
    const txt = activeSpan().textContent!
    key('F2')
    setSelectionRange(activeSpan(), 0, 3)
    nameKey('R', { ctrlKey: true, shiftKey: true })
    expect(runsOf(0)[0]).toEqual({ t: txt.slice(0, 3), b: 1, r: 1 })
    expect(runsOf(0).map((r) => r.t).join('')).toBe(txt)
    expect(selectionOffsets(activeSpan())).toEqual({ start: 0, end: 3 })
    expect(status()).toBe('EDIT')
    // second press toggles back
    nameKey('R', { ctrlKey: true, shiftKey: true })
    expect(runsOf(0)).toEqual([{ t: txt }])
  })
  it('Ctrl+B bold, Ctrl+H highlight (whole cell), Ctrl+Shift+C clear', () => {
    mount(); focusGrid()
    nameKey('b', { ctrlKey: true })
    expect(runsOf(0)[0]).toMatchObject({ b: 1 })
    nameKey('h', { ctrlKey: true })
    expect(runsOf(0)[0]).toMatchObject({ b: 1, hl: 1 })
    expect(activeSpan().querySelector('.q3-run')!.getAttribute('data-hl')).toBe('1')
    nameKey('C', { ctrlKey: true, shiftKey: true })
    expect(runsOf(0).every((r) => !r.b && !r.r && !r.hl)).toBe(true)
    expect(activeSpan().querySelector('.q3-run')).toBeNull()
  })
  it('formatting survives leaving the cell and is shown in the display (non-editing) span', () => {
    mount(); focusGrid()
    nameKey('R', { ctrlKey: true, shiftKey: true })
    key('Tab')
    const s = span(0, 'name')
    expect(s.querySelector('.q3-run[data-r]')).not.toBeNull()
    expect(s.textContent).toBe(runsOf(0).map((r) => r.t).join(''))
  })
  it('typing at the end of a styled name keeps the style (Append) and commits the diff', () => {
    mount(); focusGrid()
    const txt = activeSpan().textContent!
    nameKey('R', { ctrlKey: true, shiftKey: true })
    key('!')
    expect(activeSpan().textContent).toBe(txt + '!')
    key('Tab')
    expect(runsOf(0)).toEqual([{ t: txt + '!', b: 1, r: 1 }])
  })
  it('a mid-text native edit keeps formatting on both sides (diff into runs)', () => {
    mount(); focusGrid()
    const txt = activeSpan().textContent!
    key('F2'); setSelectionRange(activeSpan(), 0, 2)
    nameKey('R', { ctrlKey: true, shiftKey: true }) // [0,2) styled
    // simulate a native insertion of "ZZ" at offset 5 by editing the text node
    const tn = activeSpan().lastChild as Text
    tn.data = tn.data.slice(0, tn.data.length - 1) + 'ZZ' + tn.data.slice(tn.data.length - 1)
    key('Tab')
    const out = runsOf(0)
    expect(out[0]).toEqual({ t: txt.slice(0, 2), b: 1, r: 1 })
    expect(out.map((r) => r.t).join('')).toBe(txt.slice(0, -1) + 'ZZ' + txt.slice(-1))
  })
  it('formatting keys are ignored (but consumed) in numeric cells', () => {
    mount(); focusGrid(); key('Tab') // rate
    const ev = nameKey('b', { ctrlKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(span(0, 'rate').querySelector('.q3-run')).toBeNull()
    expect(runsOf(0).some((r) => r.b)).toBe(false)
  })
  it('caret behaviour intact: arrows/Tab still work after formatting', () => {
    mount(); focusGrid()
    nameKey('b', { ctrlKey: true })
    key('Tab'); expect(activeSpan()).toBe(span(0, 'rate'))
    key('Tab', { shiftKey: true }); expect(activeSpan()).toBe(span(0, 'name'))
    key('ArrowDown'); expect(activeSpan()).toBe(span(1, 'name'))
  })
  it('Ctrl+Shift+K opens the palette; Down/Enter picks; focus returns to the cell with formatting applied', () => {
    mount(); focusGrid()
    const ev = nameKey('K', { ctrlKey: true, shiftKey: true })
    expect(ev.defaultPrevented).toBe(true)
    const pal = host.querySelector<HTMLElement>('.q3-fmtpal')!
    expect(pal).not.toBeNull()
    const items = pal.querySelectorAll<HTMLButtonElement>('button')
    expect(items.length).toBe(5)
    expect(document.activeElement).toBe(items[0])
    // grid keys inside the palette must NOT move the grid cell
    act(() => { items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })) })
    expect(document.activeElement).toBe(items[1])
    expect(activeSpan()).toBe(span(0, 'name'))
    act(() => { items[1]!.click() }) // Bold
    expect(host.querySelector('.q3-fmtpal')).toBeNull()
    expect(runsOf(0)[0]).toMatchObject({ b: 1 })
    expect(runsOf(0)[0]!.r).toBeUndefined()
    expect(document.activeElement).toBe(activeSpan())
  })
  it('palette: number key picks plain Red (3); Esc closes without formatting and without going Back', () => {
    mount(); focusGrid()
    nameKey('K', { ctrlKey: true, shiftKey: true })
    const pal = host.querySelector<HTMLElement>('.q3-fmtpal')!
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { pal.querySelector('button')!.dispatchEvent(esc) })
    expect(esc.defaultPrevented).toBe(true)
    expect(host.querySelector('.q3-fmtpal')).toBeNull()
    expect(runsOf(0).some((r) => r.r || r.b)).toBe(false)
    nameKey('K', { ctrlKey: true, shiftKey: true })
    act(() => { host.querySelector('.q3-fmtpal button')!.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true })) })
    expect(runsOf(0)[0]).toMatchObject({ r: 1 })
    expect(runsOf(0)[0]!.b).toBeUndefined()
  })
  it('palette applies to the selection captured when it opened (Free mode word)', () => {
    mount(); focusGrid()
    const txt = activeSpan().textContent!
    key('F2'); setSelectionRange(activeSpan(), 0, 2)
    nameKey('K', { ctrlKey: true, shiftKey: true })
    act(() => { host.querySelector<HTMLButtonElement>('.q3-fmtpal button')!.click() }) // Red+Bold
    expect(runsOf(0)[0]).toEqual({ t: txt.slice(0, 2), b: 1, r: 1 })
    expect(selectionOffsets(activeSpan())).toEqual({ start: 0, end: 2 })
  })
  it('toolbar buttons format the active cell without stealing focus', () => {
    mount(); focusGrid()
    const btn = host.querySelector<HTMLButtonElement>('[aria-label="Red + Bold"]')!
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => { btn.dispatchEvent(md) })
    expect(md.defaultPrevented).toBe(true)
    act(() => { btn.click() })
    expect(runsOf(0)[0]).toMatchObject({ b: 1, r: 1 })
    expect(document.activeElement).toBe(activeSpan())
    act(() => { host.querySelector<HTMLButtonElement>('[aria-label="Clear formatting"]')!.click() })
    expect(runsOf(0).some((r) => r.b || r.r)).toBe(false)
  })
  it('formatting does not re-render other cells (only the formatted name cell)', () => {
    mount(); focusGrid()
    renderProbe.reset(); renderProbe.enabled = true
    nameKey('b', { ctrlKey: true })
    const touched = renderProbe.cells.slice()
    expect(touched.every((c) => c.endsWith(':name'))).toBe(true)
    expect(touched.length).toBeLessThanOrEqual(1)
    expect(renderProbe.grids).toBe(0)
  })
})
