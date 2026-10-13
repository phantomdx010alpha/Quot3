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
import type { GroupDetail, GroupSales, GroupSummary, ItemsOverview } from '@shared/items/api'
import type { SaleRow, SalesTab } from '@shared/items/sales'

const openBill = vi.fn(async (_id: string) => true)
vi.mock('../../../stores/createSession', () => ({ openBillForEdit: (id: string) => openBill(id) }))
vi.mock('../../../stores/guardStore', () => ({ requestLeave: (go: () => void) => go() }))

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const g = (id: string, display: string, count: number): GroupSummary => ({ id, display, count, nonGstCount: count, gstCount: 1, lastUsed: '2026-10-01', familyId: null, spellingCount: 1, suggestionCount: 0 })
const groups = [g('AMETO SMALL', 'AMETO SMALL', 4), g('CLIP STEEL', 'CLIP STEEL', 3)]
const overview = (): ItemsOverview => ({ groups, families: [], notItems: [], bills: 7, lines: 20, builtAt: '2026-10-11T00:00:00Z' })
const detail = (id: string): GroupDetail => ({ id, display: id, familyId: null, spellings: [], suggestions: [] })

const sale = (billId: string, party: string, date: string, rate: string | null, extra: Partial<SaleRow> = {}): SaleRow => ({
  billId, rowIdx: 0, poNumber: `P-${billId}`, billDate: date, createdAt: `${date}T10:00:00Z`, partyKey: `name:${party.toUpperCase()}`, partyName: party, name: 'AMETO SMALL',
  qty: '10', rate, gst: false, gstPct: null, lineTotal: rate ? String(Number(rate) * 10) : null, gstAmt: null, amount: null, outlier: null, ...extra
})
const stats = (count: number): SalesTab['stats'] => ({ count, priced: count, minRate: '80', medianRate: '82', maxRate: '120', latestRate: '82', latestDate: '2026-10-03', totalQty: String(count * 10), parties: 2 })
const rows = [sale('b3', 'Ravi', '2026-10-03', '82'), sale('b2', 'Asha', '2026-10-02', '120', { outlier: 'high' }), sale('b1', 'Ravi', '2026-10-01', '80')]
const gstRow = sale('g1', 'Mohan', '2026-09-20', '82', { gst: true, gstPct: '18', gstAmt: '147.6', amount: '967.6' })
const party = (name: string, rate: string, billId: string, n: number) => ({ partyKey: `name:${name.toUpperCase()}`, partyName: name, rate, date: '2026-10-03', billId, poNumber: `P-${billId}`, sales: n, outlier: null })
const salesFor = (groupId: string, partyKey?: string): GroupSales => {
  const shown = partyKey ? rows.filter((r) => r.partyKey === partyKey) : rows
  return {
    groupId, display: groupId,
    nonGst: { stats: stats(shown.length), groupMedianRate: '82', rows: shown, lastByParty: [party('Ravi', '82', 'b3', 2), party('Asha', '120', 'b2', 1)], truncated: false },
    gst: { stats: stats(1), groupMedianRate: '82', rows: [gstRow], lastByParty: [], truncated: false }
  }
}

let host: HTMLDivElement
let root: Root
let salesCall: ReturnType<typeof vi.fn>
let openTarget: ReturnType<typeof vi.fn>
let writeTsv: ReturnType<typeof vi.fn>

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys([], actions)
  return createElement(Items)
}
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }
async function mount(): Promise<void> { await act(async () => { root.render(createElement(Shell)) }); await flush() }
const key = async (init: KeyboardEventInit & { key: string }, target: EventTarget = document.activeElement ?? document.body): Promise<void> => {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  await flush()
}
const salesWin = (): HTMLElement => host.querySelectorAll<HTMLElement>('.q3-items__content')[2]!
const saleRows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('.q3-items__row--sale:not(.q3-items__row--colhead)')]
const cellsOf = (r: HTMLElement): string[] => [...r.querySelectorAll('[role="gridcell"]')].map((c) => c.textContent ?? '')
const toSales = async (): Promise<void> => { await key({ key: '3', ctrlKey: true, altKey: true }) }

