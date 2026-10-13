// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Items from '../../../pages/Items'
import { nextWindow, useItemsStore } from '../../../stores/itemsStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { currentPath, initialNav, navPush, ROUTES } from '@shared/routes'
import type { GroupSummary, ItemsOverview } from '@shared/items/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const g = (id: string, display: string): GroupSummary => ({ id, display, count: 3, nonGstCount: 3, gstCount: 0, lastUsed: '2026-10-01', familyId: null, spellingCount: 1, suggestionCount: 0 })
const overview = (groups: GroupSummary[]): ItemsOverview => ({ groups, families: [], notItems: [], bills: 7, lines: 20, builtAt: '2026-10-11T00:00:00Z' })

let host: HTMLDivElement
let root: Root
let current: ItemsOverview
let rebuild: ReturnType<typeof vi.fn>

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Items)
}
async function mount(): Promise<void> {
  await act(async () => { root.render(createElement(Shell)) })
  await act(async () => { await Promise.resolve() })
}
const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = document.activeElement ?? document.body): void => {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
}
const content = (n: 1 | 2 | 3): HTMLElement => host.querySelectorAll<HTMLElement>('.q3-items__content')[n - 1]!

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  current = overview([g('a', 'AMETO SMALL'), g('b', 'AMETO BIG'), g('c', 'TALCO 2044')])
  rebuild = vi.fn(async () => ({ ok: true as const, data: { bills: 7, lines: 20, spellings: 3, groups: 3, ms: 1 } }))
  ;(window as unknown as { quot3: unknown }).quot3 = { items: { overview: vi.fn(async () => ({ ok: true as const, data: current })), rebuild } }
  useItemsStore.setState({ status: 'idle', error: '', overview: null, query: '', selectedGroupId: null, window: 'groups', rebuilding: false, progress: null })
  useRouter.setState({ nav: navPush(initialNav(), ROUTES.items), navCount: 0 })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Phase 112 Items page shell', () => {
  it('shows the three windows, loads the overview and selects the first group', async () => {
    await mount()
    expect(host.querySelectorAll('.q3-items__frame')).toHaveLength(3)
    expect(Array.from(host.querySelectorAll('.q3-items__title > span:first-child')).map((e) => e.textContent)).toEqual(['Groups', 'Spellings', 'Sales'])
    expect(useItemsStore.getState().status).toBe('ready')
    expect(useItemsStore.getState().selectedGroupId).toBe('a')
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('3 items from 7 bills')
    expect(document.activeElement).toBe(content(1))
  })
  it('Tab / Shift+Tab walk the windows and wrap; Ctrl+Alt+1/2/3 jump', async () => {
    await mount()
    key({ key: 'Tab' })
    expect(document.activeElement).toBe(content(2))
    key({ key: 'Tab' })
    expect(document.activeElement).toBe(content(3))
    key({ key: 'Tab' })
    expect(document.activeElement).toBe(content(1))
    key({ key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(content(3))
    key({ key: '2', ctrlKey: true, altKey: true })
    expect(document.activeElement).toBe(content(2))
    expect(useItemsStore.getState().window).toBe('spellings')
    key({ key: '1', ctrlKey: true, altKey: true })
    expect(document.activeElement).toBe(content(1))
  })
  it('Ctrl+F focuses the search; typing filters; Down returns to Groups; Esc clears first, then leaves the box', async () => {
    await mount()
    key({ key: 'f', ctrlKey: true })
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search items"]')!
    expect(document.activeElement).toBe(input)
    act(() => { useItemsStore.getState().setQuery('ameto') })
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('2 of 3 items from 7 bills')
    key({ key: 'Escape' }, input)
    expect(useItemsStore.getState().query).toBe('')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.items) // Esc in the box did not navigate
    key({ key: 'Escape' }, input)
    expect(document.activeElement).toBe(content(1))
    key({ key: 'f', ctrlKey: true })
    key({ key: 'ArrowDown' }, input)
    expect(document.activeElement).toBe(content(1))
  })
  it('Esc on the page goes to the Dashboard and stops there', async () => {
    await mount()
    key({ key: 'Escape' })
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.dashboard)
    key({ key: 'Escape' })
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.dashboard)
  })
  it('F5 rebuilds and reloads', async () => {
    await mount()
    await act(async () => { key({ key: 'F5' }); await Promise.resolve(); await Promise.resolve() })
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(useItemsStore.getState().rebuilding).toBe(false)
  })
  it('empty database: friendly empty state, no windows', async () => {
    current = overview([])
    await mount()
    expect(host.textContent).toContain('No items yet')
    expect(host.querySelectorAll('.q3-items__frame')).toHaveLength(0)
  })
  it('a service error is shown, not thrown', async () => {
    ;(window as unknown as { quot3: unknown }).quot3 = { items: { overview: vi.fn(async () => ({ ok: false as const, error: { code: 'INTERNAL', message: 'boom' } })) } }
    await mount()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('boom')
  })
  it('a reload keeps the selection when the group still exists, else selects the first', async () => {
    await mount()
    act(() => { useItemsStore.getState().selectGroup('c') })
    await act(async () => { await useItemsStore.getState().load() })
    expect(useItemsStore.getState().selectedGroupId).toBe('c')
    current = overview([g('a', 'AMETO SMALL')])
    await act(async () => { await useItemsStore.getState().load() })
    expect(useItemsStore.getState().selectedGroupId).toBe('a')
  })
  it('selector stability: the store hands out the same overview object between renders', async () => {
    await mount()
    const a = useItemsStore.getState().overview
    act(() => { useItemsStore.getState().setWindow('sales') })
    expect(useItemsStore.getState().overview).toBe(a)
  })
})

describe('Phase 112 pure helpers', () => {
  it('nextWindow wraps both ways', () => {
    expect(nextWindow('groups', 1)).toBe('spellings')
    expect(nextWindow('sales', 1)).toBe('groups')
    expect(nextWindow('groups', -1)).toBe('sales')
  })
})
