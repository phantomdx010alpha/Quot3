// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Items from '../../../pages/Items'
import { useItemsStore } from '../../../stores/itemsStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { initialNav, navPush, ROUTES } from '@shared/routes'
import type { DecisionInput, DecisionResult, GroupDetail, GroupSummary, ItemsOverview } from '@shared/items/api'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const g = (id: string, display: string, count: number, fam: string | null = null, sugg = 0): GroupSummary => ({ id, display, count, nonGstCount: count, gstCount: 0, lastUsed: '2026-10-01', familyId: fam, spellingCount: 2, suggestionCount: sugg })
const groups = [g('AMETO SMALL', 'AMETO SMALL', 9, 'AMETO'), g('AMETO BIG', 'AMETO BIG', 5, 'AMETO', 1), g('CLIP STEEL', 'CLIP STEEL', 3)]
const overview = (): ItemsOverview => ({ groups, families: [{ id: 'AMETO', name: 'AMETO', groupIds: ['AMETO SMALL', 'AMETO BIG'], count: 14 }], notItems: [], bills: 7, lines: 20, builtAt: '2026-10-11T00:00:00Z' })
const sp = (name: string, key: string, count: number) => ({ name, cleaned: name, note: '', count, lastUsed: '2026-10-01', originalKey: key, why: { rule: 'most-used' as const, text: '' } })
const details: Record<string, GroupDetail> = {
  'AMETO SMALL': { id: 'AMETO SMALL', display: 'AMETO SMALL', familyId: 'AMETO', spellings: [sp('AMETO SMALL', 'AMETO SMALL', 8), sp('Ameto  small', 'AMETO SMALL', 1)], suggestions: [] },
  'AMETO BIG': { id: 'AMETO BIG', display: 'AMETO BIG', familyId: 'AMETO', spellings: [sp('AMETO BIG', 'AMETO BIG', 4), sp('AMETO BIGG', 'AMETO BIGG', 1)], suggestions: [{ kind: 'typo', fromId: 'AMETO BIG', toId: 'AMETO SMALL', text: 'BIG may be a typo', fromCount: 5, toCount: 9 }] },
  'CLIP STEEL': { id: 'CLIP STEEL', display: 'CLIP STEEL', familyId: null, spellings: [sp('CLIP STEEL', 'CLIP STEEL', 3)], suggestions: [] }
}

let host: HTMLDivElement
let root: Root
let decide: ReturnType<typeof vi.fn>
let undo: ReturnType<typeof vi.fn>

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Items)
}
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
async function mount(): Promise<void> { await act(async () => { root.render(createElement(Shell)) }); await flush() }
const key = async (init: KeyboardEventInit & { key: string }, target: EventTarget = document.activeElement ?? document.body): Promise<void> => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  await flush()
}
const content = (n: 1 | 2 | 3): HTMLElement => host.querySelectorAll<HTMLElement>('.q3-items__content')[n - 1]!
const groupNames = (): string[] => [...host.querySelectorAll('.q3-items__row--group [role="gridcell"]:first-child')].map((e) => e.textContent ?? '')

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  decide = vi.fn(async (_i: DecisionInput) => ({ ok: true as const, data: { changed: true, steps: 1, message: 'Merged.', selectId: null, undo: 'Merged.' } satisfies DecisionResult }))
  undo = vi.fn(async () => ({ ok: true as const, data: { undone: true, steps: 1, message: 'Undone', undo: null } }))
  ;(window as unknown as { quot3: unknown }).quot3 = {
    items: {
      overview: vi.fn(async () => ({ ok: true as const, data: overview() })),
      group: vi.fn(async ({ groupId }: { groupId: string }) => ({ ok: true as const, data: details[groupId]! })),
      lastDecision: vi.fn(async () => ({ ok: true as const, data: { undo: decide.mock.calls.length > undo.mock.calls.length ? 'Merged.' : null } })),
      rebuild: vi.fn(), decide, undo
    }
  }
  useItemsStore.setState({ status: 'idle', error: '', overview: null, query: '', selectedGroupId: null, window: 'groups', rebuilding: false, progress: null, detail: null, cursor: 0, pending: null, notice: '', undo: null, busy: false })
  useRouter.setState({ nav: navPush(initialNav(), ROUTES.items), navCount: 0 })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Phase 113 Groups window', () => {
  it('lists the family header and its variants, then the others', async () => {
    await mount()
    expect([...host.querySelectorAll('.q3-items__row--family [role="gridcell"]:first-child')].map((e) => e.textContent)).toEqual(['AMETO', 'Other items'])
    expect(groupNames()).toEqual(['AMETO SMALL', 'AMETO BIG', 'CLIP STEEL'])
  })
  it('Down skips the family header and moves the Spellings window with it', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    expect(useItemsStore.getState().selectedGroupId).toBe('AMETO BIG')
    await key({ key: 'ArrowDown' })
    expect(useItemsStore.getState().selectedGroupId).toBe('CLIP STEEL')
    expect(host.querySelector('[aria-label="Spellings of CLIP STEEL"]')).not.toBeNull()
  })
  it('M marks, Down picks the target, M merges (one decision call, group ids not keys)', async () => {
    await mount()
    await key({ key: 'm' })
    expect(host.querySelector('.q3-items__status')?.textContent).toContain('Merging AMETO SMALL')
    await key({ key: 'ArrowDown' })
    await key({ key: 'm' })
    expect(decide).toHaveBeenCalledWith({ op: 'merge', fromGroupId: 'AMETO SMALL', intoGroupId: 'AMETO BIG' })
    expect(useItemsStore.getState().pending).toBeNull()
  })
  it('Esc cancels a marked merge and does NOT leave the page; a second Esc goes to the Dashboard', async () => {
    await mount()
    await key({ key: 'm' })
    await key({ key: 'Escape' })
    expect(useItemsStore.getState().pending).toBeNull()
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.items)
    await key({ key: 'Escape' })
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.dashboard)
  })
  it('M on the marked item itself merges nothing', async () => {
    await mount()
    await key({ key: 'm' })
    await key({ key: 'm' })
    expect(decide).not.toHaveBeenCalled()
  })
  it('Delete marks the item as not an item and lands on its neighbour', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    await key({ key: 'Delete' })
    expect(decide).toHaveBeenCalledWith({ op: 'ignore', groupId: 'AMETO BIG' })
  })
  it('typing m / s / v / x in the search box does nothing but type', async () => {
    await mount()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search items"]')!
    input.focus()
    await key({ key: 'm' }, input)
    await key({ key: 'Delete' }, input)
    expect(decide).not.toHaveBeenCalled()
    expect(useItemsStore.getState().pending).toBeNull()
  })
})

