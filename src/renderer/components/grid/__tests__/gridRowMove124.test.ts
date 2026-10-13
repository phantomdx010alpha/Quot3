// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); historyHooks.wrap = (_l, fn) => fn() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const st = () => useBillStore.getState()
const nameOf = (i: number) => st().rows[i]!.nameRuns.map((r) => r.t).join('')
const inRange = () => host.querySelectorAll('[data-in-range]').length
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
const focus = (): void => { act(() => { grid().focus() }) }
const down = (n: number): void => { for (let i = 0; i < n; i++) key('ArrowDown') }

const altShift = (k: string): KeyboardEvent => key(k, { altKey: true, shiftKey: true })

describe('Phase 124 - move row with Alt+Shift+Up / Down', () => {
  it('Alt+Shift+Down moves the row, the cursor follows, extras stay, ONE undo restores', () => {
    focus()
    const n = [nameOf(0), nameOf(1), nameOf(2)]
    const ruby = [0, 1, 2].map((i) => st().rows[i]!.extras['ruby']?.text ?? '')
    const ev = altShift('ArrowDown')
    expect(ev.defaultPrevented).toBe(true)
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual([n[1], n[0], n[2]])
    expect([0, 1, 2].map((i) => st().rows[i]!.extras['ruby']?.text ?? '')).toEqual(ruby)
    const active = document.activeElement as HTMLElement
    expect(active.closest('[data-row-id]')?.getAttribute('data-row-id') ?? active.getAttribute('data-row-id')).toBe(st().rows[1]!.id)
    altShift('ArrowDown') // keeps following the same item
    expect([nameOf(1), nameOf(2)]).toEqual([n[2], n[0]])
    act(() => { st().undo() })
    expect(nameOf(1)).toBe(n[0]); expect(nameOf(2)).toBe(n[2])
    act(() => { st().undo() })
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual(n)
  })
  it('Alt+Shift+Up moves it back; first row up is a notice, no history entry', () => {
    focus(); down(1)
    const n = [nameOf(0), nameOf(1)]
    altShift('ArrowUp')
    expect([nameOf(0), nameOf(1)]).toEqual([n[1], n[0]])
    altShift('ArrowUp')
    expect(st().undoLabel).toBe('Moved row to 1')
    expect(useGridUiStore.getState().notice).toMatch(/first row/)
    act(() => { st().undo() })
    expect(st().canUndo).toBe(false)
  })
  it('palette port moves the row to the top / bottom of the items', () => {
    focus(); down(2)
    const n = [nameOf(0), nameOf(1), nameOf(2)]
    act(() => { useGridUiStore.getState().moveRow?.('top') })
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual([n[2], n[0], n[1]])
    act(() => { useGridUiStore.getState().moveRow?.('bottom') })
    expect(nameOf(0)).toBe(n[0])
  })
  it('plain Alt+Down / Alt+Up are NOT row moves (party address keys)', () => {
    focus()
    const n0 = nameOf(0)
    key('ArrowDown', { altKey: true }); key('ArrowUp', { altKey: true })
    expect(nameOf(0)).toBe(n0); expect(st().canUndo).toBe(false)
  })
})
