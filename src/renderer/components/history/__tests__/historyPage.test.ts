// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from '../../../pages/History'
import { useHistoryStore } from '../../../stores/historyStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import { decodeCursor, encodeCursor, type BillListItem, type HistoryBranch } from '@shared/history/historyList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let bills: BillListItem[]
let calls: { dates: number; bills: Array<Record<string, unknown>> }
let getForEdit: ReturnType<typeof vi.fn>
const branches: HistoryBranch[] = [{ id: 'local', name: 'Main', isLocal: true }]

const mkBill = (n: number, date: string, party: string, total: string): BillListItem => ({
  id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: date, partyName: party, grandTotal: total, branchId: 'local', revision: 1
})

/** An in-memory stand-in for the real `history:*` channels (same contract; bills are already newest first). */
function installBridge(): void {
  calls = { dates: 0, bills: [] }
  const history = {
    listDates: vi.fn(async () => {
      calls.dates++
      const m = new Map<string, number>()
      for (const b of bills) m.set(b.billDate, (m.get(b.billDate) ?? 0) + 1)
      return { ok: true as const, data: [...m].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? 1 : -1)) }
    }),
    listBills: vi.fn(async (input: { date?: string; cursor?: string; limit?: number } = {}) => {
      calls.bills.push(input)
      const all = bills.filter((b) => input.date === undefined || b.billDate === input.date)
      const start = input.cursor ? Number(decodeCursor(input.cursor)?.id ?? 0) : 0
      const size = input.limit ?? 200
      const items = all.slice(start, start + size)
      const more = start + size < all.length
      return { ok: true as const, data: { items, ...(more ? { next: encodeCursor({ date: input.date ?? '2026-01-01', createdAt: 'x', id: String(start + size) }) } : {}) } }
    }),
    branches: vi.fn(async () => ({ ok: true as const, data: branches }))
  }
  getForEdit = vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND', message: 'Bill not found' } }))
  ;(window as unknown as { quot3: unknown }).quot3 = { history, bills: { getForEdit } }
}

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys(['history'], actions)
  return createElement(History)
}

async function mount(): Promise<void> {
  await act(async () => { root.render(createElement(Shell)) })
  await act(async () => { await Promise.resolve() })
}
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const key = async (el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
  await flush()
}
const datesEl = (): HTMLElement => host.querySelector<HTMLElement>('[aria-label="Bill dates, newest first"]')!
const billsEl = (): HTMLElement => host.querySelector<HTMLElement>('.q3-hist__billlist')!
const dateRows = (): string[] => [...host.querySelectorAll('.q3-hist__daterow')].map((r) => r.textContent ?? '')
const billRows = (): string[] => [...host.querySelectorAll('.q3-hist__billrow')].map((r) => r.textContent ?? '')
const selectedBill = (): string | null => useHistoryStore.getState().billId

