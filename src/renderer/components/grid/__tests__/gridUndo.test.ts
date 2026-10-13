// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { GridStatus } from '../GridStatus'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let clock = 0

function mount(): void {
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement('div', null, createElement(BillGrid), createElement(GridStatus))) })
}
beforeEach(() => { clock = 5_000_000; historyHooks.now = () => clock; useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' }) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const activeSpan = () => host.querySelector<HTMLElement>('.q3-gc[data-active] .q3-gc__text')!
const activeCell = () => host.querySelector<HTMLElement>('.q3-gc[data-active]')!
const stored = (i: number) => useBillStore.getState().rows[i]!
const nameOf = (i: number) => stored(i).nameRuns.map((r) => r.t).join('')
const S = () => useBillStore.getState()
function focusGrid(): void { act(() => { grid().focus() }) }
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
const typeText = (t: string): void => { for (const ch of t) key(ch) }
const undoKey = () => key('z', { ctrlKey: true })
const redoKey = () => key('y', { ctrlKey: true })
const activeAt = (): [string | undefined, string | undefined] => [activeCell()?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId, activeCell()?.dataset.col]

describe('Phase 17 — Ctrl+Z / Ctrl+Y in the grid', () => {
  it('Ctrl+Z undoes a committed edit, is consumed, and the cell is repainted; Ctrl+Y redoes', () => {
    mount(); focusGrid()
    const orig = nameOf(0)
    typeText('ZZ')            // Append typing in the first cell (Item Name)
    key('Tab')                // commit on leave
    expect(nameOf(0)).toBe(orig + 'ZZ')
    const ev = undoKey()
    expect(ev.defaultPrevented).toBe(true)
    expect(nameOf(0)).toBe(orig)
    expect(activeSpan().textContent).toBe(orig)
    redoKey()
    expect(nameOf(0)).toBe(orig + 'ZZ')
    expect(activeSpan().textContent).toBe(orig + 'ZZ')
  })

  it('Ctrl+Shift+Z is redo too', () => {
    mount(); focusGrid()
    typeText('Q'); key('Tab')
    undoKey()
    const ev = key('z', { ctrlKey: true, shiftKey: true })
    expect(ev.defaultPrevented).toBe(true)
    expect(nameOf(0).endsWith('Q')).toBe(true)
  })

  it('an uncommitted draft is committed first, so one Ctrl+Z removes what was just typed', () => {
    mount(); focusGrid()
    const orig = nameOf(0)
    typeText('abc')           // still a draft in the DOM, not committed
    expect(nameOf(0)).toBe(orig)
    undoKey()
    expect(nameOf(0)).toBe(orig)
    expect(activeSpan().textContent).toBe(orig) // draft gone, not re-applied
    expect(S().canRedo).toBe(true)
    redoKey()
    expect(nameOf(0)).toBe(orig + 'abc')
  })

  it('undo restores the cell that was edited, in Append mode, wherever the cursor is now', () => {
    mount(); focusGrid()
    key('Tab'); key('Tab')    // name → rate → qty
    const before = activeAt()
    typeText('7'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown')
    expect(activeAt()).not.toEqual(before)
    undoKey()
    expect(activeAt()).toEqual(before)
    expect(host.querySelector('.q3-grid')!.getAttribute('data-mode') ?? grid().dataset.mode).toBe('append')
    expect(activeSpan().getAttribute('contenteditable')).toBe('plaintext-only')
  })

  it('a multi-cell range clear is one entry and one Ctrl+Z restores every cell', () => {
    mount(); focusGrid()
    const names = [0, 1, 2].map(nameOf)
    key('ArrowDown', { shiftKey: true }); key('ArrowDown', { shiftKey: true })
    expect(host.querySelectorAll('[data-in-range]').length).toBe(3)
    key('Delete')
    expect([0, 1, 2].map(nameOf)).toEqual(['', '', ''])
    expect(S().historyList().filter((e) => e.label === 'Clear cells')).toHaveLength(1)
    undoKey()
    expect([0, 1, 2].map(nameOf)).toEqual(names)
  })

  it('the status line reports Undone / Redone and Nothing to undo', () => {
    mount(); focusGrid()
    undoKey()
    expect(useGridUiStore.getState().notice).toBe('Nothing to undo')
    typeText('Z'); key('Tab'); key('Escape') // (Escape in Append bubbles; harmless here)
    undoKey()
    expect(useGridUiStore.getState().notice).toMatch(/^Undone: Typed in Item Name/)
    redoKey()
    expect(useGridUiStore.getState().notice).toMatch(/^Redone: Typed in Item Name/)
  })

  it('native browser undo stays suppressed (one undo system)', () => {
    mount(); focusGrid()
    const ev = new Event('beforeinput', { bubbles: true, cancelable: true }) as Event & { inputType: string }
    ev.inputType = 'historyUndo'
    act(() => { activeSpan().dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Total override and its reset undo through the grid; dirty clears when back at the saved state', () => {
    mount(); focusGrid()
    expect(S().dirty).toBe(false)
    key('Tab'); key('Tab'); key('Tab')  // → Total
    key('Delete'); typeText('999'); key('Tab') // Append types at the END, so clear the shown auto value first
    expect(stored(0).totalOverride).toBe('999')
    expect(S().dirty).toBe(true)
    undoKey()
    expect(stored(0).totalOverride).toBeNull()
    expect(S().dirty).toBe(false)
  })

  it('the history port is released when the grid unmounts', () => {
    mount(); focusGrid()
    expect(historyHooks.selection).not.toBeNull()
    act(() => root.unmount())
    expect(historyHooks.selection).toBeNull()
    root = createRoot(host) // so afterEach can unmount cleanly
  })
})
