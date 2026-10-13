// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { renderProbe } from '../renderProbe'
import { useBillStore } from '../../../stores/billStore'
import { bigGridBill, legacyGridBill } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function mount(bill = legacyGridBill()): void {
  act(() => { useBillStore.getState().loadBill(bill) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
}
afterEach(() => { act(() => root.unmount()); host.remove(); renderProbe.enabled = false; renderProbe.reset() })
beforeEach(() => { renderProbe.reset() })

const rowsOf = () => [...host.querySelectorAll<HTMLElement>('[role=row]')]
// Phase 80: with extra columns the total rows and the tail rows also carry (virtual) row ids; these helpers pick the real body rows.
const isBodyRow = (r: HTMLElement): boolean => !!r.dataset.rowId && !/^(fx|tr):/.test(r.dataset.rowId)
const headerLabels = () => [...host.querySelectorAll('[role=columnheader]')].map((e) => e.textContent)

describe('BillGrid render (jsdom)', () => {
  it('renders registry columns + extra columns, header first', () => {
    mount()
    expect(headerLabels()).toEqual(['Sl.No', 'Item Name', 'Rate', 'Quantity', 'Amount', 'ruby', 'tomato'])
    expect(host.querySelector('[role=grid]')?.getAttribute('aria-colcount')).toBe('7')
  })
  it('shows 18 items + ≥3 trailing blank rows + a grand-total footer row', () => {
    mount()
    const body = rowsOf().filter(isBodyRow)
    expect(body).toHaveLength(21)
    expect(body.slice(0, 18).every((r) => r.dataset.kind === 'item')).toBe(true)
    expect(body.slice(18).every((r) => r.dataset.kind === 'blank')).toBe(true)
    const footer = rowsOf().filter((r) => r.dataset.kind === 'grandTotal')
    expect(footer).toHaveLength(1)
    expect(footer[0]!.textContent).toContain('17226.00')
  })
  it('first row cells: Sl.No, name, rate, qty, amount, extras', () => {
    mount()
    const cells = [...rowsOf()[1]!.querySelectorAll('[role=gridcell]')].map((c) => c.textContent)
    expect(cells).toEqual(['1', 'ruby gold belt roll big', '90', '10', '900.00', '11.5-1', '5-4'])
  })
  it('rows are 26px via the token (no inline heights) and the grid scrolls inside itself', () => {
    mount()
    expect(host.querySelector('[style*="height"]')).toBeNull()
    expect(host.querySelector('.q3-grid')).not.toBeNull()
  })
  it('format change swaps columns from the registry and keeps the same row elements', () => {
    mount()
    const before = rowsOf()[1]
    act(() => { useBillStore.getState().setFormatId('gst') })
    expect(headerLabels()).toEqual(['Sl.No', 'Item Name', 'Quantity', 'Rate', 'Total', 'GST %', 'GST Amt', 'Amount', 'ruby', 'tomato'])
    expect(rowsOf()[1]).toBe(before)
    act(() => { useBillStore.getState().setFormatId('non_gst') })
    expect(headerLabels()[2]).toBe('Rate')
  })
  it('80-row bill renders every row (no virtualisation) with ≥ 3 blank trailing rows', () => {
    mount(bigGridBill(80))
    const body = rowsOf().filter((r) => isBodyRow(r) && r.dataset.kind !== 'adjustment')
    expect(body).toHaveLength(79 + 3) // 79 body rows (1 adjustment lives in the footer) + 3 blanks
    expect(rowsOf().filter((r) => r.dataset.kind === 'adjustment' && r.dataset.rowId)).toHaveLength(1) // Phase 19: the adjustment row is editable, so it has a row id
    expect(rowsOf().some((r) => r.dataset.kind === 'adjustment')).toBe(true) // footer adjustment row
  })
})

describe('render counts: one edit re-renders only what changed', () => {
  it('renaming an item re-renders exactly ONE cell — no rows, no header, no footer, no grid shell', () => {
    mount()
    const id = useBillStore.getState().rows[5]!.id
    renderProbe.enabled = true; renderProbe.reset()
    act(() => { useBillStore.getState().patchRow(id, { nameRuns: [{ t: 'renamed' }] }) })
    expect(renderProbe.cells).toEqual([`${id}:name`])
    expect(renderProbe.rows).toEqual([])
    expect(renderProbe.headers).toBe(0)
    expect(renderProbe.footers).toBe(0)
    expect(renderProbe.grids).toBe(0)
    expect(host.querySelector(`[data-row-id="${id}"] [data-col=name]`)?.textContent).toBe('renamed')
  })
  it('changing qty re-renders only that row\'s qty + amount cells and the footer', () => {
    mount()
    const id = useBillStore.getState().rows[5]!.id // jumbo trimmer big: 1 × 150
    renderProbe.enabled = true; renderProbe.reset()
    act(() => { useBillStore.getState().patchRow(id, { qty: '2' }) })
    expect([...renderProbe.cells].sort()).toEqual([`${id}:qty`, `${id}:total`])
    expect(renderProbe.rows).toEqual([])
    expect(renderProbe.footers).toBe(1)
    expect(renderProbe.grids).toBe(0)
    expect(host.querySelector(`[data-row-id="${id}"] [data-col=total]`)?.textContent).toBe('300.00')
    expect(rowsOf().find((r) => r.dataset.kind === 'grandTotal')!.textContent).toContain('17376.00')
  })
  it('same on an 80-row bill (GST): editing a rate touches ≤ 4 cells of that row only', () => {
    mount(bigGridBill(80))
    act(() => { useBillStore.getState().setFormatId('gst') })
    const id = useBillStore.getState().rows[10]!.id
    renderProbe.enabled = true; renderProbe.reset()
    act(() => { useBillStore.getState().patchRow(id, { rate: '12345' }) })
    expect(renderProbe.cells.length).toBeLessThanOrEqual(4) // rate, total, gstAmt, amount
    expect(renderProbe.cells.every((c) => c.startsWith(`${id}:`))).toBe(true)
    expect(renderProbe.rows).toEqual([])
    expect(renderProbe.grids).toBe(0)
  })
  it('using the last blank row re-pads: that row shell + 3 NEW rows render; no other existing row re-renders', () => {
    mount()
    const before = new Set(useBillStore.getState().rows.map((r) => r.id))
    const last = useBillStore.getState().rows.at(-1)!.id
    renderProbe.enabled = true; renderProbe.reset()
    act(() => { useBillStore.getState().patchRow(last, { nameRuns: [{ t: 'new item' }] }) })
    const existing = renderProbe.rows.filter((id) => before.has(id))
    expect(existing).toEqual([last]) // blank -> partial changes only its own shell
    expect(renderProbe.rows.filter((id) => !before.has(id))).toHaveLength(3)
    expect(renderProbe.headers).toBe(0)
    const body = rowsOf().filter(isBodyRow)
    expect(body.slice(-3).every((r) => r.dataset.kind === 'blank')).toBe(true)
    expect(body.at(-4)!.dataset.rowId).toBe(last)
  })
})
