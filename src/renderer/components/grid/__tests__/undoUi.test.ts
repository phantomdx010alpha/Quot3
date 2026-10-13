// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { BottomBar } from '../../create/BottomBar'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useUndoUiStore } from '../../../stores/undoUiStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let clock = 0
const S = () => useBillStore.getState()

function Shell(): React.JSX.Element {
  useHotkeys([], useAppActions())
  return createElement('div', null, createElement(BillGrid), createElement(BottomBar))
}
function mount(): void {
  act(() => { S().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Shell)) })
}
beforeEach(() => {
  clock = 7_000_000
  historyHooks.now = () => clock
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' })
  useUndoUiStore.setState({ panelOpen: false, revertOpen: false })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? document.body).dispatchEvent(ev) })
  return ev
}
const typeText = (t: string): void => { for (const ch of t) key(ch) }
/** Three separate committed edits (pause > 1 s between them so nothing coalesces). */
function threeEdits(): void {
  act(() => { grid().focus() })
  typeText('A'); key('Tab'); clock += 2000
  typeText('1'); key('Tab'); clock += 2000
  typeText('2'); key('Tab'); clock += 2000
}
const btn = (label: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('.q3-bbar button')].find((b) => label.test(b.getAttribute('aria-label') ?? ''))!
const panel = () => document.querySelector<HTMLElement>('.q3-upanel')
const panelRows = () => [...document.querySelectorAll<HTMLButtonElement>('.q3-upanel__row')]
const notice = () => useGridUiStore.getState().notice

