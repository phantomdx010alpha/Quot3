// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from '../../../pages/History'
import { useHistoryStore } from '../../../stores/historyStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { usePrintUiStore } from '../../../stores/printUiStore'
import { useSaveUiStore } from '../../../stores/saveUiStore'
import { useBillStore } from '../../../stores/billStore'
import { createSession } from '../../../stores/createSession'
import { initialNav, ROUTES } from '@shared/routes'
import type { BillListItem } from '@shared/history/historyList'
import { rankBills, type SearchCandidate } from '@shared/history/historySearch'
import type { Bill } from '@shared/types'
import { row } from '../../../../shared/__fixtures__/bills'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let all: BillListItem[]
let deleted: Set<string>
const mk = (n: number, date: string, party: string, total: string): BillListItem => ({
  id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: date, partyName: party, grandTotal: total, branchId: 'local', revision: 1
})
const live = (): BillListItem[] => all.filter((b) => !deleted.has(b.id))
const savedBill = (id: string): Bill => ({
  id, branchId: 'local', poSeq: 5, poNumber: 'Q3-0005', partyId: null, party: { name: 'NEW PARTY', phone: '', address: '', transport: '' }, formatId: 'non_gst',
  extraCols: [], paperOverride: null, billDate: '2026-10-06', rows: [row('Pen', '2', '10')], revision: 1, createdAt: 'x', updatedAt: 'x', deletedAt: null, syncState: 'local_only'
})

let api: {
  listDates: ReturnType<typeof vi.fn>; listBills: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn>
  getForEdit: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn>; writeTsv: ReturnType<typeof vi.fn>
}

function install(): void {
  const inRange = (b: BillListItem, i: { from?: string; to?: string }): boolean => (!i.from || b.billDate >= i.from) && (!i.to || b.billDate <= i.to)
  api = {
    listDates: vi.fn(async (i: { from?: string; to?: string } = {}) => {
      const m = new Map<string, number>()
      for (const b of live().filter((x) => inRange(x, i))) m.set(b.billDate, (m.get(b.billDate) ?? 0) + 1)
      return { ok: true as const, data: [...m].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : -1)) }
    }),
    listBills: vi.fn(async (i: { date?: string; from?: string; to?: string } = {}) => ({ ok: true as const, data: { items: live().filter((b) => (i.date === undefined || b.billDate === i.date) && inRange(b, i)) } })),
    search: vi.fn(async (i: { query: string; from?: string; to?: string }) => {
      const cands: SearchCandidate[] = live().filter((b) => inRange(b, i)).map((b) => ({ ...b, itemText: '' }))
      const r = rankBills(cands, i.query)
      return { ok: true as const, data: { items: r.hits, truncated: r.truncated } }
    }),
    getForEdit: vi.fn(async (id: string) => ({ ok: true as const, data: savedBill(id) })),
    del: vi.fn(async ({ ids }: { ids: string[] }) => { ids.forEach((id) => deleted.add(id)); return { ok: true as const, data: { deleted: ids, missing: [] } } }),
    writeTsv: vi.fn(async () => ({ ok: true as const, data: {} }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = {
    history: { listDates: api.listDates, listBills: api.listBills, search: api.search, branches: async () => ({ ok: true, data: [{ id: 'local', name: 'Main', isLocal: true }] }) },
    bills: { getForEdit: api.getForEdit, delete: api.del },
    clipboard: { writeTsv: api.writeTsv },
    print: { decide: vi.fn(async () => ({ ok: false, error: { code: 'X', message: 'no printer in tests' } })) }
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
const searchEl = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[aria-label="Search bills"]')!
const rows = (): string[] => [...host.querySelectorAll('.q3-hist__billrow')].map((r) => r.textContent ?? '')
const btn = (label: RegExp): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('.q3-hist__actions button')].find((b) => label.test(b.textContent ?? ''))!
const type = async (el: HTMLInputElement, v: string): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  useHistoryStore.setState({ status: 'idle', error: '', dates: [], date: null, bills: [], next: null, loadingMore: false, billId: null, branches: [], focusDates: null, focusBills: null, focusSearch: null, focusDateRange: null, query: '', from: '', to: '', truncated: false, selection: [], anchor: null, confirmDelete: null })
  useRouter.setState({ nav: initialNav(ROUTES.history) })
  usePrintUiStore.setState({ open: false, bill: null })
  deleted = new Set()
  all = [
    mk(6, '2026-10-06', 'Ms Smart Bums', '7150'),
    mk(5, '2026-10-06', 'NEW PARTY', '10025'),
    mk(4, '2026-10-06', 'Brothers Thread House', '1234567.5'),
    mk(3, '2026-10-05', 'Zakers Clothing', '9350'),
    mk(2, '2026-10-05', 'LAKSHMI CLOTH CENTER', '6350'),
    mk(1, '2026-10-04', 'Old Party', '100')
  ]
  install()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
  vi.restoreAllMocks()
})

