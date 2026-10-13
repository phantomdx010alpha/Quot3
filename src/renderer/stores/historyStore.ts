import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import { effectiveTargets, rangeIds, type BillListItem, type HistoryBranch, type HistoryDate, type HistorySource } from '@shared/history/historyList'

type HistoryApi = Quot3Bridge['history']
const api = (): HistoryApi | undefined => (window as unknown as { quot3?: { history?: HistoryApi } }).quot3?.history

export interface HistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  dates: HistoryDate[]
  /** Selected `YYYY-MM-DD`, or null when there are no bills. */
  date: string | null
  bills: BillListItem[]
  /** Cursor of the next page of the selected date, or null. */
  next: string | null
  loadingMore: boolean
  /** Highlighted bill id (the actions act on it, or on `selection` when that is not empty). */
  billId: string | null
  /** Phase 42: search text and the From / To date filter (`YYYY-MM-DD` or ''). A non-blank query switches the list to ranked results over all dates. */
  query: string
  from: string
  to: string
  /** The search matched more than the cap. */
  truncated: boolean
  /** Phase 42: multi-selection (Shift+arrows / Ctrl+click / Ctrl+A) in list order; empty = just the highlighted bill. */
  selection: string[]
  anchor: string | null
  /** Phase 42: bills waiting for the delete confirmation. */
  confirmDelete: BillListItem[] | null
  branches: HistoryBranch[]
  /** Phase 59: `'all'` (default) or one branch id (the local one = "This branch"). */
  branch: string
  /** Phase 86: All / Created here / Imported, and (inside Imported) one import batch id or ''. */
  source: HistorySource
  batch: string
  /** Ports registered by the mounted page so palette actions can move focus. */
  focusDates: (() => void) | null
  focusBills: (() => void) | null
  focusSearch: (() => void) | null
  focusDateRange: (() => void) | null

  refresh: () => Promise<void>
  selectDate: (date: string) => Promise<void>
  loadMore: () => Promise<void>
  selectBill: (id: string | null) => void
  setPorts: (p: Partial<Pick<HistoryState, 'focusDates' | 'focusBills' | 'focusSearch' | 'focusDateRange'>>) => void
  /** Phase 42 */
  setQuery: (q: string) => Promise<void>
  setRange: (from: string, to: string) => Promise<void>
  /** Phase 59: filter the lists to one branch or `'all'`. */
  setBranch: (branch: string) => Promise<void>
  /** Phase 86: filter by where the bill came from; `batch` ('' = every import) only applies to `'imported'`. */
  setSource: (source: HistorySource, batch: string) => Promise<void>
  clearFilters: () => Promise<void>
  extendSelection: (toId: string) => void
  toggleSelected: (id: string) => void
  selectAll: () => void
  /** The bills an action acts on (selection, else the highlighted one), in list order. */
  targets: () => BillListItem[]
  askDelete: () => boolean
  cancelDelete: () => void
  /** Delete the bills waiting in `confirmDelete`; resolves the ids that were deleted. */
  confirmDeleteNow: () => Promise<string[]>
}

// A newer request makes older answers irrelevant (arrow-keying through dates fires many).
let listSeq = 0

/** Only the filters that are set (the IPC schema is strict about shapes, and blanks mean "no filter"). */
const rangeArgs = (s: { from: string; to: string; branch?: string; source?: HistorySource; batch?: string }): { from?: string; to?: string; branch?: string; source?: HistorySource; batch?: string } => ({
  ...(s.from ? { from: s.from } : {}), ...(s.to ? { to: s.to } : {}), ...(s.branch && s.branch !== 'all' ? { branch: s.branch } : {}),
  ...(s.source && s.source !== 'all' ? { source: s.source } : {}), ...(s.source === 'imported' && s.batch ? { batch: s.batch } : {})
})

