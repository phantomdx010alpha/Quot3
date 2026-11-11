// @vitest-environment jsdom
// Phase 219 (M21): page memory wired in. Synthetic fixtures only.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from '../../../pages/History'
import { useHistoryStore } from '../../../stores/historyStore'
import { useCustomersStore } from '../../../stores/customersStore'
import { useItemsStore } from '../../../stores/itemsStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useRouter } from '../../../router/routerStore'
import { openSelectedBill } from '../../../stores/historyActions'
import { customersAdapter, historyAdapter, itemsAdapter, settingsAdapter } from '../../../pageMemory/adapters'
import { recallPage, resetPageMemoryForTests, savePageNow, usePageMemoryStore } from '../../../stores/pageMemoryStore'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import { decodeCursor, encodeCursor, type BillListItem } from '@shared/history/historyList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let bills: BillListItem[]
const mk = (n: number, date: string): BillListItem => ({ id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: date, partyName: `Party ${n}`, grandTotal: '100', branchId: 'local', revision: 1 })

function installBridge(): void {
  const history = {
    listDates: vi.fn(async () => {
      const m = new Map<string, number>()
      for (const b of bills) m.set(b.billDate, (m.get(b.billDate) ?? 0) + 1)
      return { ok: true as const, data: [...m].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : -1)) }
    }),
    listBills: vi.fn(async (input: { date?: string; cursor?: string } = {}) => {
      const all = bills.filter((b) => input.date === undefined || b.billDate === input.date)
      const start = input.cursor ? Number(decodeCursor(input.cursor)?.id ?? 0) : 0
      const items = all.slice(start, start + 200)
      return { ok: true as const, data: { items, ...(start + 200 < all.length ? { next: encodeCursor({ date: input.date ?? 'x', createdAt: 'x', id: String(start + 200) }) } : {}) } }
    }),
    branches: vi.fn(async () => ({ ok: true as const, data: [{ id: 'local', name: 'Main', isLocal: true }] }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { history, bills: { getForEdit: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND', message: 'x' } })) } }
}
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 10)) }) }
async function mount(): Promise<void> { await act(async () => { root.render(createElement(History)) }); await flush(); await flush() }
async function remount(): Promise<void> { act(() => root.unmount()); root = createRoot(host); await mount() }
const billsEl = (): HTMLElement => host.querySelector<HTMLElement>('.q3-hist__billlist')!

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  resetPageMemoryForTests()
  useHistoryStore.setState({ status: 'idle', error: '', dates: [], date: null, bills: [], next: null, billId: null, query: '', from: '', to: '', selection: [], anchor: null })
  useRouter.setState({ nav: initialNav(ROUTES.history) })
  bills = [mk(6, '2026-10-06'), mk(5, '2026-10-06'), mk(4, '2026-10-06'), mk(3, '2026-10-05'), mk(2, '2026-10-05'), mk(1, '2026-10-04')]
  installBridge()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { quot3?: unknown }).quot3
  resetPageMemoryForTests()
  vi.restoreAllMocks()
})

describe('previous-page rule in the app router (M21-2)', () => {
  it('History -> Customers -> Esc returns to History, Esc again to the Dashboard, then nothing', () => {
    const r = useRouter.getState()
    r.navigate(ROUTES.customers)
    expect(useRouter.getState().nav.stack).toEqual(['/', '/history', '/customers'])
    useRouter.getState().back()
    expect(currentPath(useRouter.getState().nav)).toBe('/history')
    useRouter.getState().back()
    expect(currentPath(useRouter.getState().nav)).toBe('/')
    useRouter.getState().back()
    expect(useRouter.getState().nav.stack).toEqual(['/'])
  })
  it('the Dashboard resets the stack; Create stores nothing', () => {
    useRouter.getState().navigate(ROUTES.customers)
    useRouter.getState().navigate(ROUTES.dashboard)
    expect(useRouter.getState().nav.stack).toEqual(['/'])
    useRouter.getState().navigate(ROUTES.create)
    savePageNow(ROUTES.create)
    expect(recallPage(ROUTES.create)).toBeUndefined()
    expect(Object.keys(usePageMemoryStore.getState().map.records)).toEqual([])
  })
  it('a drill-down bill keeps its BillContext; any other navigation ends it; Esc selects the bill being viewed', () => {
    const ctx = { sourcePath: ROUTES.history, orderedBillIds: ['b6', 'b5', 'b4'], currentId: 'b4' }
    usePageMemoryStore.getState().save(ROUTES.history, { scroll: {}, filters: {}, panels: {}, selection: { kind: 'bill', id: 'b6', orderHint: 0 } })
    usePageMemoryStore.getState().setBillContext(ctx)
    useRouter.getState().navigate(ROUTES.create, { returnToCurrent: true })
    expect(usePageMemoryStore.getState().billContext).toBe(ctx)
    useRouter.getState().back()
    expect(currentPath(useRouter.getState().nav)).toBe('/history')
    expect(recallPage(ROUTES.history)?.selection).toEqual({ kind: 'bill', id: 'b4', orderHint: 2 })
    expect(usePageMemoryStore.getState().billContext).toBeNull()
    usePageMemoryStore.getState().setBillContext(ctx)
    useRouter.getState().navigate(ROUTES.customers)
    expect(usePageMemoryStore.getState().billContext).toBeNull()
  })
})

