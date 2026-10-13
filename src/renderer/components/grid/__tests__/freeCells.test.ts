// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { UnitsPopup } from '../../create/UnitsPopup'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useExtraColUiStore } from '../../../stores/extraColUiStore'
import { useBehaviourStore } from '../../../stores/behaviourStore'
import { historyHooks } from '../../../stores/historyHooks'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let clock = 0
const S = () => useBillStore.getState()

beforeEach(() => {
  clock = 9_000_000
  historyHooks.now = () => clock
  useGridUiStore.setState({ mode: 'idle', armed: false, notice: '', tailShown: 0 })
  useExtraColUiStore.setState({ renameKey: null, removeKey: null, units: null })
  useBehaviourStore.setState({ smoothArrows: false })
  act(() => { S().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement('div', null, createElement(BillGrid), createElement(UnitsPopup))) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const rowEl = (id: string) => host.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const cellEl = (id: string, col: string) => rowEl(id)?.querySelector<HTMLElement>(`[data-col="${col}"]`) ?? null
const spanOf = (id: string, col: string) => cellEl(id, col)?.querySelector<HTMLElement>('.q3-gc__text') ?? null
const activeAt = (): [string | undefined, string | undefined] => {
  const c = host.querySelector<HTMLElement>('.q3-gc[data-active]')
  return [c?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId, c?.dataset.col]
}
function key(k: string, m: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  return ev
}
const typeText = (t: string): void => { for (const ch of t) key(ch) }
/** A press on the cell's padding (not its text): the controller arrives on it in Append mode. */
function arrive(id: string, col: string): void {
  const div = cellEl(id, col)!
  act(() => { div.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })) })
}

describe('Phase 80 - structure', () => {
  it('with extra columns: the single Total row and one tail row carry editable extra cells; other cells are read-only', () => {
    expect(rowEl('fx:grandTotal')).not.toBeNull()
    expect(rowEl('fx:grandTotal')!.dataset.kind).toBe('grandTotal')
    expect(cellEl('fx:grandTotal', 'ruby')!.dataset.nav).toBe('1')
    expect(cellEl('fx:grandTotal', 'ruby')!.dataset.extra).toBe('1')
    expect(cellEl('fx:grandTotal', 'total')?.textContent ?? cellEl('fx:grandTotal', 'amount')?.textContent).toContain('17226.00')
    expect(rowEl('tr:0')).not.toBeNull()
    expect(rowEl('tr:1')).toBeNull() // one blank entry row only
    expect(host.querySelectorAll('[data-row-id^="tr:"]')).toHaveLength(1)
  })
  it('without extra columns there are no free rows at all', () => {
    act(() => { S().loadBill({ ...legacyGridBill(), extraCols: [] }) })
    expect(host.querySelector('[data-row-id^="fx:"]')).toBeNull()
    expect(host.querySelector('[data-row-id^="tr:"]')).toBeNull()
    expect(grid().getAttribute('aria-rowcount')).toBe(String(S().view.bodyIds.length + S().view.footer.length + 1))
  })
  it('adjustments: Items total, Adjustments total and Final total each get a free row, in display order', () => {
    const id = S().view.bodyIds.find((i) => S().view.body[i]?.kind === 'blank')!
    act(() => { S().setCellTexts([{ rowId: id, colKey: 'name', text: 'Discount' }, { rowId: id, colKey: 'total', text: '-500' }]) })
    const order = [...host.querySelectorAll<HTMLElement>('[data-row-id]')].map((r) => r.dataset.rowId!).filter((r) => r.startsWith('fx:') || r === id)
    expect(order).toEqual(['fx:itemsTotal', id, 'fx:adjustmentsTotal', 'fx:grandTotal'])
  })
  it('stored cells show in the DOM; marked free cells carry data-marked', () => {
    act(() => { S().setFreeCells([{ rowId: 'fx:grandTotal', colKey: 'ruby', text: '7-2' }, { rowId: 'tr:0', colKey: 'tomato', text: '9-3' }]) })
    expect(spanOf('fx:grandTotal', 'ruby')!.textContent).toBe('7-2')
    expect(spanOf('tr:0', 'tomato')!.textContent).toBe('9-3')
    expect(host.querySelectorAll('[data-row-id^="tr:"]')).toHaveLength(2) // the stored row + a fresh blank one
    act(() => { S().toggleMark('tr:0', 'tomato') })
    expect(cellEl('tr:0', 'tomato')!.dataset.marked).toBe('1')
  })
})