/** Ranked search over every date (the date filter still applies). Fills the list; the highlight follows `prev` when still listed. */
async function runSearch(seq: number, prev: string | null): Promise<void> {
  const h = api()
  const { query } = useHistoryStore.getState()
  if (!h) return
  const r = await h.search({ query: query.trim(), ...rangeArgs(useHistoryStore.getState()) })
  if (seq !== listSeq) return
  if (!r.ok) { useHistoryStore.setState({ status: 'error', error: r.error.message, bills: [], billId: null, selection: [] }); return }
  const items = r.data.items
  useHistoryStore.setState({
    bills: items, next: null, truncated: r.data.truncated, status: 'ready', error: '',
    selection: useHistoryStore.getState().selection.filter((id) => items.some((i) => i.id === id)),
    billId: items.some((i) => i.id === prev) ? prev : (items[0]?.id ?? null)
  })
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  status: 'idle', error: '', dates: [], date: null, bills: [], next: null, loadingMore: false, billId: null, branches: [], branch: 'all', source: 'all', batch: '',
  query: '', from: '', to: '', truncated: false, selection: [], anchor: null, confirmDelete: null,
  focusDates: null, focusBills: null, focusSearch: null, focusDateRange: null,

  async refresh() {
    const h = api()
    if (!h) { set({ status: 'error', error: 'History is not available (no bridge).' }); return }
    const seq = ++listSeq
    set({ status: 'loading', error: '' })
    try {
      const [d, b] = await Promise.all([h.listDates(rangeArgs(get())), h.branches()])
      if (seq !== listSeq) return
      if (!d.ok) { set({ status: 'error', error: d.error.message }); return }
      const dates = d.data
      const keep = get().date
      const date = keep !== null && dates.some((x) => x.date === keep) ? keep : (dates[0]?.date ?? null)
      set({ dates, branches: b.ok ? b.data : [], date })
      const prev = get().billId
      if (get().query.trim() !== '') { await runSearch(seq, prev); return }
      if (date === null) { set({ bills: [], next: null, billId: null, selection: [], anchor: null, truncated: false, status: 'ready' }); return }
      const l = await h.listBills({ date, ...rangeArgs(get()) })
      if (seq !== listSeq) return
      if (!l.ok) { set({ status: 'error', error: l.error.message }); return }
      const kept = get().selection.filter((id) => l.data.items.some((i) => i.id === id))
      set({ bills: l.data.items, next: l.data.next ?? null, truncated: false, status: 'ready', selection: kept, billId: l.data.items.some((i) => i.id === prev) ? prev : (l.data.items[0]?.id ?? null) })
    } catch (e) {
      if (seq === listSeq) set({ status: 'error', error: e instanceof Error ? e.message : 'Could not load History.' })
    }
  },

  async selectDate(date) {
    const h = api()
    if (!h || (date === get().date && get().query.trim() === '')) return
    const seq = ++listSeq
    set({ date, next: null, loadingMore: false, query: '', truncated: false, selection: [], anchor: null })
    try {
      const l = await h.listBills({ date, ...rangeArgs(get()) })
      if (seq !== listSeq) return
      if (!l.ok) { set({ status: 'error', error: l.error.message, bills: [], billId: null }); return }
      set({ bills: l.data.items, next: l.data.next ?? null, status: 'ready', error: '', billId: l.data.items[0]?.id ?? null })
    } catch (e) {
      if (seq === listSeq) set({ status: 'error', error: e instanceof Error ? e.message : 'Could not load bills.', bills: [], billId: null })
    }
  },

  async loadMore() {
    const h = api()
    const { next, date, loadingMore } = get()
    if (!h || next === null || loadingMore || date === null || get().query.trim() !== '') return
    const seq = listSeq
    set({ loadingMore: true })
    try {
      const l = await h.listBills({ date, cursor: next, ...rangeArgs(get()) })
      if (seq !== listSeq) return
      if (!l.ok) { set({ loadingMore: false, error: l.error.message }); return }
      const seen = new Set(get().bills.map((b) => b.id))
      set({ bills: [...get().bills, ...l.data.items.filter((i) => !seen.has(i.id))], next: l.data.next ?? null, loadingMore: false })
    } catch {
      if (seq === listSeq) set({ loadingMore: false })
    }
  },

  selectBill: (billId) => set({ billId, selection: [], anchor: billId }),
  setPorts: (p) => set(p),

  async setQuery(q) {
    if (q === get().query) return
    set({ query: q })
    const seq = ++listSeq
    const h = api()
    if (!h) return
    if (q.trim() === '') { await get().refresh(); return }
    set({ next: null, loadingMore: false })
    try { await runSearch(seq, get().billId) } catch (e) { if (seq === listSeq) set({ status: 'error', error: e instanceof Error ? e.message : 'Search failed.' }) }
  },

  async setRange(from, to) {
    if (from === get().from && to === get().to) return
    if (from !== '' && to !== '' && from > to) { set({ from, to, error: 'The From date is after the To date', status: 'error' }); return }
    set({ from, to, error: '', status: 'loading' })
    await get().refresh()
  },

  async setBranch(branch) {
    if (branch === get().branch) return
    set({ branch, error: '', status: 'loading', selection: [], anchor: null })
    await get().refresh()
  },

  async setSource(source, batch) {
    const b = source === 'imported' ? batch : ''
    if (source === get().source && b === get().batch) return
    set({ source, batch: b, error: '', status: 'loading', selection: [], anchor: null })
    await get().refresh()
  },

  async clearFilters() {
    if (get().query === '' && get().from === '' && get().to === '' && get().source === 'all') return
    set({ query: '', from: '', to: '', source: 'all', batch: '', error: '' })
    await get().refresh()
  },

  extendSelection(toId) {
    const { bills, anchor, billId } = get()
    const from = anchor ?? billId
    set({ selection: rangeIds(bills, from, toId), billId: toId, anchor: from })
  },

  toggleSelected(id) {
    const { selection, billId } = get()
    // First toggle starts a multi-selection (the highlighted bill counts as already picked when a DIFFERENT bill is ctrl-clicked).
    const base = selection.length > 0 ? selection : (billId && billId !== id ? [billId] : [])
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    const order = new Map(get().bills.map((b, i) => [b.id, i]))
    set({ selection: next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)), billId: id, anchor: id })
  },

  selectAll: () => set({ selection: get().bills.map((b) => b.id) }),

  targets() {
    const { bills, selection, billId } = get()
    const ids = new Set(effectiveTargets(selection, billId))
    return bills.filter((b) => ids.has(b.id))
  },

  askDelete() {
    const t = get().targets()
    if (t.length === 0) return false
    set({ confirmDelete: t })
    return true
  },
  cancelDelete: () => set({ confirmDelete: null }),

  async confirmDeleteNow() {
    const pending = get().confirmDelete
    const h = (window as unknown as { quot3?: { bills?: Quot3Bridge['bills'] } }).quot3?.bills
    set({ confirmDelete: null })
    if (!pending || !h) return []
    const r = await h.delete({ ids: pending.map((b) => b.id) })
    if (!r.ok) { set({ status: 'error', error: r.error.message }); return [] }
    set({ selection: [], anchor: null })
    await get().refresh()
    return r.data.deleted
  }
}))