beforeEach(() => {
  // jsdom has no layout: give every element a size so the virtualiser renders rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  useHistoryStore.setState({ status: 'idle', error: '', dates: [], date: null, bills: [], next: null, loadingMore: false, billId: null, branches: [], focusDates: null, focusBills: null, focusSearch: null, focusDateRange: null, query: '', from: '', to: '', truncated: false, selection: [], anchor: null, confirmDelete: null })
  useRouter.setState({ nav: initialNav(ROUTES.history) })
  bills = [
    mkBill(6, '2026-10-06', 'Ms Smart Bums', '7150'),
    mkBill(5, '2026-10-06', 'NEW PARTY', '10025'),
    mkBill(4, '2026-10-06', 'Brothers Thread House- THALASSERY', '1234567.5'),
    mkBill(3, '2026-10-05', 'Zakers Clothing', '9350'),
    mkBill(2, '2026-10-05', 'LAKSHMI CLOTH CENTER', '6350'),
    mkBill(1, '2026-10-04', 'Old Party', '100')
  ]
  installBridge()
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

describe('History page layout (Phase 41)', () => {
  it('shows Dates (DD-MM-YY + count, newest first) and the newest date\'s bills with ₹ Indian totals', async () => {
    await mount()
    expect(dateRows()).toEqual(['06-10-263', '05-10-262', '04-10-261'])
    expect(host.querySelector('.q3-hist__daterow[aria-selected="true"]')?.textContent).toBe('06-10-263')
    expect(billRows()).toEqual([
      'Q3-000606-10-26Ms Smart Bums₹7,150.00',
      'Q3-000506-10-26NEW PARTY₹10,025.00',
      'Q3-000406-10-26Brothers Thread House- THALASSERY₹12,34,567.50'
    ])
    expect(host.querySelector('.q3-hist__title')?.textContent).toBe('All Bills')
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('6 bills')
    expect(selectedBill()).toBe('b6')
  })

  it('has the four legacy columns and a branch filter that is disabled and shows the local branch', async () => {
    await mount()
    expect([...host.querySelectorAll('.q3-hist__bills .q3-hist__thead span')].map((s) => s.textContent)).toEqual(['Bill No', 'Date', 'Party', 'Total'])
    const sel = host.querySelector<HTMLSelectElement>('.q3-hist__branch select')!
    expect(sel.disabled).toBe(true)
    expect(sel.options[sel.selectedIndex]?.text).toBe('Main')
  })

  it('focus starts on the Dates panel', async () => {
    await mount()
    expect(document.activeElement).toBe(datesEl())
  })

  it('Down / Up in Dates change the date and load that day\'s bills; clamped at both ends', async () => {
    await mount()
    await key(datesEl(), 'ArrowDown')
    expect(useHistoryStore.getState().date).toBe('2026-10-05')
    expect(billRows().map((r) => r.slice(0, 7))).toEqual(['Q3-0003', 'Q3-0002'])
    await key(datesEl(), 'ArrowDown')
    await key(datesEl(), 'ArrowDown')
    expect(useHistoryStore.getState().date).toBe('2026-10-04')
    await key(datesEl(), 'Home')
    expect(useHistoryStore.getState().date).toBe('2026-10-06')
    await key(datesEl(), 'ArrowUp')
    expect(useHistoryStore.getState().date).toBe('2026-10-06')
    await key(datesEl(), 'End')
    expect(useHistoryStore.getState().date).toBe('2026-10-04')
  })

  it('Enter / Right in Dates moves focus to the bill list; Left comes back; Down moves the bill highlight', async () => {
    await mount()
    await key(datesEl(), 'Enter')
    expect(document.activeElement).toBe(billsEl())
    await key(billsEl(), 'ArrowDown')
    expect(selectedBill()).toBe('b5')
    await key(billsEl(), 'End')
    expect(selectedBill()).toBe('b4')
    await key(billsEl(), 'ArrowUp')
    expect(selectedBill()).toBe('b5')
    await key(billsEl(), 'ArrowLeft')
    expect(document.activeElement).toBe(datesEl())
    await key(datesEl(), 'ArrowRight')
    expect(document.activeElement).toBe(billsEl())
  })

  it('both panels are in the Tab order (tabIndex 0) so Tab / Shift+Tab move between them', async () => {
    await mount()
    expect(datesEl().tabIndex).toBe(0)
    expect(billsEl().tabIndex).toBe(0)
    const order = [...host.querySelectorAll<HTMLElement>('[tabindex="0"]')]
    expect(order.indexOf(datesEl())).toBeLessThan(order.indexOf(billsEl()))
  })

  it('arrow keys are consumed by the panels; Enter on a bill asks the app to open it (Phase 42) and a failure leaves History as it was', async () => {
    await mount()
    await key(datesEl(), 'Enter')
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    await act(async () => { billsEl().dispatchEvent(down) })
    expect(down.defaultPrevented).toBe(true)
    await key(billsEl(), 'Enter')
    expect(getForEdit).toHaveBeenCalledWith('b5')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.history)
  })

  it('clicking a date or a bill selects it and keeps focus in that panel', async () => {
    await mount()
    const second = host.querySelectorAll<HTMLElement>('.q3-hist__daterow')[1]!
    await act(async () => { second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
    await flush()
    expect(useHistoryStore.getState().date).toBe('2026-10-05')
    expect(document.activeElement).toBe(datesEl())
    const row = host.querySelectorAll<HTMLElement>('.q3-hist__billrow')[1]!
    await act(async () => { row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
    expect(selectedBill()).toBe('b2')
    expect(document.activeElement).toBe(billsEl())
  })

  it('a long day is virtualised: only a window of rows is in the DOM, and the next page loads when scrolled near the end', async () => {
    bills = Array.from({ length: 450 }, (_, i) => mkBill(450 - i, '2026-10-06', `Party ${450 - i}`, '1'))
    await mount()
    expect(useHistoryStore.getState().bills).toHaveLength(200)
    expect(billRows().length).toBeGreaterThan(5)
    expect(billRows().length).toBeLessThan(60)
    await key(datesEl(), 'Enter')
    await key(billsEl(), 'End')
    await flush()
    await flush()
    expect(useHistoryStore.getState().bills.length).toBeGreaterThan(200)
    expect(calls.bills.some((c) => c.cursor !== undefined)).toBe(true)
    const ids = useHistoryStore.getState().bills.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a slow answer for a date that is no longer selected never overwrites the list', async () => {
    await mount()
    const real = (window as unknown as { quot3: { history: { listBills: (i: { date?: string }) => Promise<unknown> } } }).quot3.history
    const orig = real.listBills
    let release: (() => void) | undefined
    real.listBills = (i) => i.date === '2026-10-05' ? new Promise((res) => { release = () => res(orig(i)) }) : orig(i)
    await key(datesEl(), 'ArrowDown') // asks for 05-10, held back
    await key(datesEl(), 'ArrowDown') // asks for 04-10, answers at once
    expect(useHistoryStore.getState().date).toBe('2026-10-04')
    release?.()
    await flush()
    expect(billRows().map((r) => r.slice(0, 7))).toEqual(['Q3-0001'])
  })

  it('empty database: friendly empty state, no panels', async () => {
    bills = []
    await mount()
    expect(host.textContent).toContain('No saved bills yet')
    expect(host.querySelector('.q3-hist__body')).toBeNull()
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('0 bills')
  })

  it('a failing bridge shows an alert instead of crashing; Refresh recovers', async () => {
    const h = (window as unknown as { quot3: { history: { listDates: ReturnType<typeof vi.fn> } } }).quot3.history
    h.listDates.mockResolvedValueOnce({ ok: false, error: { code: 'DB_ERROR', message: 'disk on fire' } })
    await mount()
    expect(host.querySelector('[role=alert]')?.textContent).toBe('disk on fire')
    await act(async () => { host.querySelector<HTMLButtonElement>('.q3-hist__refresh')!.click() })
    await flush()
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(dateRows()).toHaveLength(3)
  })

  it('no bridge at all: message, no crash', async () => {
    delete (window as unknown as { quot3?: unknown }).quot3
    await mount()
    expect(host.querySelector('[role=alert]')?.textContent).toMatch(/not available/)
  })

  it('Refresh keeps the selected date and bill when they still exist and picks up new bills', async () => {
    await mount()
    await key(datesEl(), 'ArrowDown')
    await key(datesEl(), 'Enter')
    await key(billsEl(), 'ArrowDown')
    expect(selectedBill()).toBe('b2')
    bills = [mkBill(7, '2026-10-05', 'Fresh Party', '5'), ...bills]
    await act(async () => { host.querySelector<HTMLButtonElement>('.q3-hist__refresh')!.click() })
    await flush()
    expect(useHistoryStore.getState().date).toBe('2026-10-05')
    expect(selectedBill()).toBe('b2')
    expect(billRows()[0]).toContain('Fresh Party')
  })

  it('palette actions focus Dates / Bills and refresh (they are registered, key-less)', async () => {
    await mount()
    await key(datesEl(), 'Enter')
    expect(document.activeElement).toBe(billsEl())
    const { ACTIONS, SHORTCUTS } = await import('@shared/shortcuts')
    for (const id of ['history.focusDates', 'history.focusBills', 'history.refresh']) {
      expect(ACTIONS.some((a) => a.id === id)).toBe(true)
      expect(SHORTCUTS.some((s) => s.action === id)).toBe(false)
    }
    await act(async () => { useHistoryStore.getState().focusDates?.() })
    expect(document.activeElement).toBe(datesEl())
    await act(async () => { useHistoryStore.getState().focusBills?.() })
    expect(document.activeElement).toBe(billsEl())
    const before = calls.dates
    await act(async () => { await useHistoryStore.getState().refresh() })
    expect(calls.dates).toBe(before + 1)
  })

  it('unmounting releases the focus ports', async () => {
    await mount()
    expect(useHistoryStore.getState().focusDates).not.toBeNull()
    act(() => root.render(createElement('div')))
    expect(useHistoryStore.getState().focusDates).toBeNull()
    expect(useHistoryStore.getState().focusBills).toBeNull()
  })
})

describe('History order (Phase 146)', () => {
  it('the bills of a date are listed by invoice number, highest first, whatever order the data layer returned', async () => {
    const mk = (n: number, po: string) => ({ ...mkBill(n, '2026-10-06', `Party ${n}`, '1'), poNumber: po })
    bills = [mk(1, 'AV-0748'), mk(2, 'BR-0100'), mk(3, 'AV-0749'), mk(4, 'AV-0009'), mk(5, 'AV-0010')]
    await mount()
    expect(useHistoryStore.getState().bills.map((b) => b.poNumber)).toEqual(['BR-0100', 'AV-0749', 'AV-0748', 'AV-0010', 'AV-0009'])
    expect(billRows().map((r) => r.slice(0, 7))).toEqual(['BR-0100', 'AV-0749', 'AV-0748', 'AV-0010', 'AV-0009'])
  })
})
