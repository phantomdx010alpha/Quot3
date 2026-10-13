// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Customers from '../../../pages/Customers'
import { useCustomersStore } from '../../../stores/customersStore'
import { usePartyIndexStore } from '../../../stores/partyIndexStore'
import { useHotkeys } from '../../../hooks/useHotkeys'
import { useAppActions } from '../../../hooks/useAppActions'
import { useRouter } from '../../../router/routerStore'
import { currentPath, initialNav, ROUTES } from '@shared/routes'
import type { CustomerInput, CustomerRow } from '@shared/customers/customerList'
import type { BillListItem } from '@shared/history/historyList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let customers: CustomerRow[]
let custBills: Record<string, BillListItem[]>
let api: { list: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; bills: ReturnType<typeof vi.fn> }
let getForEdit: ReturnType<typeof vi.fn>

const mk = (id: string, name: string, over: Partial<CustomerRow> = {}): CustomerRow => ({ id, name, phone: '', address: '', transport: '', billCount: 0, lastBillDate: '', totalBilled: '0.00', ...over })
const mkBill = (n: number, party: string): BillListItem => ({ id: `b${n}`, poNumber: `Q3-${String(n).padStart(4, '0')}`, poSeq: n, billDate: '2026-10-0' + n, partyName: party, grandTotal: String(n * 100), branchId: 'local', revision: 1 })

function installBridge(): void {
  api = {
    list: vi.fn(async () => ({ ok: true as const, data: [...customers].sort((a, b) => a.name.localeCompare(b.name)) })),
    create: vi.fn(async (c: CustomerInput) => {
      if (customers.some((x) => x.name.toLowerCase() === c.name.trim().toLowerCase())) return { ok: false as const, error: { code: 'VALIDATION', message: `A customer named "${c.name}" already exists` } }
      const id = `n${customers.length + 1}`
      customers.push(mk(id, c.name.trim(), { phone: c.phone ?? '', address: c.address ?? '', transport: c.transport ?? '' }))
      return { ok: true as const, data: { id } }
    }),
    update: vi.fn(async (id: string, c: CustomerInput) => {
      const r = customers.find((x) => x.id === id)!
      Object.assign(r, { name: c.name.trim(), phone: c.phone ?? '', address: c.address ?? '', transport: c.transport ?? '' })
      return { ok: true as const, data: { id } }
    }),
    delete: vi.fn(async (id: string) => { customers = customers.filter((x) => x.id !== id); return { ok: true as const, data: { id } } }),
    bills: vi.fn(async (i: { partyId: string }) => ({ ok: true as const, data: { items: custBills[i.partyId] ?? [] } }))
  }
  getForEdit = vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND', message: 'Bill not found' } }))
  ;(window as unknown as { quot3: unknown }).quot3 = { customers: api, bills: { getForEdit }, parties: { list: vi.fn(async () => ({ ok: true as const, data: [] })) } }
}

function Shell(): React.JSX.Element {
  const actions = useAppActions()
  useHotkeys(['customers'], actions)
  return createElement(Customers)
}

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const mount = async (): Promise<void> => { await act(async () => { root.render(createElement(Shell)) }); await flush() }
const key = async (el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
  await flush()
}
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const listEl = (): HTMLElement => host.querySelector<HTMLElement>('.q3-hist__billlist')!
const rows = (): string[] => [...host.querySelectorAll('.q3-hist__billrow')].map((r) => r.textContent ?? '')
const names = (): string[] => [...host.querySelectorAll('.q3-hist__billrow [role="gridcell"]:first-child')].map((r) => r.textContent ?? '')
const sel = (): string | null => useCustomersStore.getState().selectedId

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(520)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 520, width: 900, height: 520, toJSON: () => ({}) })
  Element.prototype.scrollIntoView = vi.fn()
  useCustomersStore.setState({ status: 'idle', error: '', all: [], query: '', rows: [], selectedId: null, edit: null, confirmDelete: null, view: 'list', billsOf: null, bills: [], billsNext: null, billsStatus: 'idle', billId: null })
  useRouter.setState({ nav: { stack: [ROUTES.dashboard, ROUTES.customers] } })
  customers = [
    mk('c1', 'Lakshmi Cloth Center', { phone: '98450 11001', address: '12 Main Rd\nMysuru', transport: 'VRL', billCount: 2, lastBillDate: '2026-10-05', totalBilled: '1234567.50' }),
    mk('c2', 'Ruby Traders', { phone: '99000 22002' }),
    mk('c3', 'Zakers Clothing', { billCount: 1, lastBillDate: '2026-10-02', totalBilled: '30.00' })
  ]
  custBills = { c1: [mkBill(2, 'Lakshmi Cloth Center'), mkBill(1, 'Lakshmi Cloth Center')] }
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