describe('Phase 80 - keyboard', () => {
  it('type in the Final-total extra cell, Enter moves on and commits; one undo entry; Ctrl+Z restores', () => {
    arrive('fx:grandTotal', 'ruby')
    expect(activeAt()).toEqual(['fx:grandTotal', 'ruby'])
    const span = spanOf('fx:grandTotal', 'ruby')!
    expect(span.getAttribute('contenteditable')).toBe('plaintext-only')
    typeText('5-2')
    expect(S().footerExtras).toBeUndefined() // still a draft
    key('Enter')
    expect(S().footerExtras).toEqual({ grandTotal: { ruby: { text: '5-2' } } })
    expect(activeAt()).toEqual(['tr:0', 'ruby'])
    expect(S().undoLabel).toMatch(/below the items/)
    act(() => { S().undo() })
    expect(S().footerExtras).toBeUndefined()
    expect(spanOf('fx:grandTotal', 'ruby')!.textContent).toBe('')
  })
  it('the read-only cells of a total row are navigable but typing in them does nothing', () => {
    arrive('fx:grandTotal', 'name')
    expect(activeAt()).toEqual(['fx:grandTotal', 'name'])
    const span = spanOf('fx:grandTotal', 'name')!
    expect(span.getAttribute('contenteditable')).toBeNull()
    const before = span.textContent
    key('x')
    expect(span.textContent).toBe(before)
    expect(S().footerExtras).toBeUndefined()
  })
  it('Enter on the last tail row opens another; tail rows are unlimited and stored without trailing blanks', () => {
    arrive('tr:0', 'ruby')
    typeText('7-2')
    key('Enter') // tr:0 was the last row -> a new tail row is created and entered
    expect(activeAt()).toEqual(['tr:1', 'ruby'])
    expect(S().tailRows).toEqual([{ extras: { ruby: { text: '7-2' } } }])
    key('Enter') // again on the (blank) last row
    expect(activeAt()).toEqual(['tr:2', 'ruby'])
    typeText('1-1')
    key('Enter')
    expect(S().tailRows).toEqual([{ extras: { ruby: { text: '7-2' } } }, { extras: {} }, { extras: { ruby: { text: '1-1' } } }])
    expect(host.querySelectorAll('[data-row-id^="tr:"]').length).toBeGreaterThanOrEqual(4)
  })
  it('emptying the last stored tail cell trims it from the saved state', () => {
    act(() => { S().setFreeCells([{ rowId: 'tr:0', colKey: 'ruby', text: 'x' }]) })
    arrive('tr:0', 'ruby')
    key('Delete') // clears the cell and commits it
    expect(S().tailRows).toBeUndefined()
  })
  it('Ctrl+M marks a free cell; Ctrl+Z undoes it', () => {
    act(() => { S().setFreeCells([{ rowId: 'tr:0', colKey: 'ruby', text: 'label' }]) })
    act(() => { S().toggleMark('tr:0', 'ruby') })
    expect(S().tailRows).toEqual([{ extras: { ruby: { text: 'label', marked: true } } }])
    expect(S().undoLabel).toMatch(/Marked|below the items/)
    act(() => { S().undo() })
    expect(S().tailRows).toEqual([{ extras: { ruby: { text: 'label' } } }])
  })
})

describe('Phase 80 - clipboard', () => {
  function paste(text: string): void {
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(ev, 'clipboardData', { value: { getData: (t: string) => (t === 'text/plain' ? text : '') } })
    act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
  }
  it('a pasted block starting on a tail row fills extra cells downward, growing the tail; other columns are skipped and reported', () => {
    arrive('tr:0', 'ruby')
    paste('1-1\t2-2\n3-3\t4-4\n5-5\t6-6')
    expect(S().tailRows).toEqual([
      { extras: { ruby: { text: '1-1' }, tomato: { text: '2-2' } } },
      { extras: { ruby: { text: '3-3' }, tomato: { text: '4-4' } } },
      { extras: { ruby: { text: '5-5' }, tomato: { text: '6-6' } } }
    ])
    expect(S().undoLabel).toBe('Paste')
    act(() => { S().undo() })
    expect(S().tailRows).toBeUndefined()
  })
  it('pasting from the Final-total row flows into the tail; the Total column is read-only so it is skipped', () => {
    arrive('fx:grandTotal', 'total')
    paste('9\t8-1\n7\t6-2')
    expect(useGridUiStore.getState().notice).toMatch(/skipped/)
  })
})

describe('Phase 80 - units count continues the last segment', () => {
  it('the popup includes Final-total and tail cells: idk bruhh = 55 + 2 + 3', () => {
    act(() => { S().setFreeCells([{ rowId: 'fx:grandTotal', colKey: 'ruby', text: '7-2' }, { rowId: 'tr:0', colKey: 'ruby', text: '9-3' }]) })
    act(() => { useExtraColUiStore.getState().openUnits('marked') })
    expect(document.querySelector('.q3-units')?.textContent).toBe('Column: ruby\n  idk bruhh = 60')
  })
})

describe('Phase 80 - extra column removal', () => {
  it('removing a column drops its free cells (undo restores them); a re-added column starts empty', () => {
    act(() => { S().setFreeCells([{ rowId: 'fx:grandTotal', colKey: 'tomato', text: '3-3' }, { rowId: 'tr:0', colKey: 'ruby', text: '4-4' }]) })
    act(() => { S().removeExtraCol('tomato') })
    expect(S().footerExtras).toBeUndefined()
    expect(S().tailRows).toEqual([{ extras: { ruby: { text: '4-4' } } }])
    act(() => { S().undo() })
    expect(S().footerExtras).toEqual({ grandTotal: { tomato: { text: '3-3' } } })
  })
})
