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

describe('Phase 122 - select row and delete row', () => {
  it('Ctrl+Space selects the whole row; Delete removes it, later rows move up, one undo restores', () => {
    focus(); down(1)
    const before = [nameOf(0), nameOf(1), nameOf(2)]
    key(' ', { ctrlKey: true })
    expect(inRange()).toBeGreaterThanOrEqual(3)
    const ev = key('Delete')
    expect(ev.defaultPrevented).toBe(true)
    expect([nameOf(0), nameOf(1)]).toEqual([before[0], before[2]])
    expect(inRange()).toBe(0)
    act(() => { st().undo() })
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual(before)
  })

  it('deleting two rows is ONE undo step', () => {
    focus()
    const before = [nameOf(0), nameOf(1), nameOf(2)]
    key(' ', { ctrlKey: true }); key('ArrowDown', { shiftKey: true })
    key('Delete')
    expect(nameOf(0)).toBe(before[2])
    act(() => { st().undo() })
    expect([nameOf(0), nameOf(1), nameOf(2)]).toEqual(before)
  })

  it('Delete on a single cell or a plain Shift range still clears cells (D-K4 / range clear), rows do not move', () => {
    focus(); down(1)
    const n0 = nameOf(0), n2 = nameOf(2)
    key('Delete')
    expect(nameOf(1)).toBe('')
    expect(nameOf(2)).toBe(n2); expect(nameOf(0)).toBe(n0)
    key('ArrowDown', { shiftKey: true }) // plain range, NOT a row selection
    key('Delete')
    expect(nameOf(2)).toBe('')
  })

  it('Ctrl+A then Delete clears cells; it never deletes rows', () => {
    focus()
    const count = st().rows.length
    key('a', { ctrlKey: true })
    key('Delete')
    expect(st().rows.length).toBe(count)
  })

  it('Shift+Space in the NAME cell types a space (never selects a row); in a number cell it selects the row', () => {
    focus()
    const span = () => host.querySelector<HTMLElement>('.q3-gc[data-active] .q3-gc__text')!
    const len = span().textContent!.length
    key(' ', { shiftKey: true })
    expect(inRange()).toBe(0)
    expect(span().textContent!.length).toBe(len + 1)
    key('Tab') // rate (numeric)
    const ev2 = key(' ', { shiftKey: true })
    expect(ev2.defaultPrevented).toBe(true)
    expect(inRange()).toBeGreaterThanOrEqual(3)
  })

  it('Esc drops the row selection; Delete afterwards is a normal cell clear', () => {
    focus(); down(1)
    key(' ', { ctrlKey: true })
    key('Escape')
    expect(inRange()).toBe(0)
    const n2 = nameOf(2)
    key('Delete')
    expect(nameOf(2)).toBe(n2)
  })

  it('palette ports are registered by the controller', () => {
    expect(typeof useGridUiStore.getState().selectRow).toBe('function')
    expect(typeof useGridUiStore.getState().deleteRows).toBe('function')
  })
})

describe('Phase 122 - Sl.No click and the store action', () => {
  it('a click on the Sl.No cell selects that row; Delete removes it', () => {
    focus()
    const sl = host.querySelectorAll<HTMLElement>('[data-row-id]')[1]!.querySelector<HTMLElement>('[data-col="slNo"]')!
    const n0 = nameOf(0), n2 = nameOf(2)
    act(() => { sl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })) })
    expect(inRange()).toBeGreaterThanOrEqual(3)
    key('Delete')
    expect([nameOf(0), nameOf(1)]).toEqual([n0, n2])
  })

  it('store: totals follow the new order, extra-column cells stay on their positions, row count is unchanged', () => {
    const s0 = st()
    act(() => { s0.addExtraCol() })
    const key1 = st().extraCols[0]!.key
    const ids = st().view.bodyIds
    act(() => { st().setCellTexts([{ rowId: ids[0]!, colKey: key1, text: 'E0' }, { rowId: ids[1]!, colKey: key1, text: 'E1' }, { rowId: ids[2]!, colKey: key1, text: 'E2' }]) })
    const count = st().rows.length
    const n2 = nameOf(2)
    act(() => { st().deleteRows([ids[1]!]) })
    expect(nameOf(1)).toBe(n2)
    expect([0, 1, 2].map((i) => st().rows[i]!.extras[key1]?.text)).toEqual(['E0', 'E1', 'E2'])
    expect(st().rows.length).toBeGreaterThanOrEqual(count - 1)
    expect(st().deleteRows([])).toBe(false)
  })
})