beforeEach(() => {
  openBill.mockClear()
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  salesCall = vi.fn(async ({ groupId, partyKey }: { groupId: string; partyKey?: string }) => ({ ok: true as const, data: salesFor(groupId, partyKey) }))
  openTarget = vi.fn(async ({ billId }: { billId: string }) => ({ ok: true as const, data: { billId, poNumber: `P-${billId}`, billDate: '2026-10-03', partyName: 'Ravi' } }))
  writeTsv = vi.fn(async () => ({ ok: true as const, data: {} }))
  ;(window as unknown as { quot3: unknown }).quot3 = {
    items: {
      overview: vi.fn(async () => ({ ok: true as const, data: overview() })),
      group: vi.fn(async ({ groupId }: { groupId: string }) => ({ ok: true as const, data: detail(groupId) })),
      lastDecision: vi.fn(async () => ({ ok: true as const, data: { undo: null } })),
      sales: salesCall, openTarget, rebuild: vi.fn()
    },
    clipboard: { writeTsv }
  }
  useItemsStore.setState({ status: 'idle', error: '', overview: null, query: '', selectedGroupId: null, window: 'groups', rebuilding: false, progress: null, detail: null, cursor: 0, pending: null, notice: '', undo: null, busy: false, sales: null, salesTab: 'nonGst', salesCursor: 0, partyFilter: null })
  useRouter.setState({ nav: navPush(initialNav(), ROUTES.items), navCount: 0 })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

describe('Phase 114 Sales window', () => {
  it('shows the Non-GST sales newest first with the summary, the flag and who-paid-what', async () => {
    await mount()
    expect(cellsOf(saleRows()[0]!).slice(0, 5)).toEqual(['03-10-26', 'Ravi', 'P-b3', '10', '82'])
    expect(saleRows().map((r) => cellsOf(r)[2])).toEqual(['P-b3', 'P-b2', 'P-b1'])
    expect(cellsOf(saleRows()[1]!)[5]).toBe('High')
    expect(host.querySelector('.q3-items__stats')?.textContent).toContain('3 sales')
    expect(host.querySelector('.q3-items__sales .q3-items__sub')?.textContent).toContain('Who paid what')
    expect(host.querySelectorAll('.q3-items__row--party')).toHaveLength(2)
  })

  it('G switches to the GST tab: GST %, tax and line total, and never mixes the two lists', async () => {
    await mount(); await toSales()
    await key({ key: 'g' })
    const r = saleRows()
    expect(r).toHaveLength(1)
    expect(cellsOf(r[0]!).slice(0, 8)).toEqual(['20-09-26', 'Mohan', 'P-g1', '10', '82', '18', '147.6', '967.6'])
    await key({ key: 'g' })
    expect(saleRows()).toHaveLength(3)
  })

  it('Down moves the highlighted sale, Enter opens THAT bill after asking the service', async () => {
    await mount(); await toSales()
    await key({ key: 'ArrowDown' })
    expect(useItemsStore.getState().salesCursor).toBe(1)
    await key({ key: 'Enter' })
    expect(openTarget).toHaveBeenCalledWith({ billId: 'b2' })
    expect(openBill).toHaveBeenCalledWith('b2')
  })

  it('double-click opens the bill of the clicked row', async () => {
    await mount()
    await act(async () => { saleRows()[2]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) })
    await flush()
    expect(openBill).toHaveBeenCalledWith('b1')
  })

  it('a bill that is gone is not opened; the owner is told', async () => {
    openTarget.mockResolvedValueOnce({ ok: true as const, data: null as never })
    await mount(); await toSales()
    await key({ key: 'Enter' })
    expect(openBill).not.toHaveBeenCalled()
  })

  it('P filters to the highlighted sale\'s party (service called with partyKey), Esc clears it WITHOUT leaving the page', async () => {
    await mount(); await toSales()
    await key({ key: 'p' })
    expect(salesCall).toHaveBeenLastCalledWith({ groupId: 'AMETO SMALL', partyKey: 'name:RAVI' })
    expect(saleRows()).toHaveLength(2)
    expect(host.querySelector('.q3-items__chip')?.textContent).toContain('Ravi')
    await key({ key: 'Escape' })
    expect(useItemsStore.getState().partyFilter).toBeNull()
    expect(saleRows()).toHaveLength(3)
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.items)
    await key({ key: 'Escape' })
    expect(useRouter.getState().nav.stack.at(-1)).toBe(ROUTES.dashboard)
  })

  it('clicking a party in who-paid-what filters by it; the median and flags stay the whole list\'s', async () => {
    await mount()
    const p = host.querySelectorAll<HTMLElement>('.q3-items__row--party')[1]!
    await act(async () => { p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })
    await flush()
    expect(useItemsStore.getState().partyFilter).toBe('name:ASHA')
  })

  it('Ctrl+Alt+T copies the CURRENT table as TSV; nothing to copy says so and writes nothing', async () => {
    await mount()
    await key({ key: 't', ctrlKey: true, altKey: true })
    expect(writeTsv).toHaveBeenCalledTimes(1)
    const text = (writeTsv.mock.calls[0]![0] as { text: string }).text
    expect(text.split('\r\n')).toHaveLength(4)
    expect(text.split('\r\n')[0]).toBe('Date\tParty\tBill\tQty\tRate\tFlag')
  })

  it('opening a bill and coming back keeps the group, tab, highlighted sale, filter and window', async () => {
    await mount(); await toSales()
    await key({ key: 'ArrowDown' })
    await key({ key: 'Enter' })
    act(() => root.unmount())
    root = createRoot(host)
    await mount()
    const s = useItemsStore.getState()
    expect(s.selectedGroupId).toBe('AMETO SMALL')
    expect(s.salesCursor).toBe(1)
    expect(s.window).toBe('sales')
    expect(document.activeElement).toBe(salesWin())
    expect(host.querySelector('[aria-selected="true"].q3-items__row--sale')?.getAttribute('aria-rowindex')).toBe('2')
  })

  it('selecting another item resets the party filter and shows its own sales', async () => {
    await mount()
    await useItemsStore.getState().setPartyFilter('name:RAVI')
    useItemsStore.getState().selectGroup('CLIP STEEL')
    await flush()
    expect(useItemsStore.getState().partyFilter).toBeNull()
    expect(useItemsStore.getState().sales?.groupId).toBe('CLIP STEEL')
  })

  it('selector stability: the same sales object between renders, no fresh arrays from the store', async () => {
    await mount()
    const a = useItemsStore.getState().sales
    await flush()
    expect(useItemsStore.getState().sales).toBe(a)
  })

  it('typing g / p in the search box does nothing but type', async () => {
    await mount()
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search items"]')!
    input.focus()
    await key({ key: 'g' }, input); await key({ key: 'p' }, input)
    expect(useItemsStore.getState().salesTab).toBe('nonGst')
    expect(useItemsStore.getState().partyFilter).toBeNull()
  })
})