describe('Phase 18 — bottom bar buttons', () => {
  it('Undo/Redo are disabled on a fresh bill and tooltips say there is nothing to do', () => {
    mount()
    expect(btn(/Nothing to undo/).disabled).toBe(true)
    expect(btn(/Nothing to redo/).disabled).toBe(true)
    expect(btn(/Revert to last saved/).disabled).toBe(true)
    expect(host.ownerDocument.querySelector('.q3-bbar .q3-badge')).toBeNull()
  })
  it('after an edit Undo is enabled, its label names the next action; click undoes, then Redo works', () => {
    mount(); act(() => { grid().focus() })
    typeText('Z'); key('Tab')
    const undoBtn = btn(/^Undo: /)
    expect(undoBtn.disabled).toBe(false)
    expect(undoBtn.getAttribute('aria-label')).toBe(`Undo: ${S().undoLabel}`)
    expect(document.querySelector('.q3-bbar .q3-badge')?.textContent).toBe('Unsaved changes')
    act(() => { undoBtn.click() })
    expect(S().canUndo).toBe(false)
    expect(notice()).toMatch(/^Undone: /)
    expect(btn(/^Redo: /).disabled).toBe(false)
    act(() => { btn(/^Redo: /).click() })
    expect(S().canUndo).toBe(true)
    expect(notice()).toMatch(/^Redone: /)
  })
  it('buttons do not steal focus (mousedown is prevented)', () => {
    mount()
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => { btn(/Undo history/).dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
  })
})

describe('Phase 18 — history panel', () => {
  it('Ctrl+Shift+H opens it with labelled entries newest first + original state; Esc closes (and is consumed)', () => {
    mount(); threeEdits()
    expect(panel()).toBeNull()
    key('H', { ctrlKey: true, shiftKey: true })
    expect(panel()).not.toBeNull()
    const rows = panelRows()
    expect(rows).toHaveLength(4)
    expect(rows[0]!.dataset.state).toBe('current')
    expect(rows[3]!.textContent).toContain('Original state')
    expect(rows[0]!.textContent).toBe(`${S().historyList()[2]!.label}${rows[0]!.querySelector('.q3-upanel__meta')!.textContent}`)
    expect(document.activeElement).toBe(rows[0])        // focus lands on the current state
    const esc = key('Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(panel()).toBeNull()
  })
  it('Ctrl+Shift+H again toggles it closed; the same key does not run Highlight (Ctrl+H)', () => {
    mount(); threeEdits()
    key('H', { ctrlKey: true, shiftKey: true })
    key('H', { ctrlKey: true, shiftKey: true })
    expect(panel()).toBeNull()
  })
  it('Up/Down move between entries; Enter jumps to that state, the redo entries stay and are marked undone', () => {
    mount(); threeEdits()
    const finalRows = JSON.stringify(S().rows.map((r) => r.id))
    key('H', { ctrlKey: true, shiftKey: true })
    key('ArrowDown'); key('ArrowDown')                   // current → 2nd older → oldest entry (index 0)
    expect((document.activeElement as HTMLElement).dataset.index).toBe('0')
    key('Enter')
    expect(S().historyCursor()).toBe(1)
    expect(S().canRedo).toBe(true)
    expect(notice()).toMatch(/^Jumped to: /)
    const rows = panelRows()
    expect(rows.map((r) => r.dataset.state)).toEqual(['undone', 'undone', 'current', 'applied'])
    expect((document.activeElement as HTMLElement).dataset.current).toBe('1') // keyboard focus stays in the panel
    expect(panel()).not.toBeNull()
    // jump back to the newest through the panel → redo everything
    key('Home'); key('Enter')
    expect(S().historyCursor()).toBe(3)
    expect(S().canRedo).toBe(false)
    expect(JSON.stringify(S().rows.map((r) => r.id))).toBe(finalRows)
  })
  it('jumping to the original state restores the opened bill; clicking a row works too', () => {
    mount()
    const orig = JSON.stringify(S().rows.map((r) => [r.nameRuns, r.qty, r.rate]))
    threeEdits()
    key('H', { ctrlKey: true, shiftKey: true })
    act(() => { panelRows()[3]!.click() })
    expect(S().historyCursor()).toBe(0)
    expect(JSON.stringify(S().rows.map((r) => [r.nameRuns, r.qty, r.rate]))).toBe(orig)
    expect(S().dirty).toBe(false)
    expect(notice()).toBe('Jumped to the original state')
    act(() => { panelRows()[0]!.click() })
    expect(S().historyCursor()).toBe(3)
  })
  it('closing returns focus to the grid', () => {
    mount(); threeEdits()
    key('H', { ctrlKey: true, shiftKey: true })
    key('Escape')
    expect(grid().contains(document.activeElement)).toBe(true)
  })
})

describe('Phase 18 — revert to last saved (Ctrl+Alt+Z)', () => {
  it('on a clean bill it only reports there is nothing to revert; no dialog', () => {
    mount(); act(() => { grid().focus() })
    key('z', { ctrlKey: true, altKey: true })
    expect(useUndoUiStore.getState().revertOpen).toBe(false)
    expect(notice()).toMatch(/Nothing to revert/)
  })
  it('asks first (Cancel changes nothing), Confirm reverts as ONE undoable entry and clears dirty', () => {
    mount(); threeEdits()
    const edited = JSON.stringify(S().rows)
    const entries = S().historyList().length
    key('z', { ctrlKey: true, altKey: true })
    expect(useUndoUiStore.getState().revertOpen).toBe(true)
    expect(document.querySelector('[role=dialog][aria-modal=true]')).not.toBeNull()
    key('Escape')                                          // cancel
    expect(useUndoUiStore.getState().revertOpen).toBe(false)
    expect(JSON.stringify(S().rows)).toBe(edited)
    expect(S().dirty).toBe(true)

    key('z', { ctrlKey: true, altKey: true })
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find((b) => b.textContent === 'Revert')!
    act(() => { confirm.click() })
    expect(S().dirty).toBe(false)
    expect(S().historyList()).toHaveLength(entries + 1)    // the revert is one entry
    expect(S().undoLabel).toBe('Reverted to last saved')
    expect(S().rows.slice(0, 5).map((r) => r.qty)).toEqual(legacyGridBill().rows.slice(0, 5).map((r) => r.qty))
    // itself undoable
    act(() => { S().undo() })
    expect(S().dirty).toBe(true)
    expect(JSON.stringify(S().rows.filter((r) => r.qty !== null || r.nameRuns.length))).toBe(JSON.stringify(JSON.parse(edited).filter((r: { qty: unknown; nameRuns: unknown[] }) => r.qty !== null || r.nameRuns.length)))
  })
  it('Ctrl+Alt+Z is NOT treated as a plain undo by the grid', () => {
    mount(); act(() => { grid().focus() })
    typeText('Q'); key('Tab')
    const before = S().historyList().length
    key('z', { ctrlKey: true, altKey: true })
    expect(S().historyList()).toHaveLength(before)
    expect(S().canRedo).toBe(false)                        // nothing was undone
  })
  it('the history panel and revert key are ignored while the revert prompt is open', () => {
    mount(); threeEdits()
    key('z', { ctrlKey: true, altKey: true })
    key('H', { ctrlKey: true, shiftKey: true })
    expect(panel()).toBeNull()
  })
})

describe('Phase 18 — registration hook for later phases (recordChange)', () => {
  it('a mutation made through recordChange is ONE labelled entry, shows in the panel and undoes', () => {
    mount()
    const n0 = S().extraCols.length
    act(() => { S().recordChange('Picked party \'Zakers Clothing\'', () => useBillStore.setState({ extraCols: [{ id: 'x1', key: 'x1', header: 'ruby' }] as never })) })
    expect(S().undoLabel).toBe('Picked party \'Zakers Clothing\'')
    expect(S().extraCols).toHaveLength(1)
    act(() => { key('H', { ctrlKey: true, shiftKey: true }) })
    expect(panelRows()[0]!.textContent).toContain('Picked party')
    act(() => { S().undo() })
    expect(S().extraCols).toHaveLength(n0)
  })
  it('repeated calls with the same key inside the window coalesce', () => {
    mount()
    const set = (h: string) => useBillStore.setState({ extraCols: [{ id: 'x1', key: 'x1', header: h }] as never })
    act(() => { S().recordChange('Renamed column', () => set('r'), 'rename:x1') })
    clock += 200
    act(() => { S().recordChange('Renamed column', () => set('ru'), 'rename:x1') })
    expect(S().historyList()).toHaveLength(1)
  })
})
