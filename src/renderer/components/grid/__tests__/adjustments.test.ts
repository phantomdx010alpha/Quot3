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
let clock = 0
const S = () => useBillStore.getState()

function mount(): void {
  // Phase 80: with extra columns the total rows are navigable (free cells); these tests are about the plain adjustment block, so the bill has no extra columns.
  act(() => { S().loadBill({ ...legacyGridBill(), extraCols: [] }) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
}
beforeEach(() => { clock = 9_000_000; historyHooks.now = () => clock; useGridUiStore.setState({ mode: 'idle', armed: false, notice: '' }) })
afterEach(() => { act(() => root.unmount()); host.remove() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
function key(k: string, m: Partial<KeyboardEventInit> = {}): void {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
}
const typeText = (t: string): void => { for (const ch of t) key(ch) }
const activeCell = () => host.querySelector<HTMLElement>('.q3-gc[data-active]')
const activeAt = (): [string | undefined, string | undefined] => [activeCell()?.closest<HTMLElement>('[data-row-id]')?.dataset.rowId, activeCell()?.dataset.col]
const kinds = () => S().view.footer.map((d) => d.kind)

/** Turn the first blank body row into an adjustment (name + total only). */
function makeAdjustment(name = 'Discount', total = '-500'): string {
  const id = S().view.bodyIds.find((i) => S().view.body[i]?.kind === 'blank')!
  act(() => { S().setCellTexts([{ rowId: id, colKey: 'name', text: name }, { rowId: id, colKey: 'total', text: total }]) })
  return id
}

describe('Phase 19 — footer structure', () => {
  it('no adjustments: the footer has no adjustment block (single total)', () => {
    mount()
    expect(S().view.adjIds).toEqual([])
    expect(kinds().some((k) => k === 'adjustment' || k === 'adjustmentsTotal')).toBe(false)
    expect(S().view.navIds).toBe(S().view.bodyIds === S().view.navIds ? S().view.bodyIds : S().view.navIds)
    expect(S().view.navIds).toEqual(S().view.bodyIds)
  })
  it('a name + total only row moves out of the body into the footer, in order: items total → adjustment → adjustments total → final total', () => {
    mount()
    const id = makeAdjustment()
    expect(S().view.bodyIds).not.toContain(id)
    expect(S().view.adjIds).toEqual([id])
    expect(S().view.navIds[S().view.navIds.length - 1]).toBe(id)
    expect(kinds()).toEqual(['itemsTotal', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    const rows = [...host.querySelectorAll<HTMLElement>('[role=row]')].map((r) => r.dataset.kind)
    expect(rows.slice(-4)).toEqual(['itemsTotal', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    const adj = S().view.footer[1]!
    expect(adj.cells.total).toBe('-500.00')
    expect(S().view.footer[3]!.cells.total).toBe('16726.00') // 17,226.00 − 500.00
  })
  it('the adjustment row is rendered with editable cells; negative totals carry the negative marker; total rows are display-only', () => {
    mount()
    const id = makeAdjustment()
    const row = host.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!
    expect(row.dataset.kind).toBe('adjustment')
    expect(row.querySelector('[data-col="name"] .q3-gc__text')!.textContent).toBe('Discount')
    expect(row.querySelector('[data-col="total"]')!.hasAttribute('data-neg')).toBe(true)
    const totals = host.querySelector<HTMLElement>('[data-kind="itemsTotal"]')!
    expect(totals.dataset.rowId).toBeUndefined()
    expect(totals.querySelector('[data-nav]')).toBeNull()
  })
  it('a positive adjustment is not negative-styled; two adjustments keep footer order', () => {
    mount()
    const a = makeAdjustment('Packing', '120')
    const b = makeAdjustment('Discount', '-50')
    expect(S().view.adjIds).toEqual([a, b])
    expect(host.querySelector(`[data-row-id="${a}"] [data-col="total"]`)!.hasAttribute('data-neg')).toBe(false)
    expect(host.querySelector(`[data-row-id="${b}"] [data-col="total"]`)!.hasAttribute('data-neg')).toBe(true)
  })
})

describe('Phase 19 — keyboard navigation through the adjustment block', () => {
  function goToAdjustment(id: string): void {
    act(() => { grid().focus() })
    for (let i = 0; i < S().view.bodyIds.length; i++) key('ArrowDown')
    expect(activeAt()[0]).toBe(id)
  }
  it('Down from the last body row enters the adjustment row; the read-only total rows are skipped; Down at the end adds nothing', () => {
    mount()
    const id = makeAdjustment()
    const rowCount = S().rows.length
    goToAdjustment(id)
    expect(activeAt()[1]).toBe('name')
    key('ArrowDown'); key('Enter')
    expect(activeAt()[0]).toBe(id)
    expect(S().rows).toHaveLength(rowCount)
    expect(host.querySelector('[data-kind="grandTotal"] [data-active]')).toBeNull()
    key('ArrowUp')
    expect(activeAt()[0]).toBe(S().view.bodyIds[S().view.bodyIds.length - 1])
  })
  it('an adjustment is editable in place (name and total)', () => {
    mount()
    const id = makeAdjustment()
    goToAdjustment(id)
    typeText(' x')                         // Append at the end of "Discount"
    key('Tab'); key('Tab'); key('Tab')      // rate, qty, total
    expect(activeAt()).toEqual([id, 'total'])
    key('Backspace'); key('Backspace')     // Append: Backspace edits at the end; "-500.00"?  raw text is "-500"
    typeText('5')
    key('Escape')
    key('ArrowUp'); key('ArrowDown')       // leave and come back → committed
    const row = S().rows.find((r) => r.id === id)!
    expect(row.nameRuns.map((r) => r.t).join('')).toBe('Discount x')
    expect(S().view.adjIds).toContain(id)
    expect(S().view.body[id]!.kind).toBe('adjustment')
  })
  it('adding a qty/rate to an adjustment moves it back into the body and the cursor follows it by id', () => {
    mount()
    const id = makeAdjustment()
    goToAdjustment(id)
    key('Tab')                              // rate
    typeText('10')
    key('Tab')                              // qty → commit (rate set → it is an item again)
    expect(S().view.adjIds).toEqual([])
    expect(S().view.bodyIds).toContain(id)
    expect(activeAt()).toEqual([id, 'qty'])
    expect(host.querySelector(`[data-row-id="${id}"]`)!.closest('.q3-grid')).not.toBeNull()
    expect(kinds().some((k) => k === 'adjustment')).toBe(false)
  })
  it('FOLLOW: clearing the Total of an adjustment (Delete) sends it back to the body and the SAME cell stays active there', () => {
    mount()
    const id = makeAdjustment()
    goToAdjustment(id)
    key('Tab'); key('Tab'); key('Tab')
    expect(activeAt()).toEqual([id, 'total'])
    key('Delete')
    expect(S().view.adjIds).toEqual([])
    expect(S().view.bodyIds).toContain(id)
    expect(activeAt()).toEqual([id, 'total'])
    expect(useGridUiStore.getState().mode).toBe('append')
    // and the cursor is a real cell again: arrows continue from its new place
    key('ArrowUp')
    expect(activeAt()[0]).toBe(S().view.bodyIds[S().view.bodyIds.indexOf(id) - 1])
  })
  it('FOLLOW the other way: filling a Total in a blank row (store level) puts the cell in the footer; locating it by id gives the footer index', () => {
    mount()
    act(() => { grid().focus() })
    const id = S().view.bodyIds.find((i) => S().view.body[i]?.kind === 'blank')!
    const before = S().view.navIds.indexOf(id)
    act(() => { S().setCellTexts([{ rowId: id, colKey: 'name', text: 'Freight' }, { rowId: id, colKey: 'total', text: '75' }]) })
    expect(before).toBeLessThan(S().view.bodyIds.length + 1)
    expect(S().view.navIds.indexOf(id)).toBe(S().view.navIds.length - 1)
    expect(S().view.navIds.indexOf(id)).toBe(S().view.bodyIds.length) // first nav row after the body
  })
})

describe('Phase 19 — history and totals', () => {
  it('undo returns the row to the body, redo to the footer; totals follow', () => {
    mount()
    const itemsTotal = S().view.footer.find((d) => d.kind === 'grandTotal')!.cells.total
    const id = S().view.bodyIds.find((i) => S().view.body[i]?.kind === 'blank')!
    act(() => { S().setCellTexts([{ rowId: id, colKey: 'name', text: 'Discount' }, { rowId: id, colKey: 'total', text: '-500' }]) })
    expect(S().view.adjIds).toEqual([id])
    act(() => { S().undo() })
    expect(S().view.adjIds).toEqual([])
    expect(S().view.footer.find((d) => d.kind === 'grandTotal')!.cells.total).toBe(itemsTotal)
    act(() => { S().redo() })
    expect(S().view.adjIds).toEqual([id])
    expect(S().view.footer.find((d) => d.kind === 'grandTotal')!.cells.total).toBe('16726.00')
  })
  it('paste never starts in or flows into the adjustment block', () => {
    mount()
    const id = makeAdjustment()
    goToAdj(id)
    const dt = { getData: (t: string) => (t === 'text/plain' ? 'a\tb\nc\td' : ''), setData: () => {}, types: ['text/plain'] }
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown }
    ev.clipboardData = dt
    act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
    expect(useGridUiStore.getState().notice).toMatch(/adjustment rows are typed/)
    expect(S().rows.find((r) => r.id === id)!.nameRuns.map((r) => r.t).join('')).toBe('Discount')
  })
})
function goToAdj(id: string): void {
  act(() => { grid().focus() })
  for (let i = 0; i < S().view.bodyIds.length; i++) key('ArrowDown')
  expect(activeAt()[0]).toBe(id)
}
