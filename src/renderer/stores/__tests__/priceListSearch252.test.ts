// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultColumnSet } from '@shared/pricelist/columns'
import { SEED_TIERS } from '@shared/pricelist/tiers'
import type { PriceRow, PriceTier } from '@shared/pricelist/types'
import type { PriceTree } from '@shared/pricelist/api'
import { PriceSearchBox } from '../../components/pricelist/PriceSearchBox'
import { priceListAdapter } from '../../pageMemory/adapters'
import { runPriceListAction } from '../priceListActions'
import { usePriceListStore } from '../priceListStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 252 (M24). Invented data only; the bridge is mocked, nothing touches a database.
const tiers: PriceTier[] = SEED_TIERS.map((t, i) => ({ id: `ti${i}`, key: t.key, label: t.label, position: i }))
const columns = defaultColumnSet(SEED_TIERS)
const tree: PriceTree = {
  tiers,
  categories: [{ id: 'c1', name: 'Panna', color: null, position: 0 }],
  tabs: [{ id: 't1', categoryId: 'c1', name: 'Small', position: 0, columns }, { id: 't2', categoryId: 'c1', name: 'Big', position: 1, columns }]
}
const mkRow = (id: string, name: string, idx: number, tabId = 't1'): PriceRow => ({ id, tabId, idx, kind: 'item', nameRuns: [{ t: name }], cells: {} })
const st = () => usePriceListStore.getState()
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

let host: HTMLDivElement
let root: Root
const inputRef = createRef<HTMLInputElement>()
const wait = async (ms: number): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
const typeInto = async (el: HTMLInputElement, text: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const key = async (el: Element, k: string): Promise<KeyboardEvent> => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  await act(async () => { el.dispatchEvent(e) })
  return e
}
const box = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[aria-label="Search all tabs"]')!
const options = (): string[] => [...host.querySelectorAll('[role="option"] .q3-plsearch__name')].map((n) => n.textContent ?? '')

beforeEach(async () => {
  ;(window as unknown as { quot3: unknown }).quot3 = {
    pricelist: {
      tree: vi.fn(async () => ({ ok: true, data: tree })),
      rows: vi.fn(async (tabId: string) => ({ ok: true, data: tabId === 't1' ? [mkRow('r1', 'Acme one', 0), mkRow('r2', 'Acme two', 1), mkRow('r3', 'Acme three', 2)] : [mkRow('b1', 'Big bolt', 0, 't2')] })),
      saveRows: vi.fn(), structure: vi.fn(), columns: vi.fn()
    }
  }
  st().reset()
  await st().load()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(createElement(PriceSearchBox, { inputRef })) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); st().reset(); delete (window as unknown as { quot3?: unknown }).quot3; vi.restoreAllMocks() })