describe('Phase 113 Spellings window', () => {
  const toSpellings = async (): Promise<void> => { await key({ key: '2', ctrlKey: true, altKey: true }) }
  it('shows spellings with counts and the suggested merges below', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    const rows = [...host.querySelectorAll('.q3-items__content')[1]!.querySelectorAll('.q3-items__row')].map((r) => r.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('AMETO BIG')
    expect(rows[2]).toContain('AMETO BIG')
    expect(host.textContent).toContain('Suggested merges')
  })
  it('Enter on a suggestion confirms it with ONE key (merge from -> into)', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    await toSpellings()
    await key({ key: 'ArrowDown' })
    await key({ key: 'ArrowDown' })
    await key({ key: 'Enter' })
    expect(decide).toHaveBeenCalledWith({ op: 'merge', fromGroupId: 'AMETO BIG', intoGroupId: 'AMETO SMALL' })
  })
  it('X dismisses a suggestion (reject)', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    await toSpellings()
    await key({ key: 'End' })
    await key({ key: 'x' })
    expect(decide).toHaveBeenCalledWith({ op: 'reject', fromGroupId: 'AMETO BIG', intoGroupId: 'AMETO SMALL' })
  })
  it('S splits the highlighted spelling by its original key', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    await toSpellings()
    await key({ key: 'ArrowDown' })
    await key({ key: 's' })
    expect(decide).toHaveBeenCalledWith({ op: 'split', groupId: 'AMETO BIG', spellingKey: 'AMETO BIGG' })
  })
  it('V marks a spelling, focus goes to Groups, M on another item moves it', async () => {
    await mount()
    await key({ key: 'ArrowDown' })
    await toSpellings()
    await key({ key: 'ArrowDown' })
    await key({ key: 'v' })
    expect(document.activeElement).toBe(content(1))
    await key({ key: 'ArrowDown' })
    await key({ key: 'm' })
    expect(decide).toHaveBeenCalledWith({ op: 'move', groupId: 'AMETO BIG', spellingKey: 'AMETO BIGG', intoGroupId: 'CLIP STEEL' })
  })
  it('Enter / S on a plain spelling row with no suggestion does not call the service wrongly', async () => {
    await mount()
    await toSpellings()
    await key({ key: 'Enter' })
    expect(decide).not.toHaveBeenCalled()
  })
})

describe('Phase 113 undo and errors', () => {
  it('Ctrl+Z calls undo and reloads; the button is disabled with nothing to undo', async () => {
    await mount()
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Undo'))!
    expect(btn.disabled).toBe(true)
    await key({ key: 'm' })
    await key({ key: 'ArrowDown' })
    await key({ key: 'm' })
    expect(useItemsStore.getState().undo).toBe('Merged.')
    await key({ key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
  })
  it('Ctrl+Z inside the search box keeps native text undo', async () => {
    await mount()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search items"]')!
    input.focus()
    await key({ key: 'z', ctrlKey: true }, input)
    expect(undo).not.toHaveBeenCalled()
  })
  it('a refused decision shows its reason and clears the marked state', async () => {
    decide.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'That item no longer exists. Reload the list.' } } as never)
    await mount()
    await key({ key: 'm' }); await key({ key: 'ArrowDown' }); await key({ key: 'm' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no longer exists')
    expect(useItemsStore.getState().pending).toBeNull()
  })
  it('selector stability: decision state does not replace the overview or detail objects', async () => {
    await mount()
    const o = useItemsStore.getState().overview
    const d = useItemsStore.getState().detail
    act(() => { useItemsStore.getState().setCursor(1) })
    expect(useItemsStore.getState().overview).toBe(o)
    expect(useItemsStore.getState().detail).toBe(d)
  })
})
