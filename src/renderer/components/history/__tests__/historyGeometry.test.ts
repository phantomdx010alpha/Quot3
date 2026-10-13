/// <reference types="node" />
// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { BillList, HISTORY_ROW_PX } from '../BillList'
import type { BillListItem } from '@shared/history/historyList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Phase 93 - History row geometry. Real layout needs a window (standing gap); these prove from source what can be proven:
 * one template for header + rows, a Bill No column that fits number + badges, one-line cells, equal scrollbar gutters,
 * and that the Party column still has room at the 1024 px minimum window width.
 */
const css = readFileSync(resolve('src/renderer/styles/grid.css'), 'utf8')
const rule = (sel: string): string => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*\\}`))?.[0] ?? ''

describe('Phase 93 - History list geometry (source level)', () => {
  const cols = /--q3-hist-cols:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? ''
  it('header and body rows share the single --q3-hist-cols template', () => {
    expect(rule('.q3-hist__billcols')).toContain('grid-template-columns: var(--q3-hist-cols)')
    expect(cols).toMatch(/^\d+px \d+px minmax\(0, 1fr\) \d+px$/)
  })
  it('Bill No column is wide enough for the number plus sync mark plus Imported badge', () => {
    expect(Number(cols.split('px')[0])).toBeGreaterThanOrEqual(200)
  })
  it('rows are one line: nowrap, clipped, fixed height (virtualizer size = row-height token)', () => {
    const r = rule('.q3-hist__billrow')
    expect(r).toContain('white-space: nowrap')
    expect(r).toContain('overflow: hidden')
    expect(css).toMatch(/\.q3-hist__billrow > \*\s*\{[^}]*white-space: nowrap/)
    expect(readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8')).toMatch(/--row-height:\s*26px/)
    expect(HISTORY_ROW_PX).toBe(26)
  })
  it('badges sit in a flex row that cannot wrap or overlap the number', () => {
    expect(rule('.q3-hist__no')).toContain('display: flex')
    expect(css).toMatch(/\.q3-hist__no > \*\s*\{\s*flex: none/)
    expect(rule('.q3-hist__imp')).toContain('white-space: nowrap')
  })
  it('header and list reserve the same scrollbar gutter so columns line up', () => {
    expect(rule('.q3-hist__thead')).toContain('scrollbar-gutter: stable')
    expect(css).toMatch(/\.q3-hist__datelist, \.q3-hist__billlist \{[^}]*scrollbar-gutter: stable/)
  })
  it('at the 1024 px minimum window width the Party column keeps >= 150 px', () => {
    const [no, date, , total] = cols.split(/\s+/).map((c) => parseInt(c, 10))
    const rail = 46 + 16, pagePad = 24, dates = 190, gap = 12, border = 2, rowPad = 24, gutter = 20, colGaps = 36
    const billsInner = 1024 - rail - pagePad - dates - gap - border - rowPad - gutter
    expect(billsInner - (no! + date! + total!) - colGaps).toBeGreaterThanOrEqual(150)
  })
})

describe('Phase 93 - BillList markup', () => {
  it('a long number + Imported + synced bill renders number and badges as separate single-line children', async () => {
    const bills: BillListItem[] = [{ id: 'b1', poNumber: 'Q3-0728', poSeq: 728, billDate: '2026-10-11', partyName: 'A very long party name that must be cut with an ellipsis rather than wrap', grandTotal: '12345.50', branchId: 'local', revision: 1, importBatchId: 'batch1', syncState: 'synced' } as BillListItem]
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(BillList, { bills, selectedId: 'b1', hasMore: false, onSelect: vi.fn(), onLoadMore: vi.fn(), onEnter: vi.fn(), onLeft: vi.fn(), listRef: createRef<HTMLDivElement>() }))
    })
    const cell = host.querySelector('.q3-hist__no')
    expect(cell).not.toBeNull()
    expect(cell!.querySelector('.q3-hist__nonum')?.textContent).toBe('Q3-0728')
    expect(cell!.querySelector('.q3-hist__imp')?.textContent).toBe('Imported')
    expect(host.querySelectorAll('[role="row"]').length).toBeLessThanOrEqual(1)
    expect(host.querySelector('.q3-hist__thead')?.classList.contains('q3-hist__billcols')).toBe(true)
    expect(host.querySelector('[role="row"]')?.classList.contains('q3-hist__billcols')).toBe(true)
    act(() => root.unmount())
  })
})