describe('Phase 252 - Price List one search', () => {
  it('ROOT CAUSE (kept as a note): the old filter box called setFilter, which resets the grid cursor to row 0, and the grid input then takes the focus', () => {
    st().clickCell(2, 0)
    expect(st().nav.row).toBe(2)
    st().setFilter({ contains: 'a' })
    expect(st().nav.row).toBe(0) // the grid's focus effect depends on nav.row, so a changed row moved the focus into the grid
  })

  it('typing several letters keeps the focus in the box and never touches the grid cursor, the filter or the focus tick', async () => {
    st().clickCell(2, 0)
    const nav0 = st().nav
    const tick0 = st().focusTick
    const input = box()
    await act(async () => { input.focus() })
    for (const t of ['a', 'ac', 'acm', 'acme']) {
      await typeInto(input, t)
      expect(document.activeElement).toBe(input)
      expect(st().nav).toBe(nav0)
      expect(st().focusTick).toBe(tick0)
      expect(st().filter).toEqual({ noPrice: false, contains: '' })
    }
    await wait(330)
    expect(document.activeElement).toBe(input)
    expect(options()).toEqual(['Acme one', 'Acme two', 'Acme three'])
    expect(st().nav).toBe(nav0)
  })

  it('searches every tab, not only the open one', async () => {
    await act(async () => { box().focus() })
    await typeInto(box(), 'bolt')
    await wait(330)
    expect(options()).toEqual(['Big bolt'])
    expect(host.querySelector('.q3-plsearch__where')?.textContent).toBe('Big')
  })

  it('one letter searches nothing; no match says so', async () => {
    await act(async () => { box().focus() })
    await typeInto(box(), 'a')
    await wait(330)
    expect(options()).toEqual([])
    expect(host.querySelector('[role="status"]')?.textContent).toBe('')
    await typeInto(box(), 'zzzz')
    await wait(330)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Nothing found.')
  })

  it('Down moves the highlight, Enter opens it (the grid cursor goes to that row, the box empties)', async () => {
    await act(async () => { box().focus() })
    await typeInto(box(), 'acme')
    await wait(330)
    await key(box(), 'ArrowDown')
    expect(host.querySelector('[role="option"][aria-selected="true"] .q3-plsearch__name')?.textContent).toBe('Acme two')
    await key(box(), 'ArrowDown')
    await key(box(), 'ArrowDown') // clamped on the last result
    expect(host.querySelector('[role="option"][aria-selected="true"] .q3-plsearch__name')?.textContent).toBe('Acme three')
    await key(box(), 'ArrowUp')
    const before = st().focusTick
    await key(box(), 'Enter')
    await wait(0)
    expect(st().nav.row).toBe(1)
    expect(st().focusTick).toBe(before + 1)
    expect(box().value).toBe('')
    expect(options()).toEqual([])
  })

  it('Esc clears a typed search and stops there; with the box empty Esc is left for the page (Back)', async () => {
    await act(async () => { box().focus() })
    await typeInto(box(), 'acme')
    await wait(330)
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    const first = await key(box(), 'Escape')
    expect(first.defaultPrevented).toBe(true)
    expect(box().value).toBe('')
    expect(seen).not.toHaveBeenCalled() // stopped: the page's Back did not see it
    const second = await key(box(), 'Escape')
    expect(second.defaultPrevented).toBe(false)
    expect(seen).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', seen)
  })

  it('the pricelist.search action focuses and selects the box (through the page port)', async () => {
    st().setPorts({ focusSearch: () => { box().focus(); box().select() } })
    await typeInto(box(), 'abc')
    await act(async () => { (document.activeElement as HTMLElement | null)?.blur?.() })
    runPriceListAction('pricelist.search')
    expect(document.activeElement).toBe(box())
    expect(st().dialog).toBeNull() // no dialog any more
  })
})

describe('Phase 252 - nothing dangling', () => {
  it('the filter box, its shortcut and the Search-all dialog are gone from the sources', () => {
    const page = read('src/renderer/pages/PriceList.tsx')
    expect(page).not.toMatch(/Filter this tab|pricelist\.filter|focusFilter|SearchDialog|Search every tab/)
    expect(read('src/shared/shortcuts.ts')).not.toContain('pricelist.filter')
    expect(read('src/renderer/stores/priceListActions.ts')).not.toMatch(/pricelist\.filter|focusFilter/)
    expect(read('src/renderer/hooks/useAppActions.ts')).not.toContain('pricelist.filter')
    expect(read('src/renderer/components/pricelist/ToolsDialogs.tsx')).not.toContain('SearchDialog')
  })

  it('the page memory no longer restores an old remembered filter text (it could hide rows with no box to clear it)', async () => {
    const adapter = priceListAdapter(() => document.body)
    await adapter.apply({ path: '/pricelist', savedAt: 0, scroll: {}, filters: { contains: 'zzz', noPrice: true }, panels: {} })
    expect(st().filter).toEqual({ noPrice: true, contains: '' })
    expect(adapter.capture().filters).toEqual({ noPrice: true })
  })
})