describe('History search and date range (Phase 42)', () => {
  it('typing searches after a short pause across ALL dates; the status line counts matches; Esc clears and restores the day', async () => {
    await mount()
    await type(searchEl(), 'party')
    expect(api.search).not.toHaveBeenCalled() // debounced
    await flush(260)
    expect(api.search).toHaveBeenCalledTimes(1)
    expect(api.search).toHaveBeenCalledWith({ query: 'party' })
    expect(rows().map((r) => r.slice(0, 7))).toEqual(['Q3-0005', 'Q3-0001'])
    expect(host.querySelector('.q3-hist__status')?.textContent).toBe('2 matches across all dates')
    expect(host.querySelector('.q3-hist__daterow[aria-selected="true"]')).toBeNull()
    const esc = await key(searchEl(), 'Escape')
    expect(esc.defaultPrevented).toBe(true) // never also "Back"
    expect(searchEl().value).toBe('')
    expect(useHistoryStore.getState().query).toBe('')
    expect(rows().map((r) => r.slice(0, 7))).toEqual(['Q3-0006', 'Q3-0005', 'Q3-0004'])
  })

  it('no match shows an empty message; Enter in the box sends focus to the results', async () => {
    await mount()
    await type(searchEl(), 'qqqqqq')
    await key(searchEl(), 'Enter')
    expect(host.querySelector('.q3-hist__none')?.textContent).toBe('No bills match this search')
    expect(document.activeElement).toBe(billsEl())
  })

  it('Ctrl+F focuses the search box from anywhere on the page (and the palette action does too)', async () => {
    await mount()
    expect(document.activeElement).not.toBe(searchEl())
    const e = await key(window, 'f', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(searchEl())
    ;(document.activeElement as HTMLElement).blur()
    useHistoryStore.getState().focusSearch?.()
    expect(document.activeElement).toBe(searchEl())
  })

  it('From / To narrow the dates and the list; a reversed range reports the error; Clear resets everything', async () => {
    await mount()
    const from = host.querySelector<HTMLInputElement>('input[aria-label="From date"]')!
    await type(from, '2026-10-05')
    await flush()
    expect(api.listDates).toHaveBeenLastCalledWith({ from: '2026-10-05' })
    expect([...host.querySelectorAll('.q3-hist__daterow')].map((r) => r.textContent)).toEqual(['06-10-263', '05-10-262'])
    const to = host.querySelector<HTMLInputElement>('input[aria-label="To date"]')!
    await type(to, '2026-10-05')
    await flush()
    expect([...host.querySelectorAll('.q3-hist__daterow')].map((r) => r.textContent)).toEqual(['05-10-262'])
    expect(rows().map((r) => r.slice(0, 7))).toEqual(['Q3-0003', 'Q3-0002'])
    await type(to, '2026-10-01')
    await flush()
    expect(host.querySelector('.q3-hist__error')?.textContent).toMatch(/From date is after/)
    await act(async () => { btn2('Clear search and date filter').click() })
    await flush()
    expect(useHistoryStore.getState()).toMatchObject({ from: '', to: '', query: '' })
    expect(host.querySelector('.q3-hist__error')).toBeNull()
  })

  it('the date filter also applies to a search', async () => {
    await mount()
    await type(host.querySelector<HTMLInputElement>('input[aria-label="From date"]')!, '2026-10-06')
    await flush()
    await type(searchEl(), 'party')
    await flush(260)
    expect(api.search).toHaveBeenLastCalledWith({ query: 'party', from: '2026-10-06' })
    expect(rows().map((r) => r.slice(0, 7))).toEqual(['Q3-0005'])
  })
})

const btn2 = (label: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!

describe('History actions and multi-select (Phase 42)', () => {
  const toBills = async (): Promise<void> => { await mount(); await key(host.querySelector('[aria-label="Bill dates, newest first"]')!, 'Enter') }

  it('Shift+arrows extend the selection, Space toggles, Ctrl+A selects all, a plain arrow collapses; the bar counts and disables single-bill buttons', async () => {
    await toBills()
    await key(billsEl(), 'ArrowDown', { shiftKey: true })
    expect(useHistoryStore.getState().selection).toEqual(['b6', 'b5'])
    await key(billsEl(), 'ArrowDown', { shiftKey: true })
    expect(useHistoryStore.getState().selection).toEqual(['b6', 'b5', 'b4'])
    expect(host.querySelector('.q3-hist__selcount')?.textContent).toBe('3 bills selected')
    expect(btn(/Print/).disabled).toBe(true)
    expect(btn(/Edit/).disabled).toBe(true)
    expect(btn(/Delete/).disabled).toBe(false)
    expect(host.querySelectorAll('.q3-hist__billrow[aria-selected="true"]')).toHaveLength(3)
    await key(billsEl(), 'ArrowUp', { shiftKey: true })
    expect(useHistoryStore.getState().selection).toEqual(['b6', 'b5'])
    await key(billsEl(), 'ArrowUp')
    expect(useHistoryStore.getState().selection).toEqual([])
    await key(billsEl(), ' ')
    expect(useHistoryStore.getState().selection).toEqual(['b6'])
    await key(billsEl(), 'a', { ctrlKey: true })
    expect(useHistoryStore.getState().selection).toEqual(['b6', 'b5', 'b4'])
  })

  it('Enter / Edit opens the highlighted bill for editing through the bridge', async () => {
    await toBills()
    await key(billsEl(), 'ArrowDown')
    await key(billsEl(), 'Enter')
    expect(api.getForEdit).toHaveBeenCalledWith('b5')
    expect(useBillStore.getState().billId).toBe('b5')
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.create)
  })

  it('Delete asks first (names the bill; Cancel is the safe default), Cancel deletes nothing, Delete soft-deletes and the list refreshes', async () => {
    await toBills()
    await key(billsEl(), 'ArrowDown')
    await key(billsEl(), 'Delete')
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.textContent).toMatch(/Delete bill Q3-0005 \(NEW PARTY\)\?/)
    expect(document.activeElement?.textContent).toBe('Cancel')
    await act(async () => { [...dlg.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!.click() })
    expect(api.del).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await key(billsEl(), 'Delete')
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Delete')!.click() })
    await flush()
    expect(api.del).toHaveBeenCalledWith({ ids: ['b5'] })
    expect(rows().map((r) => r.slice(0, 7))).toEqual(['Q3-0006', 'Q3-0004'])
    expect(useSaveUiStore.getState().last?.message).toMatch(/Deleted bill Q3-0005.*Recently deleted/)
  })

  it('bulk delete takes the whole selection in one call and forgets a deleted bill that is open in Create', async () => {
    await toBills()
    createSession.set('b4')
    useBillStore.setState({ billId: 'b4' })
    await key(billsEl(), 'End', { shiftKey: true })
    expect(useHistoryStore.getState().selection).toEqual(['b6', 'b5', 'b4'])
    await act(async () => { btn(/Delete/).click() })
    expect(document.querySelector('[role="dialog"]')!.textContent).toMatch(/Delete 3 bills\?/)
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Delete')!.click() })
    await flush()
    expect(api.del).toHaveBeenCalledWith({ ids: ['b6', 'b5', 'b4'] })
    expect(createSession.get()).toBeNull()
    expect(useBillStore.getState().billId).toBeNull()
  })

  it('Ctrl+P opens the print dialog for the HIGHLIGHTED history bill (not Create\'s); several selected -> a hint instead', async () => {
    await toBills()
    await key(billsEl(), 'ArrowDown')
    await key(window, 'p', { ctrlKey: true })
    expect(api.getForEdit).toHaveBeenCalledWith('b5')
    expect(usePrintUiStore.getState().open).toBe(true)
    expect(usePrintUiStore.getState().bill?.id).toBe('b5')
    expect(usePrintUiStore.getState().mode).toBe('rough')
    usePrintUiStore.setState({ open: false, bill: null })
    await key(billsEl(), 'a', { ctrlKey: true })
    await key(window, 'p', { ctrlKey: true, shiftKey: true })
    expect(usePrintUiStore.getState().open).toBe(false)
    expect(useSaveUiStore.getState().last?.message).toMatch(/3 bills selected - select one bill to print/)
  })

  it('Ctrl+O (Open PDF) asks for the Professional PDF and opens it afterwards', async () => {
    await toBills()
    await key(window, 'o', { ctrlKey: true })
    const p = usePrintUiStore.getState()
    expect(p.open).toBe(true)
    expect(p.mode).toBe('professional')
    expect(p.autoPdf).toBe(true)
    expect(p.openAfterSave).toBe(true)
    expect(p.bill?.id).toBe('b6')
  })

  it('Ctrl+Shift+T: one bill copies the whole bill; several copy the list (Bill No, Date, Party, Total)', async () => {
    await toBills()
    await key(window, 't', { ctrlKey: true, shiftKey: true })
    expect(api.writeTsv).toHaveBeenCalledTimes(1)
    expect((api.writeTsv.mock.calls[0] as unknown[][])[0]).toMatchObject({ text: expect.stringContaining('NEW PARTY') })
    await key(billsEl(), 'ArrowDown', { shiftKey: true })
    await key(window, 't', { ctrlKey: true, shiftKey: true })
    const text = ((api.writeTsv.mock.calls[1] as Array<{ text: string }>)[0]!).text
    expect(text.split('\r\n')).toEqual(['Bill No\tDate\tParty\tTotal', 'Q3-0006\t06-10-26\tMs Smart Bums\t7150', 'Q3-0005\t06-10-26\tNEW PARTY\t10025'])
    expect(useSaveUiStore.getState().last?.message).toBe('2 bills copied as a list - paste into Excel')
  })

  it('the bottom bar has Open PDF, Edit / Open, Print, Copy image, Delete, Recently deleted (Phase 43), Back; Back goes back', async () => {
    await toBills()
    expect([...host.querySelectorAll('.q3-hist__actions button')].map((b) => b.querySelector('.q3-btn__label')?.textContent)).toEqual(['Open PDF', 'Edit / Open', 'Print', 'Copy image', 'Delete', 'Revisions', 'Recently deleted', 'Back'])
    useRouter.setState({ nav: { stack: [ROUTES.dashboard, ROUTES.history] } })
    await act(async () => { btn(/Back/).click() })
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.dashboard)
  })

  it('palette-only actions exist and the new keys are registered in the history scope', async () => {
    const { allActions, matchShortcut } = await import('@shared/shortcuts')
    const ids = allActions().map((a) => a.id)
    for (const id of ['history.search', 'history.dateRange', 'history.clearFilters', 'history.open', 'history.openPdf', 'history.delete', 'history.selectAll']) expect(ids).toContain(id)
    const ev = (k: string, o: Partial<KeyboardEvent> = {}): KeyboardEvent => new KeyboardEvent('keydown', { key: k, ...o })
    expect(matchShortcut(ev('f', { ctrlKey: true }), ['history'])?.action).toBe('history.search')
    expect(matchShortcut(ev('f', { ctrlKey: true }), [])).toBeNull() // History only
    expect(matchShortcut(ev('Delete'), ['history'])?.action).toBe('history.delete')
  })
})