describe('History adapter (M21-3)', () => {
  it('leave and return: the selected bill and the bills scroll come back', async () => {
    await mount()
    useHistoryStore.getState().selectBill('b5')
    billsEl().scrollTop = 80
    useRouter.getState().navigate(ROUTES.customers) // save on leave
    expect(recallPage(ROUTES.history)?.selection?.id).toBe('b5')
    expect(recallPage(ROUTES.history)?.scroll.bills).toBe(80)
    useHistoryStore.getState().selectBill('b6')
    billsEl().scrollTop = 0
    await remount()
    expect(useHistoryStore.getState().billId).toBe('b5')
    expect(billsEl().scrollTop).toBe(80)
  })
  it('a remembered bill that is gone lands on the nearest neighbour by its saved position', async () => {
    await mount()
    useHistoryStore.getState().selectBill('b5')
    useRouter.getState().navigate(ROUTES.customers)
    bills = bills.filter((b) => b.id !== 'b5')
    await remount()
    expect(useHistoryStore.getState().billId).toBe('b4')
  })
  it('the From date filter is restored', async () => {
    await mount()
    await useHistoryStore.getState().setRange('2026-10-05', '')
    useRouter.getState().navigate(ROUTES.customers)
    useHistoryStore.setState({ from: '' })
    await remount()
    expect(useHistoryStore.getState().from).toBe('2026-10-05')
  })
})

describe('BillContext capture (M21-4b)', () => {
  it('opening a bill from History captures the FULL list across dates, newest date first, IDs only', async () => {
    await mount()
    useHistoryStore.getState().selectBill('b5')
    const firstDay = useHistoryStore.getState().bills.map((b) => b.id)
    expect(openSelectedBill()).toBe(true)
    await flush(); await flush()
    const ctx = usePageMemoryStore.getState().billContext!
    expect(ctx.sourcePath).toBe(ROUTES.history)
    expect(ctx.currentId).toBe('b5')
    expect(ctx.orderedBillIds.slice(0, 3)).toEqual(firstDay)
    expect([...ctx.orderedBillIds].sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])
  })
})

describe('other adapters (direct)', () => {
  it('Customers: query and selection come back; a deleted customer lands on the nearest row', async () => {
    const row = (id: string) => ({ id, name: id, phone: '', address: '', transport: '', billCount: 0, lastBill: '', totalBilled: '0' }) as never
    useCustomersStore.setState({ status: 'ready', all: [row('c1'), row('c2'), row('c3')], rows: [row('c1'), row('c2'), row('c3')], query: '', selectedId: 'c3', view: 'list' })
    const a = customersAdapter(() => null)
    const snap = a.capture()
    expect(snap.selection).toEqual({ kind: 'party', id: 'c3', orderHint: 2 })
    useCustomersStore.setState({ rows: [row('c1'), row('c2')], selectedId: 'c1' })
    await a.apply({ path: ROUTES.customers, savedAt: 1, scroll: {}, filters: { query: '' }, panels: {}, selection: snap.selection! })
    expect(useCustomersStore.getState().selectedId).toBe('c2')
  })
  it("Customers: Esc from a bill opened on a customer's bills page returns to THAT bills page with the bill selected", async () => {
    const row = (id: string) => ({ id, name: id, phone: '', address: '', transport: '', billCount: 0, lastBill: '', totalBilled: '0' }) as never
    const b = (n: number) => ({ id: `b${n}`, poNumber: `Q3-${n}`, poSeq: n, billDate: '2026-10-06', partyName: 'c2', grandTotal: '1', branchId: 'local', revision: 1 })
    ;(window as unknown as { quot3: unknown }).quot3 = { customers: { bills: vi.fn(async () => ({ ok: true as const, data: { items: [b(1), b(2), b(3)] } })) } }
    const rows = [row('c1'), row('c2')]
    useCustomersStore.setState({ status: 'ready', all: rows, rows, query: '', selectedId: 'c2', view: 'bills', billsOf: rows[1], bills: [b(1), b(2), b(3)] as never, billsStatus: 'ready', billId: 'b3' })
    const a = customersAdapter(() => null)
    const snap = a.capture()
    expect(snap.panels.view).toBe('bills')
    expect(snap.selection).toEqual({ kind: 'party', id: 'c2', orderHint: 1 })
    useCustomersStore.setState({ view: 'list', billsOf: null, bills: [], billId: null, selectedId: 'c1' }) // the page closed it on leave
    await a.apply({ path: ROUTES.customers, savedAt: 1, scroll: {}, filters: snap.filters, panels: snap.panels, selection: snap.selection! })
    const c = useCustomersStore.getState()
    expect(c.view).toBe('bills')
    expect(c.billsOf?.id).toBe('c2')
    expect(c.billId).toBe('b3')
  })
  it('Settings: the open section is remembered', () => {
    useSettingsStore.getState().setSection('print')
    const a = settingsAdapter()
    const snap = a.capture()
    useSettingsStore.getState().setSection('company')
    a.apply({ path: ROUTES.settings, savedAt: 1, scroll: {}, filters: {}, panels: snap.panels })
    expect(useSettingsStore.getState().section).toBe('print')
  })
  it('Items: query, window and the selected group are captured by ID', () => {
    useItemsStore.setState({ query: 'cotton', window: 'sales', selectedGroupId: 'g9', sales: null })
    const snap = itemsAdapter(() => null).capture()
    expect(snap.filters.query).toBe('cotton')
    expect(snap.panels.window).toBe('sales')
    expect(snap.selection).toEqual({ kind: 'itemGroup', id: 'g9' })
  })
  it('History adapter capture holds IDs and the owner\'s own filter text only (no bill content)', () => {
    useHistoryStore.setState({ bills: [mk(1, '2026-10-04')], billId: 'b1', query: 'abc' })
    const snap = historyAdapter(() => null).capture()
    expect(JSON.stringify(snap)).not.toContain('Party 1')
    expect(snap.filters.query).toBe('abc')
  })
})
