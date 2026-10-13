// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GroupsWindow, ITEMS_ROW_PX } from '../GroupsWindow'
import { buildGroupRows, moveGroupSelection, rowIndexOfGroup } from '@shared/items/groupRows'
import type { GroupSummary } from '@shared/items/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const N = 3200
const groups: GroupSummary[] = Array.from({ length: N }, (_, i) => {
  const name = `ITEM ${String(i).padStart(5, '0')}`
  return { id: name, display: name, count: 1, nonGstCount: 1, gstCount: 0, lastUsed: '2026-10-01', familyId: null, spellingCount: 1, suggestionCount: 0 }
})
const rows = buildGroupRows(groups, [])
const VIEW_H = 260

let scroller: HTMLDivElement
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  scroller = document.createElement('div')
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => VIEW_H })
  scroller.tabIndex = 0
  document.body.appendChild(scroller)
  host = document.createElement('div'); scroller.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); scroller.remove() })

const render = (selectedId: string | null): void => {
  act(() => root.render(createElement(GroupsWindow, { rows, selectedId, markedId: null, emptyText: '', getScroll: () => scroller, onSelect: () => undefined })))
}
const names = (): string[] => [...host.querySelectorAll('[role=row] [role=gridcell]:first-child')].map((n) => n.textContent ?? '')

describe('Phase 117 - Groups window with 3 200 items', () => {
  it('draws the first rows with text, only a small slice of the DOM', () => {
    render(null)
    const n = names()
    expect(n.length).toBeGreaterThan(8)
    expect(n.length).toBeLessThan(60)
    expect(n[0]).toBe('ITEM 00000')
    expect(n.every((x) => x !== '')).toBe(true)
  })
  it('after a scroll event the rows at that position are drawn (not blank)', () => {
    render(null)
    act(() => { scroller.scrollTop = 1500 * ITEMS_ROW_PX; scroller.dispatchEvent(new Event('scroll')) })
    const n = names()
    expect(n).toContain('ITEM 01500')
    expect(n.every((x) => x !== '')).toBe(true)
    // spacers keep the full scroll height
    const spacers = [...host.querySelectorAll('[aria-hidden=true]')] as HTMLElement[]
    const total = spacers.reduce((a, s) => a + parseInt(s.style.height, 10), 0) + host.querySelectorAll('[role=row]').length * ITEMS_ROW_PX
    expect(total).toBe(rows.length * ITEMS_ROW_PX)
  })
  it('Down all the way to the end: the selected row is always drawn, scrolled into view, and never blank', () => {
    let sel: string | null = null
    for (let step = 0; step < rows.length + 5; step++) {
      sel = moveGroupSelection(rows, sel, step === 0 ? 'Home' : 'ArrowDown', 10) ?? sel
      if (step % 400 === 0 || step > rows.length - 3) {
        render(sel)
        const idx = rowIndexOfGroup(rows, sel)
        const el = host.querySelector(`#q3-ig-${CSS.escape(sel!)}`)
        expect(el, `row ${idx} drawn`).not.toBeNull()
        expect(el!.getAttribute('aria-selected')).toBe('true')
        expect(scroller.scrollTop).toBeLessThanOrEqual(idx * ITEMS_ROW_PX)
        expect(scroller.scrollTop + VIEW_H).toBeGreaterThanOrEqual((idx + 1) * ITEMS_ROW_PX)
        expect(names().every((x) => x !== '')).toBe(true)
      }
    }
    expect(sel).toBe('ITEM 03199')
  })
  it('End key target (last row) is drawn after one render', () => {
    const last = moveGroupSelection(rows, null, 'End', 10)
    render(last)
    expect(host.querySelector(`#q3-ig-${CSS.escape(last!)}`)).not.toBeNull()
  })
})
