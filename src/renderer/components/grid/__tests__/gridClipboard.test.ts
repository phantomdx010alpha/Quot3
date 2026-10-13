// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillGrid } from '../BillGrid'
import { GridStatus } from '../GridStatus'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'
import { QUOT3_GRID_MIME, serializeQuot3Payload } from '@shared/tsv/gridClip'

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
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' }) })
afterEach(() => { act(() => root.unmount()); host.remove(); historyHooks.wrap = (_l, fn) => fn() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const rowEl = (i: number) => [...host.querySelectorAll<HTMLElement>('[data-row-id]')][i]!
const cellDiv = (r: number, col: string) => rowEl(r).querySelector<HTMLElement>(`[data-col="${col}"]`)!
const span = (r: number, col: string) => cellDiv(r, col).querySelector<HTMLElement>('.q3-gc__text')!
const activeSpan = () => host.querySelector<HTMLElement>('.q3-gc[data-active] .q3-gc__text')!
const stored = (i: number) => useBillStore.getState().rows[i]!
const nameOf = (i: number) => stored(i).nameRuns.map((r) => r.t).join('')
const inRange = () => host.querySelectorAll('[data-in-range]').length
const notice = () => useGridUiStore.getState().notice

/** Record the label of every history entry opened through the Phase 17 hook point. */
function spyWrap(): string[] {
  const labels: string[] = []
  historyHooks.wrap = (label, fn) => { labels.push(label); return fn() }
  return labels
}
function focusGrid(): void { act(() => { grid().focus() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
function clip(type: 'copy' | 'cut' | 'paste', data: Record<string, string> = {}): { ev: Event; data: Record<string, string> } {
  const store: Record<string, string> = { ...data }
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
  ev.clipboardData = { getData: (t: string) => store[t] ?? '', setData: (t: string, v: string) => { store[t] = v } }
  act(() => { (document.activeElement ?? activeSpan()).dispatchEvent(ev) })
  return { ev, data: store }
}
/** Move the active cell to (row, col index in name,rate,qty,total) with the keyboard. */
function goto(row: number, col: number): void {
  for (let i = 0; i < row; i++) key('ArrowDown')
  for (let i = 0; i < col; i++) key('Tab')
}

describe('Phase 16 — paste', () => {
  it('a TSV block lands from the active cell, overwriting; consumed (not left to the browser)', () => {
    mount(); focusGrid(); goto(1, 0)
    const { ev } = clip('paste', { 'text/plain': 'Ruby\t10\t2\r\nTomato\t5\t3\r\n' })
    expect(ev.defaultPrevented).toBe(true)
    expect([nameOf(1), stored(1).rate, stored(1).qty]).toEqual(['Ruby', '10', '2'])
    expect([nameOf(2), stored(2).rate, stored(2).qty]).toEqual(['Tomato', '5', '3'])
    expect(nameOf(3)).not.toBe('Tomato')
    expect(activeSpan().textContent).toBe('Ruby') // active cell repainted from the store, Append at end
  })

  it('starting mid-row shifts columns; Amount is derived from the pasted rate × qty', () => {
    mount(); focusGrid(); goto(0, 1)
    clip('paste', { 'text/plain': '10\t2\n' + '7\t3\n' })
    expect([stored(0).rate, stored(0).qty, stored(1).rate, stored(1).qty]).toEqual(['10', '2', '7', '3'])
    expect(useBillStore.getState().view.body[stored(0).id]?.cells['total']).toBe('20.00')
  })

  it('creates new rows when the block runs past the last row; none are dropped', () => {
    mount(); focusGrid()
    const before = useBillStore.getState().rows.length
    const body = useBillStore.getState().view.bodyIds.length
    goto(body - 1, 0)
    const lines = Array.from({ length: 6 }, (_, i) => `N${i}\t${i + 1}`).join('\r\n') + '\r\n'
    clip('paste', { 'text/plain': lines })
    expect(useBillStore.getState().rows.length).toBeGreaterThanOrEqual(before + 5)
    const names = useBillStore.getState().rows.map((r) => r.nameRuns.map((x) => x.t).join('')).filter((n) => /^N\d$/.test(n))
    expect(names).toEqual(['N0', 'N1', 'N2', 'N3', 'N4', 'N5'])
  })

  it('non-numeric text for a numeric cell is rejected for that cell only and reported once', () => {
    mount(); focusGrid(); goto(1, 0)
    const oldRate = stored(1).rate
    clip('paste', { 'text/plain': 'Pearl\tabc\t4\r\nOpal\t1,250\t\r\n' })
    expect(nameOf(1)).toBe('Pearl')
    expect(stored(1).rate).toBe(oldRate) // rejected → unchanged
    expect(stored(1).qty).toBe('4')
    expect(stored(2).rate).toBe('1250') // commas tolerated
    expect(stored(2).qty).toBeNull() // blank clears
    expect(notice()).toContain('1 cell not pasted')
    expect(host.querySelector('.q3-gstatus')!.textContent).toContain('not a number')
    key('ArrowDown')
    expect(notice()).toBe('') // cleared on the next key
  })

  it('a single value with no range is left to the browser (native text paste)', () => {
    mount(); focusGrid()
    expect(clip('paste', { 'text/plain': 'just text' }).ev.defaultPrevented).toBe(false)
    expect(clip('paste', { 'text/plain': 'two\nlines' }).ev.defaultPrevented).toBe(false) // not recognisably TSV
  })

  it('a single value onto a selected range fills the whole range; paste with a bigger block uses the range top-left', () => {
    mount(); focusGrid(); goto(0, 1)
    key('ArrowDown', { shiftKey: true }); key('ArrowDown', { shiftKey: true })
    expect(inRange()).toBe(3)
    clip('paste', { 'text/plain': '9' })
    expect([stored(0).rate, stored(1).rate, stored(2).rate]).toEqual(['9', '9', '9'])
    expect(inRange()).toBe(0)
    key('Tab', { shiftKey: true }) // back to the name column, row 0
    key('ArrowDown', { shiftKey: true })
    clip('paste', { 'text/plain': 'A\t1\nB\t2\n' })
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual(['A', 'B', 'talco 2044'])
  })

  it('the whole paste is ONE history entry (hook point for Phase 17)', () => {
    mount(); focusGrid()
    const labels = spyWrap()
    clip('paste', { 'text/plain': 'a\t1\t2\nb\t3\t4\nc\t5\t6\n' })
    expect(labels).toEqual(['Paste'])
  })

  it('Quot3 flavour keeps item-name formatting; plain TSV does not', () => {
    mount(); focusGrid()
    const runs = [{ t: 'Hot ', r: 1 as const, b: 1 as const }, { t: 'dog' }]
    clip('paste', { 'text/plain': 'Hot dog\t5\n', [QUOT3_GRID_MIME]: serializeQuot3Payload([[{ text: 'Hot dog', runs }, { text: '5' }]]) })
    expect(stored(0).nameRuns).toEqual(runs)
    goto(3, 0)
    clip('paste', { 'text/plain': 'Hot dog\t5\n' })
    expect(stored(3).nameRuns).toEqual([{ t: 'Hot dog' }])
  })

  it('palette paste reads the OS clipboard through clipboard:readGrid', async () => {
    mount(); focusGrid()
    const readGrid = vi.fn(async () => ({ ok: true as const, data: { tsv: 'Z1\t8\r\nZ2\t9\r\n' } }))
    ;(window as unknown as { quot3: unknown }).quot3 = { clipboard: { readGrid } }
    await act(async () => { useGridUiStore.getState().paste?.() })
    expect(readGrid).toHaveBeenCalledTimes(1)
    expect([nameOf(0), stored(0).rate, nameOf(1), stored(1).rate]).toEqual(['Z1', '8', 'Z2', '9'])
    delete (window as unknown as { quot3?: unknown }).quot3
  })
})

describe('Phase 16 — copy / cut', () => {
  it('copy of a Shift-range writes TSV (Excel-ready) and the Quot3 flavour; the range stays', () => {
    mount(); focusGrid(); goto(0, 0)
    key('ArrowDown', { shiftKey: true })
    const { ev, data } = clip('copy')
    expect(ev.defaultPrevented).toBe(true)
    const rows = data['text/plain']!.split('\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(nameOf(0))
    const q = JSON.parse(data[QUOT3_GRID_MIME]!)
    expect(q.v).toBe(1)
    expect(q.cells).toHaveLength(2)
    expect(inRange()).toBe(2)
  })

  it('copy in Append with no range copies the whole active cell; Free mode is left to the browser', () => {
    mount(); focusGrid()
    const { ev, data } = clip('copy')
    expect(ev.defaultPrevented).toBe(true)
    expect(data['text/plain']).toBe(nameOf(0))
    key('F2') // Free
    expect(clip('copy').ev.defaultPrevented).toBe(false)
    expect(clip('cut').ev.defaultPrevented).toBe(false)
  })

  it('a copied name with formatting round-trips through the Quot3 flavour', () => {
    mount(); focusGrid()
    key('R', { ctrlKey: true, shiftKey: true }) // whole cell red+bold
    const { data } = clip('copy')
    goto(2, 0)
    clip('paste', { 'text/plain': data['text/plain']! + '\t\n', [QUOT3_GRID_MIME]: data[QUOT3_GRID_MIME]! })
    expect(stored(2).nameRuns).toEqual(stored(0).nameRuns)
    expect(stored(2).nameRuns[0]?.r).toBe(1)
  })

  it('copy reports the live draft of the active cell, including uncommitted typing', () => {
    mount(); focusGrid()
    key('!') // Append typing, not committed yet
    const { data } = clip('copy')
    expect(data['text/plain']).toBe(nameOf(0) + '!')
  })

  it('cut writes the clipboard, clears the range as ONE entry, and arrival is Append', () => {
    mount(); focusGrid(); goto(0, 1)
    key('ArrowDown', { shiftKey: true })
    const was = [stored(0).rate, stored(1).rate]
    const labels = spyWrap()
    const { ev, data } = clip('cut')
    expect(ev.defaultPrevented).toBe(true)
    expect(data['text/plain']).toBe(`${was[0]}\r\n${was[1]}`)
    expect([stored(0).rate, stored(1).rate]).toEqual([null, null])
    expect(inRange()).toBe(0)
    expect(labels).toEqual(['Cut'])
    expect(document.querySelector('[data-mode]')?.getAttribute('data-mode')).toBe('append')
  })

  it('Delete on a range is one history entry too', () => {
    mount(); focusGrid(); goto(0, 1)
    key('ArrowDown', { shiftKey: true })
    const labels = spyWrap()
    key('Delete')
    expect(labels).toEqual(['Clear cells'])
    expect([stored(0).rate, stored(1).rate]).toEqual([null, null])
  })
})

describe('Phase 16 — mouse range', () => {
  const down = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 })) })
  const move = (el: Element, buttons = 1) => act(() => { el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons })) })
  const up = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })) })

  it('dragging from one cell to another selects the rectangle; the drag cell stays the active anchor', () => {
    mount(); focusGrid()
    down(span(1, 'name')); move(span(1, 'name')); move(span(3, 'rate'))
    expect(inRange()).toBe(6) // rows 1-3 × name,rate
    expect(cellDiv(1, 'name').hasAttribute('data-active')).toBe(true)
    expect(cellDiv(3, 'rate').hasAttribute('data-in-range')).toBe(true)
    up(span(3, 'rate'))
    expect(inRange()).toBe(6) // survives mouseup (no click-to-Free collapse)
    expect(grid().classList.contains('q3-grid--dragging')).toBe(false)
  })

  it('dragging back onto the anchor cancels the range; moving without the button does nothing', () => {
    mount(); focusGrid()
    down(span(1, 'name')); move(span(2, 'name'))
    expect(inRange()).toBe(2)
    move(span(1, 'name'))
    expect(inRange()).toBe(0)
    up(span(1, 'name'))
    move(span(4, 'qty'), 0)
    expect(inRange()).toBe(0)
  })

  it('a mouse range then Delete clears it; a plain click still goes to Free', () => {
    mount(); focusGrid()
    down(cellDiv(0, 'rate')); move(cellDiv(0, 'rate')); move(cellDiv(1, 'qty')); up(cellDiv(1, 'qty'))
    expect(inRange()).toBe(4)
    key('Delete')
    expect([stored(0).rate, stored(0).qty, stored(1).rate, stored(1).qty]).toEqual([null, null, null, null])
    down(span(2, 'name')); up(span(2, 'name'))
    expect(inRange()).toBe(0)
  })

  it('a mouse range can be copied', () => {
    mount(); focusGrid()
    down(span(0, 'name')); move(span(1, 'rate')); up(span(1, 'rate'))
    const { data } = clip('copy')
    expect(data['text/plain']!.split('\r\n')).toHaveLength(2)
    expect(data['text/plain']!.split('\r\n')[0]!.split('\t')).toHaveLength(2)
  })
})