describe('Customers page (Phase 45)', () => {
  it('lists customers A-Z with stats (bill count, DD-MM-YY last bill, Indian total) and focuses the list', async () => {
    await mount()
    expect(rows()[0]).toBe('Lakshmi Cloth Center98450 1100112 Main Rd, MysuruVRL205-10-26₹12,34,567.50')
    expect(rows()[1]).toBe('Ruby Traders99000 22002——0——')
    expect(rows()[2]).toBe('Zakers Clothing———102-10-26₹30.00')
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('3 customers')
    expect([...host.querySelectorAll('.q3-hist__bills .q3-hist__thead span')].map((s) => s.textContent)).toEqual(['Name', 'Phone', 'Address', 'Transport', 'Bills', 'Last bill', 'Total billed'])
    expect(document.activeElement).toBe(listEl())
    expect(sel()).toBe('c1')
  })

  it('arrow keys move the highlight and clamp; Home / End jump', async () => {
    await mount()
    await key(listEl(), 'ArrowDown'); expect(sel()).toBe('c2')
    await key(listEl(), 'End'); expect(sel()).toBe('c3')
    await key(listEl(), 'ArrowDown'); expect(sel()).toBe('c3')
    await key(listEl(), 'Home'); expect(sel()).toBe('c1')
  })

  it('Ctrl+F focuses the search; typing filters (fuzzy), Enter goes to the results, Esc clears', async () => {
    await mount()
    await key(window.document.body, 'f', { ctrlKey: true })
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Search customers"]')!
    expect(document.activeElement).toBe(box)
    await type(box, 'ruby'); await flush()
    expect(names()).toEqual(['Ruby Traders'])
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('1 of 3 customers')
    await key(box, 'Enter'); expect(document.activeElement).toBe(listEl())
    await key(box, 'Escape')
    expect(useCustomersStore.getState().query).toBe('')
    await type(box, 'zzzz'); await flush()
    expect(host.querySelector('.q3-hist__none')?.textContent).toBe('No customers match this search')
  })

  it('Enter edits inline: fields prefilled, Tab-able inputs, Enter saves and the row updates; Esc cancels without saving', async () => {
    await mount()
    await key(listEl(), 'ArrowDown') // Ruby Traders
    await key(listEl(), 'Enter')
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!
    expect(name.value).toBe('Ruby Traders')
    expect(document.activeElement).toBe(name)
    await type(name, 'Ruby Textiles')
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Transport"]')!, 'SRMT')
    await key(name, 'Enter')
    expect(api.update).toHaveBeenCalledWith('c2', { name: 'Ruby Textiles', phone: '99000 22002', address: '', transport: 'SRMT' })
    expect(host.querySelector('input[aria-label="Name"]')).toBeNull()
    expect(names()).toEqual(['Lakshmi Cloth Center', 'Ruby Textiles', 'Zakers Clothing'])
    expect(document.activeElement).toBe(listEl())

    await key(listEl(), 'F2')
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, 'Changed')
    await key(host.querySelector('input[aria-label="Name"]')!, 'Escape')
    expect(api.update).toHaveBeenCalledTimes(1)
    expect(names()[1]).toBe('Ruby Textiles')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.customers) // Esc closed the editor, it did not go Back
  })

  it('Insert adds a customer in a pinned row; a duplicate name keeps the editor open with the message; a good one is added, selected and refreshes Create\'s party list', async () => {
    const partyList = (window as unknown as { quot3: { parties: { list: ReturnType<typeof vi.fn> } } }).quot3.parties.list
    await mount()
    await key(listEl(), 'Insert')
    const name = host.querySelector<HTMLInputElement>('.q3-cust__row input[aria-label="Name"]')!
    expect(document.activeElement).toBe(name)
    await key(name, 'Enter') // blank
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/needs a name/)
    await type(name, 'ruby traders'); await key(name, 'Enter')
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/already exists/)
    expect(host.querySelector('.q3-cust__row')).not.toBeNull()
    await type(name, 'Alpha Co')
    await type(host.querySelector<HTMLTextAreaElement>('textarea')!, '5 Park St')
    await key(name, 'Enter')
    expect(api.create).toHaveBeenLastCalledWith({ name: 'Alpha Co', phone: '', address: '5 Park St', transport: '' })
    expect(host.querySelector('.q3-cust__row')).toBeNull()
    expect(names()[0]).toBe('Alpha Co')
    expect(sel()).toBe('n4')
    expect(partyList).toHaveBeenCalled()
    expect(usePartyIndexStore.getState()).toBeDefined()
  })

  it('Delete asks first (names the customer and says the bills keep their details); confirm deletes and moves the highlight; cancel does nothing', async () => {
    await mount()
    await key(listEl(), 'Delete')
    expect(document.body.textContent).toMatch(/Delete Lakshmi Cloth Center\? Its 2 bills keep the name and details/)
    const buttons = [...document.querySelectorAll('button')]
    await act(async () => { buttons.find((b) => b.textContent === 'Cancel')!.click() })
    expect(api.delete).not.toHaveBeenCalled()
    await key(listEl(), 'Delete')
    await act(async () => { [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete' && b.closest('[role="dialog"]'))!.click() })
    await flush()
    expect(api.delete).toHaveBeenCalledWith('c1')
    expect(names()).toEqual(['Ruby Traders', 'Zakers Clothing'])
    expect(sel()).toBe('c2')
  })

  it('Right opens the customer\'s bills (history-style list); Enter opens a bill for edit; Esc returns to the list instead of leaving the page', async () => {
    await mount()
    await key(listEl(), 'ArrowRight')
    expect(api.bills).toHaveBeenCalledWith({ partyId: 'c1' })
    expect(host.querySelector('.q3-hist__title')?.textContent).toBe('Bills of Lakshmi Cloth Center')
    expect(host.querySelector('.q3-hist__count')?.textContent).toBe('2 bills')
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toBe('Q3-000202-10-26Lakshmi Cloth Center₹200.00')
    const bl = listEl()
    expect(document.activeElement).toBe(bl)
    await key(bl, 'Enter')
    expect(getForEdit).toHaveBeenCalledWith('b2')
    await key(bl, 'Escape')
    expect(host.querySelector('.q3-hist__title')?.textContent).toBe('Customers')
    expect(currentPath(useRouter.getState().nav)).toBe(ROUTES.customers)
    expect(sel()).toBe('c1')
  })

  it('a customer with no bills shows an empty message in its bills view', async () => {
    await mount()
    await key(listEl(), 'ArrowDown')
    await key(listEl(), 'ArrowRight')
    expect(host.querySelector('.q3-hist__none')?.textContent).toBe('No bills for this customer yet')
  })

  it('an empty database shows the empty state with an Add button', async () => {
    customers = []
    await mount()
    expect(host.textContent).toMatch(/No customers yet/)
    await act(async () => { [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add customer' && b.closest('.q3-empty'))!.click() })
    expect(host.querySelector('input[aria-label="Name"]')).not.toBeNull()
  })

  it('the buttons are real: Bills / Edit / Delete are disabled with nothing selected, and the whole page works without a mouse (keyboard-only walk above)', async () => {
    customers = []
    await mount()
    const labels = [...host.querySelectorAll('.q3-hist__actions button')].map((b) => [b.textContent?.replace(/\s+/g, ' ').trim(), (b as HTMLButtonElement).disabled])
    expect(labels.filter(([l]) => /Bills|Edit|Delete/.test(String(l))).every(([, d]) => d === true)).toBe(true)
  })
})
