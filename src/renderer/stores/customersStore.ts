import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { searchCustomers, validateCustomerInput, type CustomerField, type CustomerInput, type CustomerRow } from '@shared/customers/customerList'
import { sanitizePartyField } from '@shared/partyFields'
import type { BillListItem } from '@shared/history/historyList'
import { usePartyIndexStore } from './partyIndexStore'

type Api = Quot3Bridge['customers']
const api = (): Api | undefined => (window as unknown as { quot3?: { customers?: Api } }).quot3?.customers

export interface CustomerDraft { name: string; phone: string; address: string; transport: string }
export const BLANK_DRAFT: CustomerDraft = { name: '', phone: '', address: '', transport: '' }

/** The inline editor: `id` null = a new customer (the pinned row above the list). */
export interface CustomerEdit { id: string | null; draft: CustomerDraft; error: string; saving: boolean }

export interface CustomersState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  all: CustomerRow[]
  query: string
  /** `all` filtered by `query` (fuzzy). */
  rows: CustomerRow[]
  selectedId: string | null
  edit: CustomerEdit | null
  confirmDelete: CustomerRow | null
  /** `bills` shows the selected customer's bills instead of the list. */
  view: 'list' | 'bills'
  billsOf: CustomerRow | null
  bills: BillListItem[]
  billsNext: string | null
  billsStatus: 'idle' | 'loading' | 'ready' | 'error'
  billId: string | null
  focusList: (() => void) | null
  focusSearch: (() => void) | null
  focusBills: (() => void) | null

  setPorts: (p: { focusList?: (() => void) | null; focusSearch?: (() => void) | null; focusBills?: (() => void) | null }) => void
  load: () => Promise<void>
  setQuery: (q: string) => void
  select: (id: string | null) => void
  selected: () => CustomerRow | null

  startEdit: (id: string | null) => boolean
  setDraft: (field: CustomerField, value: string) => void
  cancelEdit: () => void
  /** Saves the editor; resolves the customer id, or null when it was refused (the editor stays open with the message). */
  saveEdit: () => Promise<string | null>

  askDelete: () => boolean
  cancelDelete: () => void
  confirmDeleteNow: () => Promise<CustomerRow | null>

  openBills: () => Promise<boolean>
  closeBills: () => void
  loadMoreBills: () => Promise<void>
  selectBill: (id: string | null) => void
}

const toInput = (d: CustomerDraft): CustomerInput => ({ name: d.name, phone: d.phone, address: d.address, transport: d.transport })
const draftOf = (c: CustomerRow): CustomerDraft => ({ name: c.name, phone: c.phone, address: c.address, transport: c.transport })
const msg = (e: unknown): string => (e instanceof Error ? e.message : 'unknown error')

