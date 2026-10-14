// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { useBehaviourStore } from '../../../stores/behaviourStore'
import { enterHybrid } from '../../../stores/hybridActions'
import { createEmptyBill } from '@shared/billModel'
import type { BillRow } from '@shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row = (id: string, name: string, qty: string | null, rate: string | null, extra: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: 0, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...extra })

let host: HTMLDivElement
let root: Root

function mount(): void {
  const b = createEmptyBill({ branchId: 'br1', formatId: 'gst', rowCount: 0 })
  act(() => {
    useBillStore.getState().loadBill({
      ...b, extraCols: [{ key: 'c1', header: 'Units', kind: 'units' }],
      rows: [row('p1', 'Pipe', '2', '50', { gstRate: '18', extras: { c1: { text: '5 box' } } }), row('p2', 'Elbow', '3', '10', { gstRate: '12' })].map((r, i) => ({ ...r, idx: i }))
    })
  })
  act(() => { enterHybrid() })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => {
    root.render(createElement('div', null,
      createElement('div', { className: 'q3-hy-pane', 'data-side': 'primary' }, createElement(BillGrid, { label: 'GST table' })),
      createElement('div', { className: 'q3-hy-pane', 'data-side': 'second' }, createElement(BillGrid, { side: 'second', label: 'Non-GST table' }))))
  })
}
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false }); useBehaviourStore.setState({ smoothArrows: false }); mount() })
afterEach(() => { act(() => root.unmount()); host.remove() })

const grid = (side: 'primary' | 'second'): HTMLElement => host.querySelector<HTMLElement>(`.q3-hy-pane[data-side="${side}"] [role=grid]`)!
const focus = (side: 'primary' | 'second'): void => { act(() => { grid(side).focus() }) }
const active = (): HTMLElement => host.querySelector<HTMLElement>('.q3-gc[data-active]')!
const activeSide = (): string | undefined => active().closest<HTMLElement>('.q3-hy-pane')?.dataset.side
const activeCol = (): string | undefined => active().dataset.col
function key(k: string, m: Partial<KeyboardEventInit> = {}): void {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })
  act(() => { (document.activeElement ?? document.body).dispatchEvent(ev) })
}
const type = (s: string): void => { for (const c of s) key(c) }
const nameOf = (r: BillRow): string => r.nameRuns.map((x) => x.t).join('')
const S = () => useBillStore.getState()

describe('Phase 151 - keyboard in the second table', () => {
  it('focusing the second grid activates its first cell, inside that grid', () => {
    focus('second')
    expect(activeSide()).toBe('second')
    expect(activeCol()).toBe('name')
  })

  it('typing in the second table changes only the second table', () => {
    focus('second')
    type('X')
    key('Enter')
    expect(nameOf(S().hybrid!.rows[0]!)).toBe('PipeX')
    expect(nameOf(S().rows[0]!)).toBe('Pipe')
  })

  it('typing in the first table does not touch the second table', () => {
    focus('primary')
    type('Y')
    key('Enter')
    expect(nameOf(S().rows[0]!)).toBe('PipeY')
    expect(nameOf(S().hybrid!.rows[0]!)).toBe('Pipe')
  })

  it('Tab walks the second table in ITS layout (name, qty, rate; no GST column) and stays in the second grid', () => {
    focus('second')
    key('Tab'); expect(activeCol()).toBe('qty')
    key('Tab'); expect(activeCol()).toBe('rate')
    expect(activeSide()).toBe('second')
  })

  it('arrow Down moves to the next row of the same table', () => {
    focus('second')
    const first = active().parentElement!.dataset.rowId
    key('ArrowDown')
    expect(activeSide()).toBe('second')
    expect(active().parentElement!.dataset.rowId).not.toBe(first)
    expect(S().hybrid!.rows.some((r) => r.id === active().parentElement!.dataset.rowId)).toBe(true)
  })

  it('a second-table edit is one undo step and Ctrl+Z restores it', () => {
    focus('second')
    type('Z')
    key('Enter')
    expect(nameOf(S().hybrid!.rows[0]!)).toBe('PipeZ')
    key('z', { ctrlKey: true })
    expect(nameOf(S().hybrid!.rows[0]!)).toBe('Pipe')
    expect(nameOf(S().rows[0]!)).toBe('Pipe')
  })

  it('a numeric edit in the second table recalculates its own total only', () => {
    focus('second')
    const before = S().view.footer.map((f) => JSON.stringify(f))
    key('Tab'); key('Tab') // rate
    key('Delete') // Append mode: Delete clears the whole cell (KB)
    type('100')
    key('Enter')
    expect(S().hybrid!.rows[0]!.rate).toBe('100')
    expect(S().rows[0]!.rate).toBe('50')
    expect(S().view.footer.map((f) => JSON.stringify(f))).toEqual(before)
    expect(S().second!.view.footer.map((f) => JSON.stringify(f))).not.toEqual(before)
  })

  it('a shared extra cell edited in the second table is the primary row\'s cell', () => {
    focus('second')
    key('Tab'); key('Tab') // rate
    key('Tab') // Total (editable override in this layout)
    key('Tab') // -> the Units extra column
    expect(activeCol()).toBe('c1')
    type('!')
    key('Enter')
    expect(S().rows[0]!.extras.c1?.text).toContain('!')
    expect(grid('primary').textContent).toContain('!')
  })
})
