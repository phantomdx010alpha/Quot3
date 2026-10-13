// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useBillStore } from '../../../stores/billStore'
import { useColWidthStore } from '../../../stores/columnWidthStore'
import { historyHooks } from '../../../stores/historyHooks'
import { longTextGridBill, LONG_HEADER_40 } from '@shared/__fixtures__/gridBills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
const S = () => useBillStore.getState()
function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(BillGrid)
}
beforeEach(() => {
  historyHooks.now = () => 9_000_000
  useColWidthStore.setState({ overrides: {}, loaded: true })
  act(() => { S().loadBill(longTextGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(Shell)) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = '' })
const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const tpl = () => grid().style.getPropertyValue('--q3-grid-cols')
const key = (k: string, m: Partial<KeyboardEventInit> = {}) => act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m })) })

describe('Phase 23 — overflow and long text', () => {
  it('long fixtures render single-line text with the full text as a tooltip; the 40-char header keeps its title', () => {
    const body = S().view.bodyIds
    const nameCell = host.querySelector(`[data-row-id="${body[0]}"] [data-col="name"] .q3-gc__text`) as HTMLElement
    expect(nameCell.textContent!.length).toBeGreaterThan(250)
    expect(nameCell.title).toBe(nameCell.textContent)
    const emoji = host.querySelector(`[data-row-id="${body[2]}"] [data-col="name"] .q3-gc__text`) as HTMLElement
    expect(emoji.title).toContain('🇮🇳')
    const hdr = host.querySelector('[role=columnheader][data-col="c1"]') as HTMLElement
    expect(LONG_HEADER_40).toHaveLength(40)
    expect(hdr.title).toBe(LONG_HEADER_40)
  })
  it('grid exposes the sticky offset (Item Name after Sl.No) and never widens the page itself', () => {
    expect(grid().style.getPropertyValue('--q3-sticky-name-left')).toBe('52px')
    expect(host.querySelector('.q3-grid')!.className).toContain('q3-grid') // scrolling lives on .q3-grid (overflow:auto in grid.css)
  })
  it('dragging a header handle resizes live (clamped) and a double-click resets', () => {
    const h = host.querySelector<HTMLElement>('[data-resize="rate"]')!
    act(() => { h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, button: 0 })) })
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160 })) })
    expect(useColWidthStore.getState().overrides.non_gst?.rate).toBeGreaterThan(40)
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 99999 })) })
    expect(useColWidthStore.getState().overrides.non_gst?.rate).toBe(640)
    act(() => { window.dispatchEvent(new MouseEvent('mouseup')) })
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5 })) }) // listeners removed: no further change
    expect(useColWidthStore.getState().overrides.non_gst?.rate).toBe(640)
    expect(tpl()).toContain('640px')
    act(() => { h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    expect(useColWidthStore.getState().overrides.non_gst).toBeUndefined()
  })
  it('widths are per format: a GST resize does not touch non-GST', () => {
    act(() => { useColWidthStore.getState().set('gst', 'name', 500) })
    expect(tpl()).not.toContain('500px')
    act(() => { S().setFormatId('gst') })
    expect(tpl()).toContain('500px')
  })
  it('Ctrl+Alt+] / [ resize the active cell column by 16px; Ctrl+Alt+0 resets the format', () => {
    historyHooks.selection = { get: () => ({ rowId: S().view.bodyIds[0]!, colKey: 'rate', range: null }), restore: () => undefined, flush: () => undefined }
    key(']', { ctrlKey: true, altKey: true })
    expect(useColWidthStore.getState().overrides.non_gst?.rate).toBe(96 + 16)
    key('[', { ctrlKey: true, altKey: true })
    key('[', { ctrlKey: true, altKey: true })
    expect(useColWidthStore.getState().overrides.non_gst?.rate).toBe(96 - 16)
    key('0', { ctrlKey: true, altKey: true })
    expect(useColWidthStore.getState().overrides.non_gst).toBeUndefined()
    historyHooks.selection = null
  })
  it('editing a long cell does not change the column template (no layout shift)', () => {
    const before = tpl()
    const el = host.querySelector<HTMLElement>(`[data-row-id="${S().view.bodyIds[0]}"] [data-col="name"] .q3-gc__text`)!
    act(() => { el.focus() })
    expect(tpl()).toBe(before)
  })
})
