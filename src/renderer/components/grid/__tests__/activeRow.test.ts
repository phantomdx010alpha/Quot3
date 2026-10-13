/// <reference types="node" />
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillGrid } from '../BillGrid'
import { renderProbe } from '../renderProbe'
import { useBillStore } from '../../../stores/billStore'
import { useGridUiStore } from '../../../stores/gridUiStore'
import { legacyGridBill } from '@shared/__fixtures__/gridBills'
import { TOKEN_NAMES } from '@shared/theme/tokens'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
function mount(): void {
  act(() => { useBillStore.getState().loadBill(legacyGridBill()) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(createElement(BillGrid)) })
}
beforeEach(() => { useGridUiStore.setState({ mode: 'idle', armed: false }) })
afterEach(() => { act(() => root.unmount()); host.remove(); renderProbe.enabled = false; renderProbe.reset() })

const grid = () => host.querySelector<HTMLElement>('[role=grid]')!
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-row-id]')]
const marked = () => [...host.querySelectorAll<HTMLElement>('[data-active-row]')]
function key(k: string): void {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  act(() => { (document.activeElement ?? grid()).dispatchEvent(ev) })
}

describe('Phase 78 - whole active row highlight', () => {
  it('no row is marked until a cell is active; focusing the grid marks exactly the first row', () => {
    mount()
    expect(marked()).toHaveLength(0)
    act(() => { grid().focus() })
    expect(marked()).toEqual([rows()[0]])
    expect(host.querySelector('.q3-gc[data-active]')!.closest('[data-row-id]')).toBe(rows()[0])
  })
  it('moving down moves the mark to the new row and clears the old one', () => {
    mount(); act(() => { grid().focus() })
    key('ArrowDown')
    expect(marked()).toEqual([rows()[1]])
    key('ArrowDown'); key('ArrowUp')
    expect(marked()).toEqual([rows()[1]])
  })
  it('moving along the same row keeps the mark on that row', () => {
    mount(); act(() => { grid().focus() })
    key('Tab')
    expect(marked()).toEqual([rows()[0]])
  })
  it('the mark is set in the DOM only: arrow navigation re-renders no row and no cell (render probe)', () => {
    mount(); act(() => { grid().focus() })
    renderProbe.enabled = true; renderProbe.reset()
    key('ArrowDown'); key('ArrowDown'); key('ArrowUp')
    expect(renderProbe.rows).toEqual([])
    expect(renderProbe.cells).toEqual([])
    expect(marked()).toEqual([rows()[1]])
  })
  it('the row element is the same node after the move (React did not recreate it) and a re-render keeps the mark', () => {
    mount(); act(() => { grid().focus() })
    const first = rows()[0]!
    key('ArrowDown'); key('ArrowUp')
    expect(rows()[0]).toBe(first)
    expect(first.hasAttribute('data-active-row')).toBe(true)
    act(() => { useBillStore.getState().setCellText(first.dataset.rowId!, 'qty', '7') })
    expect(rows()[0]).toBe(first)
    expect(marked()).toEqual([first])
  })
})

describe('Phase 78 - token and styling guards', () => {
  const src = (p: string): string => readFileSync(join(__dirname, '..', '..', '..', '..', p), 'utf8')
  it('the token is on the theme whitelist (tokensParity then forces it into every built-in theme block)', () => {
    expect(TOKEN_NAMES).toContain('--grid-active-row-bg')
  })
  it('every built-in theme block in tokens.css defines it', () => {
    const css = src('renderer/styles/tokens.css')
    const blocks = css.split(/:root\[data-theme=/).slice(1)
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const b of blocks) expect(b).toContain('--grid-active-row-bg:')
  })
  it('grid.css paints the row from the token and it beats the zebra stripe; no component sets the attribute through React', () => {
    const css = src('renderer/styles/grid.css')
    expect(css).toMatch(/\.q3-gr\[data-active-row\]\s*\{\s*background:\s*var\(--grid-active-row-bg\)/)
    expect(css.indexOf('.q3-gr[data-active-row]')).toBeGreaterThan(css.indexOf('.q3-gr:nth-child(even)'))
    for (const f of ['renderer/components/grid/GridRow.tsx', 'renderer/components/grid/FooterRows.tsx']) expect(src(f)).not.toContain('data-active-row')
  })
})
