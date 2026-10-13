// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { ExtraColsToolbar } from '../../create/ExtraColsToolbar'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useExtraColUiStore } from '../../../stores/extraColUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()
function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement('div', null, createElement(ExtraColsToolbar), createElement(BillGrid))
}
beforeEach(() => {
  historyHooks.now = () => 9_000_000
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  useExtraColUiStore.setState({ renameKey: null, removeKey: null, units: null })
  act(() => { S().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Shell)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

function key(k: string, m: Partial<KeyboardEventInit> = {}, target: Element = document.body): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { target.dispatchEvent(ev) })
  return ev
}
const popup = () => document.querySelector<HTMLElement>('.q3-units')?.textContent ?? null

describe('Phase 22 — units summary, Mark, marked calculations', () => {
  it('Ctrl+U shows ruby = 12 and tomato = 7 (legacy fixture); Esc closes', () => {
    expect(key('u', { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Units summary')
    expect(popup()).toBe('Column: ruby\n  ruby = 12\nColumn: tomato\n  tomato = 7')
    key('Escape', {}, document.querySelector('[role=dialog]')!)
    expect(popup()).toBeNull()
  })

  it('Ctrl+Shift+M shows idk bruhh = 55 under ruby; tomato has no marks', () => {
    key('m', { ctrlKey: true, shiftKey: true })
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Marked calculations')
    expect(popup()).toBe('Column: ruby\n  idk bruhh = 55')
  })

  it('the marked cell is shown with data-marked; Ctrl+M on another cell marks it, popups recompute live, undo reverts', () => {
    expect(host.querySelectorAll('.q3-gc[data-marked]')).toHaveLength(1)
    const ruby = S().extraCols[0]!.key
    const id = S().view.bodyIds[15]! // '25651-45' (row 16)
    act(() => { S().setCellText(id, ruby, 'second') }) // becomes a label-only cell (no number) ...
    act(() => { useGridUiStore.setState({ notice: '' }) })
    act(() => { S().toggleMark(id, ruby) })
    expect(S().rows.find((r) => r.id === id)!.extras[ruby]).toEqual({ text: 'second', marked: true })
    expect(S().undoLabel).toMatch(/^Marked cell in ruby \(row 16\)/)
    expect(host.querySelectorAll('.q3-gc[data-marked]')).toHaveLength(2)
    key('m', { ctrlKey: true, shiftKey: true })
    expect(popup()).toBe('Column: ruby\n  idk bruhh = 5\n  second = 5') // 25-5 stays under idk bruhh; 42-5 now under second
    act(() => { S().setCellText(S().view.bodyIds[16]!, ruby, '42-9') }) // live recompute while open
    expect(popup()).toContain('second = 9')
    act(() => { S().undo(); S().undo(); S().undo() }) // 42-9, mark, 'second'
    expect(popup()).toBe('Column: ruby\n  idk bruhh = 55')
  })

  it('unmark merges the segment back; an empty unmarked cell is dropped; marking a non-extra cell does nothing', () => {
    const ruby = S().extraCols[0]!.key
    const marked = S().rows.find((r) => r.extras[ruby]?.marked)!
    act(() => { expect(S().toggleMark(marked.id, ruby)).toBe(false) })
    expect(S().rows.find((r) => r.id === marked.id)!.extras[ruby]).toEqual({ text: 'idk bruhh' })
    act(() => { S().toggleMark(S().view.bodyIds[0]!, 'name') })
    expect(S().undoLabel).toMatch(/^Unmarked/)
    const blank = S().view.bodyIds[12]!
    act(() => { S().toggleMark(blank, ruby); S().toggleMark(blank, ruby) })
    expect(ruby in S().rows.find((r) => r.id === blank)!.extras).toBe(false)
  })

  it('empty states are explained; Ctrl+C copies the shown text', () => {
    act(() => { S().removeExtraCol('tomato'); S().removeExtraCol('ruby') })
    key('u', { ctrlKey: true })
    expect(popup()).toContain('No extra columns')
    act(() => { useExtraColUiStore.getState().closeUnits(); S().undo(); S().undo() })
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { copied = t; return Promise.resolve() } }, configurable: true })
    key('u', { ctrlKey: true })
    key('c', { ctrlKey: true }, document.querySelector('.q3-units')!)
    expect(copied).toBe('Column: ruby\n  ruby = 12\nColumn: tomato\n  tomato = 7')
  })
})
