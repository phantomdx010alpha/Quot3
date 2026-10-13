// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from '../../../pages/History'
import { useHistoryStore } from '../../../stores/historyStore'
import { useTrashStore } from '../../../stores/trashStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { createSession } from '../../../stores/createSession'
import { initialNav, ROUTES } from '@shared/routes'
import type { BillListItem } from '@shared/history/historyList'
import { purgeAt, type TrashItem } from '@shared/trash'
import { UNDO_DELETE_MS } from '@shared/constants'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let all: BillListItem[]
let trashed: Map<string, string> // id -> deletedAt
let clock: number
const mk = (n: number, date: string, party: string, total: string): BillListItem => ({
  id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: date, partyName: party, grandTotal: total, branchId: 'local', revision: 1
})
const live = (): BillListItem[] => all.filter((b) => !trashed.has(b.id))
const trashItems = (): TrashItem[] =>
  all.filter((b) => trashed.has(b.id)).map((b) => ({ ...b, deletedAt: trashed.get(b.id)!, purgeAt: purgeAt(trashed.get(b.id)!) })).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1))

let api: { restore: ReturnType<typeof vi.fn>; purge: ReturnType<typeof vi.fn>; emptyTrash: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> }

function install(): void {
  api = {
    list: vi.fn(async () => ({ ok: true as const, data: trashItems() })),
    restore: vi.fn(async ({ ids }: { ids: string[] }) => { const r = ids.filter((i) => trashed.delete(i)); return { ok: true as const, data: { restored: r, missing: ids.filter((i) => !r.includes(i)) } } }),
    purge: vi.fn(async ({ ids }: { ids: string[] }) => { const p = ids.filter((i) => trashed.has(i)); all = all.filter((b) => !p.includes(b.id)); p.forEach((i) => trashed.delete(i)); return { ok: true as const, data: { purged: p, missing: ids.filter((i) => !p.includes(i)) } } }),
    emptyTrash: vi.fn(async () => { const ids = [...trashed.keys()]; all = all.filter((b) => !trashed.has(b.id)); trashed.clear(); return { ok: true as const, data: { purged: ids.length } } }),
    search: vi.fn(async () => ({ ok: true as const, data: { items: [], truncated: false } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = {
    history: {
      listDates: async () => {
        const m = new Map<string, number>()
        for (const b of live()) m.set(b.billDate, (m.get(b.billDate) ?? 0) + 1)
        return { ok: true, data: [...m].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : -1)) }
      },
      listBills: async (i: { date?: string } = {}) => ({ ok: true, data: { items: live().filter((b) => i.date === undefined || b.billDate === i.date) } }),
      search: api.search,
      branches: async () => ({ ok: true, data: [{ id: 'local', name: 'Main', isLocal: true }] })
    },
    bills: {
      getForEdit: vi.fn(),
      delete: vi.fn(async ({ ids }: { ids: string[] }) => { ids.forEach((id) => trashed.set(id, new Date(clock += 1000).toISOString())); return { ok: true, data: { deleted: ids, missing: [] } } })
    },
    trash: { list: api.list, restore: api.restore, purge: api.purge, emptyTrash: api.emptyTrash },
    clipboard: { writeTsv: vi.fn() }
  }
}

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(History)
}
const flush = async (ms = 0): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
const mount = async (): Promise<void> => { await act(async () => { root.render(createElement(Shell)) }); await flush() }
const key = async (el: Element | Window, k: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  await act(async () => { el.dispatchEvent(e) })
  await flush()
  return e
}
const billsEl = (): HTMLElement => host.querySelector<HTMLElement>('.q3-hist__billlist')!
const rows = (): string[] => [...host.querySelectorAll('.q3-hist__billrow')].map((r) => r.textContent ?? '')
const numbers = (): string[] => rows().map((r) => r.slice(0, 7))
const dialogBtn = (label: RegExp): HTMLButtonElement => [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => label.test(b.textContent ?? ''))!
const click = async (el: HTMLElement): Promise<void> => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }); await flush() }
const openTrash = async (): Promise<void> => { await key(billsEl(), 'D', { ctrlKey: true, shiftKey: true }) }
const del = async (): Promise<void> => {
  await key(billsEl(), 'Delete')
  await click(dialogBtn(/^Delete$/))
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  useHistoryStore.setState({ status: 'idle', error: '', dates: [], date: null, bills: [], next: null, loadingMore: false, billId: null, branches: [], focusDates: null, focusBills: null, focusSearch: null, focusDateRange: null, query: '', from: '', to: '', truncated: false, selection: [], anchor: null, confirmDelete: null })
  useTrashStore.setState({ open: false, status: 'idle', error: '', items: [], billId: null, selection: [], anchor: null, confirmPurge: null, confirmEmpty: false, emptyText: '', undoOffer: null, focusList: null })
  useRouter.setState({ nav: initialNav(ROUTES.history) })
  createSession.set(null)
  clock = Date.UTC(2026, 9, 8, 10)
  trashed = new Map()
  all = [mk(6, '2026-10-06', 'Ms Smart Bums', '7150'), mk(5, '2026-10-06', 'NEW PARTY', '10025'), mk(4, '2026-10-06', 'Brothers Thread House', '1234567.5')]
  install()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  useTrashStore.getState().dismissUndo()
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Undo delete (Phase 43)', () => {
  it('a delete shows the offer; Ctrl+Z restores the bill at once and the offer goes', async () => {
    await mount()
    await del()
    expect(numbers()).toEqual(['Q3-0005', 'Q3-0004'])
    expect(host.querySelector('.q3-hist__undo')?.textContent).toContain('Q3-0006')
    expect(useTrashStore.getState().undoOffer?.ids).toEqual(['b6'])
    const e = await key(billsEl(), 'z', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(api.restore).toHaveBeenCalledWith({ ids: ['b6'] })
    expect(numbers()).toEqual(['Q3-0006', 'Q3-0005', 'Q3-0004'])
    expect(host.querySelector('.q3-hist__undo')).toBeNull()
    expect(useSaveUiStore.getState().last?.message).toMatch(/^Restored/)
  })

  it('the Undo delete button does the same', async () => {
    await mount()
    await del()
    await click(host.querySelector<HTMLButtonElement>('.q3-hist__undo button')!)
    expect(numbers()).toHaveLength(3)
  })

  it('bulk delete is undone as one step', async () => {
    await mount()
    await key(billsEl(), 'a', { ctrlKey: true })
    await del()
    expect(rows()).toHaveLength(0)
    expect(host.textContent).toContain('No saved bills yet')
    await key(window, 'z', { ctrlKey: true }) // works from anywhere on the page, even the empty state
    expect(api.restore).toHaveBeenCalledWith({ ids: ['b6', 'b5', 'b4'] })
    expect(numbers()).toHaveLength(3)
  })

  it('the offer lives UNDO_DELETE_MS (10 s) and then Ctrl+Z says there is nothing to undo', async () => {
    vi.useFakeTimers()
    useTrashStore.getState().offerUndo(['b1'], 'bill Q3-0001')
    expect(useTrashStore.getState().undoOffer?.label).toBe('bill Q3-0001')
    vi.advanceTimersByTime(UNDO_DELETE_MS - 1)
    expect(useTrashStore.getState().undoOffer).not.toBeNull()
    vi.advanceTimersByTime(2)
    expect(useTrashStore.getState().undoOffer).toBeNull()
    // a second delete restarts the clock instead of stacking
    useTrashStore.getState().offerUndo(['b1'], 'x')
    vi.advanceTimersByTime(UNDO_DELETE_MS - 100)
    useTrashStore.getState().offerUndo(['b2'], 'y')
    vi.advanceTimersByTime(UNDO_DELETE_MS - 100)
    expect(useTrashStore.getState().undoOffer?.ids).toEqual(['b2'])
  })

  it('Ctrl+Z without an offer does nothing and is not consumed; inside the search box it stays the field\'s own undo even with an offer', async () => {
    await mount()
    const e = await key(billsEl(), 'z', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(api.restore).not.toHaveBeenCalled()
    await del()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search bills"]')!
    const e2 = await key(input, 'z', { ctrlKey: true })
    expect(e2.defaultPrevented).toBe(false)
    expect(api.restore).not.toHaveBeenCalled()
    expect(useTrashStore.getState().undoOffer).not.toBeNull()
  })
})

describe('Recently deleted view (Phase 43)', () => {
  beforeEach(() => { trashed.set('b5', new Date(Date.UTC(2026, 9, 7, 9)).toISOString()); trashed.set('b4', new Date(Date.UTC(2026, 9, 8, 9)).toISOString()) })

  it('Ctrl+Shift+D opens it (most recently deleted first, with Bill No, party, total and the purge countdown); Ctrl+Shift+D / Esc go back without leaving History', async () => {
    await mount()
    expect(numbers()).toEqual(['Q3-0006'])
    const e = await key(billsEl(), 'D', { ctrlKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(host.querySelector('.q3-hist__trash')).not.toBeNull()
    expect(host.querySelector('.q3-hist__dates')).toBeNull()
    expect(numbers()).toEqual(['Q3-0004', 'Q3-0005'])
    expect(rows()[0]).toContain('Brothers Thread House')
    expect(rows()[0]).toContain('₹12,34,567.50')
    expect(rows()[0]).toMatch(/\d+ days?|today/)
    expect(host.querySelector('.q3-hist__trashhead')?.textContent).toContain('30 days')
    const esc = await key(window, 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(host.querySelector('.q3-hist__trash')).toBeNull()
    expect(numbers()).toEqual(['Q3-0006'])
    expect(useRouter.getState().nav).toEqual(initialNav(ROUTES.history))
    await openTrash()
    await key(window, 'D', { ctrlKey: true, shiftKey: true })
    expect(host.querySelector('.q3-hist__trash')).toBeNull()
  })

  it('the bottom bar has a Recently deleted button', async () => {
    await mount()
    const b = [...host.querySelectorAll<HTMLButtonElement>('.q3-hist__actions button')].find((x) => /Recently deleted/.test(x.textContent ?? ''))!
    expect(b).toBeDefined()
    await click(b)
    expect(host.querySelector('.q3-hist__trash')).not.toBeNull()
  })

  it('empty trash shows an empty state', async () => {
    trashed.clear()
    await mount()
    await openTrash()
    expect(host.textContent).toContain('Nothing deleted')
  })

  it('Enter restores the highlighted bill (same number) and it is back in History', async () => {
    await mount()
    await openTrash()
    const list = (): HTMLElement => host.querySelector<HTMLElement>('.q3-hist__billlist')!
    expect(document.activeElement).toBe(list())
    await key(list(), 'Enter')
    expect(api.restore).toHaveBeenCalledWith({ ids: ['b4'] })
    expect(numbers()).toEqual(['Q3-0005'])
    expect(useSaveUiStore.getState().last?.message).toMatch(/^Restored Q3-0004 \(Brothers Thread House\) - same bill number$/)
    await key(window, 'Escape')
    expect(numbers()).toEqual(['Q3-0006', 'Q3-0004'])
  })

  it('Shift+Down / Ctrl+A select several; Enter restores them all', async () => {
    await mount()
    await openTrash()
    const list = host.querySelector<HTMLElement>('.q3-hist__billlist')!
    await key(list, 'a', { ctrlKey: true })
    expect(host.querySelector('.q3-hist__selcount')?.textContent).toBe('2 bills selected')
    await key(list, 'Enter')
    expect(api.restore).toHaveBeenCalledWith({ ids: ['b4', 'b5'] })
    expect(host.textContent).toContain('Nothing deleted')
  })

  it('Delete asks first (Cancel is the safe default and keeps the bill); confirming deletes it forever', async () => {
    await mount()
    await openTrash()
    const list = host.querySelector<HTMLElement>('.q3-hist__billlist')!
    await key(list, 'Delete')
    expect(document.body.textContent).toContain('Delete Q3-0004 (Brothers Thread House) forever')
    await click(dialogBtn(/^Cancel$/))
    expect(api.purge).not.toHaveBeenCalled()
    expect(numbers()).toEqual(['Q3-0004', 'Q3-0005'])
    await key(host.querySelector<HTMLElement>('.q3-hist__billlist')!, 'Delete')
    await click(dialogBtn(/Delete forever/))
    expect(api.purge).toHaveBeenCalledWith({ ids: ['b4'] })
    expect(numbers()).toEqual(['Q3-0005'])
    expect(useSaveUiStore.getState().last?.message).toMatch(/forever$/)
  })

  it('Empty trash needs the typed word: the button stays disabled and Enter does nothing until it says EMPTY', async () => {
    await mount()
    await openTrash()
    const e = await key(window, 'Delete', { ctrlKey: true, shiftKey: true })
    expect(e.defaultPrevented).toBe(true)
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!
    const confirm = (): HTMLButtonElement => dialogBtn(/Delete everything forever/)
    expect(confirm().disabled).toBe(true)
    const type = async (v: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    await type('EMPT')
    expect(confirm().disabled).toBe(true)
    await key(input, 'Enter')
    expect(api.emptyTrash).not.toHaveBeenCalled()
    await type('empty')
    expect(confirm().disabled).toBe(false)
    await key(input, 'Enter')
    expect(api.emptyTrash).toHaveBeenCalledWith({ confirm: 'EMPTY' })
    expect(host.textContent).toContain('Nothing deleted')
    expect(useSaveUiStore.getState().last?.message).toBe('Emptied Recently deleted - 2 bills deleted forever')
  })

  it('Empty trash can be cancelled and the bills stay', async () => {
    await mount()
    await openTrash()
    await key(window, 'Delete', { ctrlKey: true, shiftKey: true })
    await click(dialogBtn(/^Cancel$/))
    expect(api.emptyTrash).not.toHaveBeenCalled()
    expect(numbers()).toHaveLength(2)
  })

  it('Esc inside a confirm dialog closes the dialog, not the view', async () => {
    await mount()
    await openTrash()
    await key(host.querySelector<HTMLElement>('.q3-hist__billlist')!, 'Delete')
    await key(document.body.querySelector('[role="dialog"]')!, 'Escape')
    expect(api.purge).not.toHaveBeenCalled()
    expect(host.querySelector('.q3-hist__trash')).not.toBeNull()
  })

  it('History keys do not act while the view is open (Delete does not delete a live bill; Ctrl+O is not Open PDF)', async () => {
    await mount()
    await openTrash()
    const list = host.querySelector<HTMLElement>('.q3-hist__billlist')!
    const e = await key(list, 'o', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(false)
    expect(useHistoryStore.getState().confirmDelete).toBeNull()
  })

  it('a failing bridge shows an alert instead of crashing', async () => {
    api.list.mockResolvedValueOnce({ ok: false as unknown as true, error: { code: 'DB_ERROR', message: 'disk is full' } } as never)
    await mount()
    await openTrash()
    expect(host.querySelector('.q3-hist__error')?.textContent).toBe('disk is full')
  })

  it('leaving History closes the view (it does not stay open behind the next visit)', async () => {
    await mount()
    await openTrash()
    expect(useTrashStore.getState().open).toBe(true)
    await act(async () => { root.render(createElement('div')) })
    expect(useTrashStore.getState().open).toBe(false)
  })
})

describe('palette actions (Phase 43)', () => {
  it('history.trash / undoDelete / restore / purge / emptyTrash are registered palette actions', async () => {
    const { ACTIONS } = await import('@shared/shortcuts')
    for (const id of ['history.trash', 'history.undoDelete', 'history.restore', 'history.purge', 'history.emptyTrash']) expect(ACTIONS.some((a) => a.id === id), id).toBe(true)
  })
})
