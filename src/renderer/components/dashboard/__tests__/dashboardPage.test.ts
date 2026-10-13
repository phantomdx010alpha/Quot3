// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../../../pages/Dashboard'
import { useDashboardStore } from '../../../stores/dashboardStore'
import { useDraftStore } from '../../../stores/draftStore'
import { useRouter } from '../../../router/routerStore'
import { currentPath, ROUTES } from '@shared/routes'
import type { DashboardStats } from '@shared/dashboard/dashboardStats'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let stats: DashboardStats
let statsFn: ReturnType<typeof vi.fn>
let getForEdit: ReturnType<typeof vi.fn>

const day = (date: string, count: number, total: string) => ({ date, count, total })
const mkStats = (): DashboardStats => ({
  today: day('2026-10-09', 3, '1234567.50'),
  month: { month: '2026-10', count: 9, total: '9876543.21' },
  week: [day('2026-10-03', 0, '0.00'), day('2026-10-04', 1, '100.00'), day('2026-10-05', 0, '0.00'), day('2026-10-06', 2, '300.00'), day('2026-10-07', 0, '0.00'), day('2026-10-08', 1, '50.00'), day('2026-10-09', 3, '1234567.50')],
  recent: [
    { id: 'b2', poNumber: 'Q3-0002', poSeq: 2, billDate: '2026-10-09', partyName: 'Ruby Traders', grandTotal: '7150', branchId: 'l', revision: 1 },
    { id: 'b1', poNumber: 'Q3-0001', poSeq: 1, billDate: '2026-10-08', partyName: 'Zakers Clothing', grandTotal: '100', branchId: 'l', revision: 1 }
  ],
  topCustomers: [{ id: 'c1', name: 'Ruby Traders', billCount: 4, totalBilled: '1234567.50' }, { id: 'c2', name: 'Zakers Clothing', billCount: 1, totalBilled: '100.00' }],
  lastBackup: null,
  syncStatus: 'off'
})

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function mount(): Promise<void> { await act(async () => { root.render(createElement(Dashboard)) }); await flush() }
const key = async (el: Element, k: string): Promise<void> => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) }); await flush() }
const q = (sel: string): HTMLElement => host.querySelector<HTMLElement>(sel)!

beforeEach(() => {
  stats = mkStats()
  statsFn = vi.fn(async () => ({ ok: true as const, data: stats }))
  getForEdit = vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND', message: 'x' } }))
  ;(window as unknown as { quot3: unknown }).quot3 = {
    app: { getInfo: vi.fn(async () => ({ ok: true as const, data: { devMode: false } })), getDbInfo: vi.fn() },
    dashboard: { stats: statsFn }, bills: { getForEdit }, drafts: { list: vi.fn(async () => ({ ok: true as const, data: [] })) }
  }
  useDashboardStore.setState({ status: 'idle', error: '', stats: null })
  useDraftStore.setState({ drafts: [], loaded: false, message: '' })
  useRouter.setState({ nav: { stack: [ROUTES.dashboard] } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3; vi.restoreAllMocks() })

describe('Dashboard page (Phase 46)', () => {
  it('keeps the four entry cards with their shortcuts', async () => {
    await mount()
    expect([...host.querySelectorAll('.q3-dash__card')].map((c) => c.textContent)).toEqual(['CreateCtrl1', 'HistoryCtrl2', 'CustomersCtrl3', 'ItemsCtrl5', 'SettingsCtrl4'])
  })

  it('shows today / month with ₹ Indian grouping and bill counts', async () => {
    await mount()
    expect(q('[aria-label="Today"]').textContent).toBe('Today₹12,34,567.503 bills')
    expect(q('[aria-label="This month"]').textContent).toBe('This month₹98,76,543.219 bills')
  })

  it('draws a 7-point sparkline whose label lists every day', async () => {
    await mount()
    const svg = q('svg[role="img"]')
    expect(svg.querySelectorAll('circle')).toHaveLength(7)
    expect(svg.getAttribute('aria-label')).toMatch(/^Last 7 days: Sat ₹0\.00, Sun ₹100\.00/)
    expect(svg.querySelector('circle:last-of-type title')?.textContent).toBe('Fri: ₹12,34,567.50, 3 bills')
  })

  it('lists recent bills and top customers; footer shows no backup and sync off', async () => {
    await mount()
    expect([...host.querySelectorAll('[aria-label="Recent bills"][role="listbox"] [role="option"]')].map((r) => r.textContent)).toEqual(['Q3-000209-10-26Ruby Traders₹7,150.00', 'Q3-000108-10-26Zakers Clothing₹100.00'])
    expect([...host.querySelectorAll('[role="listbox"][aria-label="Top customers"] [role="option"]')].map((r) => r.textContent)).toEqual(['Ruby Traders4 bills₹12,34,567.50', 'Zakers Clothing1 bill₹100.00'])
    expect(q('.q3-stats__foot').textContent).toBe('Last backup: No backup yet·Sync: off')
  })

  it('keyboard: Down moves in Recent bills, Enter opens that bill; Enter in Top customers goes to Customers', async () => {
    await mount()
    const list = q('[role="listbox"][aria-label="Recent bills"]')
    await key(list, 'ArrowDown')
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toMatch(/^Q3-0001/)
    await key(list, 'ArrowDown') // clamped
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toMatch(/^Q3-0001/)
    await key(list, 'Enter')
    expect(getForEdit).toHaveBeenCalledWith('b1')
    await key(q('[role="listbox"][aria-label="Top customers"]'), 'Enter')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.customers)
  })

  it('refreshes when the window regains focus', async () => {
    await mount()
    expect(statsFn).toHaveBeenCalledTimes(1)
    stats = { ...mkStats(), today: day('2026-10-09', 4, '5.00') }
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(q('[aria-label="Today"]').textContent).toBe('Today₹5.004 bills')
  })

  it('empty data shows friendly empty lists; a failed refresh keeps the old numbers and shows the error', async () => {
    stats = { ...mkStats(), recent: [], topCustomers: [] }
    await mount()
    expect(host.textContent).toMatch(/No bills yet/)
    expect(host.textContent).toMatch(/No customer has a bill yet/)
    statsFn.mockResolvedValueOnce({ ok: false as const, error: { code: 'DB_ERROR', message: 'boom' } })
    await act(async () => { await useDashboardStore.getState().load() })
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('boom')
    expect(q('[aria-label="Today"]')).not.toBeNull()
  })
})