export const useCustomersStore = create<CustomersState>((set, get) => ({
  status: 'idle', error: '', all: [], query: '', rows: [], selectedId: null, edit: null, confirmDelete: null,
  view: 'list', billsOf: null, bills: [], billsNext: null, billsStatus: 'idle', billId: null,
  focusList: null, focusSearch: null, focusBills: null,

  setPorts: (p) => set(p),

  async load() {
    const c = api()
    if (!c) { set({ status: 'error', error: 'Not connected to the app' }); return }
    set({ status: 'loading', error: '' })
    try {
      const r = await c.list()
      if (!r.ok) { set({ status: 'error', error: r.error.message }); return }
      const { query, selectedId } = get()
      const rows = searchCustomers(r.data, query)
      set({ status: 'ready', all: r.data, rows, selectedId: selectedId !== null && rows.some((x) => x.id === selectedId) ? selectedId : (rows[0]?.id ?? null) })
    } catch (e) {
      set({ status: 'error', error: `Could not load customers: ${msg(e)}` })
    }
  },

  setQuery(q) {
    const rows = searchCustomers(get().all, q)
    const { selectedId } = get()
    // The best match is highlighted so Enter / Down work straight after typing.
    set({ query: q, rows, selectedId: q.trim() !== '' ? (rows[0]?.id ?? null) : selectedId !== null && rows.some((x) => x.id === selectedId) ? selectedId : (rows[0]?.id ?? null) })
  },

  select: (id) => set({ selectedId: id }),
  selected: () => get().rows.find((r) => r.id === get().selectedId) ?? null,

  startEdit(id) {
    if (get().edit) return false
    if (id === null) { set({ edit: { id: null, draft: { ...BLANK_DRAFT }, error: '', saving: false } }); return true }
    const c = get().all.find((r) => r.id === id)
    if (!c) return false
    set({ edit: { id, draft: draftOf(c), error: '', saving: false }, selectedId: id })
    return true
  },

  setDraft(field, value) {
    const e = get().edit
    if (!e) return
    set({ edit: { ...e, draft: { ...e.draft, [field]: sanitizePartyField(field, value) }, error: '' } })
  },

  cancelEdit: () => set({ edit: null }),

  async saveEdit() {
    const e = get().edit
    const c = api()
    if (!e || e.saving) return null
    const input = toInput(e.draft)
    const problem = validateCustomerInput(input)
    if (problem) { set({ edit: { ...e, error: problem } }); return null }
    if (!c) { set({ edit: { ...e, error: 'Not connected to the app' } }); return null }
    set({ edit: { ...e, saving: true, error: '' } })
    try {
      const r = e.id === null ? await c.create(input) : await c.update(e.id, input)
      if (!r.ok) { set({ edit: { ...e, saving: false, error: r.error.message } }); return null }
      // A new customer must be visible: a search that would hide it is cleared.
      set({ edit: null, selectedId: r.data.id, ...(e.id === null ? { query: '' } : {}) })
      await get().load()
      void usePartyIndexStore.getState().load()
      return r.data.id
    } catch (err) {
      set({ edit: { ...e, saving: false, error: `Could not save: ${msg(err)}` } })
      return null
    }
  },

  askDelete() {
    const c = get().selected()
    if (!c || get().edit) return false
    set({ confirmDelete: c })
    return true
  },
  cancelDelete: () => set({ confirmDelete: null }),

  async confirmDeleteNow() {
    const target = get().confirmDelete
    const c = api()
    set({ confirmDelete: null })
    if (!target || !c) return null
    try {
      const r = await c.delete(target.id)
      if (!r.ok) { set({ error: r.error.message, status: 'error' }); return null }
      // Move the highlight to the neighbour so repeated Delete walks down the list.
      const { rows } = get()
      const i = rows.findIndex((x) => x.id === target.id)
      const next = rows[i + 1] ?? rows[i - 1] ?? null
      set({ selectedId: next?.id ?? null, error: '', status: 'ready' })
      await get().load()
      void usePartyIndexStore.getState().load()
      return target
    } catch (e) {
      set({ error: `Could not delete: ${msg(e)}`, status: 'error' })
      return null
    }
  },

  async openBills() {
    const c = api()
    const who = get().selected()
    if (!c || !who || get().edit) return false
    set({ view: 'bills', billsOf: who, bills: [], billsNext: null, billsStatus: 'loading', billId: null })
    try {
      const r = await c.bills({ partyId: who.id })
      if (get().billsOf?.id !== who.id) return false
      if (!r.ok) { set({ billsStatus: 'error', error: r.error.message }); return false }
      set({ bills: r.data.items, billsNext: r.data.next ?? null, billsStatus: 'ready', billId: r.data.items[0]?.id ?? null, error: '' })
      return true
    } catch (e) {
      set({ billsStatus: 'error', error: `Could not load the bills: ${msg(e)}` })
      return false
    }
  },

  closeBills: () => set({ view: 'list', billsOf: null, bills: [], billsNext: null, billsStatus: 'idle', billId: null }),

  async loadMoreBills() {
    const { billsNext, billsOf, billsStatus } = get()
    const c = api()
    if (!c || !billsOf || billsNext === null || billsStatus === 'loading') return
    set({ billsStatus: 'loading' })
    try {
      const r = await c.bills({ partyId: billsOf.id, cursor: billsNext })
      if (get().billsOf?.id !== billsOf.id) return
      if (!r.ok) { set({ billsStatus: 'error', error: r.error.message }); return }
      set((s) => ({ bills: [...s.bills, ...r.data.items], billsNext: r.data.next ?? null, billsStatus: 'ready' }))
    } catch (e) {
      set({ billsStatus: 'error', error: `Could not load more bills: ${msg(e)}` })
    }
  },

  selectBill: (id) => set({ billId: id })
}))
