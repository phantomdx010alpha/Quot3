import { create } from 'zustand'
import type { Quot3Bridge } from '@shared/ipc'
import type { DecisionInput, GroupDetail, GroupSales, ItemsOverview } from '@shared/items/api'
import { defaultTab, partyOfRow, saleKey, saleRowIndex, salesToTsv, tabOf, SALES_TAB_IDS, type SalesTabId } from '@shared/items/salesView'
import { filterGroups } from '@shared/items/search'
import { buildGroupRows, buildSpellingRows, groupIdsOf, type SpellingRow } from '@shared/items/groupRows'
import { useSaveUiStore } from './saveUiStore'
import { openBillForEdit } from './createSession'
import { requestLeave } from './guardStore'

/**
 * Phase 112 - Items page state (overview, search, selected group, focused window, rebuild progress).
 * Phase 113 - plus the selected group's detail (spellings + suggestions), the Spellings cursor, a pending merge / move, and owner decisions + Undo.
 * Phase 114 - plus the Sales window: the selected group's sales (raw `GroupSales`), the Non-GST / GST tab, the highlighted sale, the party filter,
 * open-the-bill and copy-as-TSV. The state lives in this store (not in the page), so coming back from an opened bill (Esc) finds the same group, tab, row and filter.
 * Phase 92 selector rule: this store keeps RAW values (the overview object as received, a string query); the filtered list is derived in
 * the page with `useMemo`. No getter here returns a fresh array / object.
 */
type Bridge = Pick<Quot3Bridge, 'items' | 'on' | 'clipboard'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export type ItemsWindow = 'groups' | 'spellings' | 'sales'
export const ITEMS_WINDOWS: readonly ItemsWindow[] = ['groups', 'spellings', 'sales']

/** Next / previous window, wrapping (Tab / Shift+Tab). Pure. */
export function nextWindow(w: ItemsWindow, dir: 1 | -1): ItemsWindow {
  const i = ITEMS_WINDOWS.indexOf(w)
  return ITEMS_WINDOWS[(i + dir + ITEMS_WINDOWS.length) % ITEMS_WINDOWS.length] as ItemsWindow
}

/** A merge or move that waits for its target: the owner marked something, now picks the item to put it into (M / Enter in Groups, Esc cancels). */
export type PendingDecision =
  | { kind: 'merge'; fromGroupId: string; label: string }
  | { kind: 'move'; groupId: string; spellingKey: string; label: string }

export interface ItemsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  overview: ItemsOverview | null
  query: string
  selectedGroupId: string | null
  window: ItemsWindow
  rebuilding: boolean
  progress: { done: number; total: number } | null
  /** Phase 113: the selected group's spellings and suggestions (raw object as received; `detail.id` says which group it is for). */
  detail: GroupDetail | null
  /** Phase 113: highlighted row of the Spellings window (spellings first, then suggestions). */
  cursor: number
  pending: PendingDecision | null
  /** Phase 113: result line of the last decision / undo (empty = none). */
  notice: string
  /** Phase 113: what Undo would revert now (null = nothing to undo). */
  undo: string | null
  busy: boolean
  /** Phase 114: the selected group's sales (raw object as received; `sales.groupId` says which group it is for). */
  sales: GroupSales | null
  salesTab: SalesTabId
  /** Highlighted row of the Sales table (index into the CURRENT tab's rows). */
  salesCursor: number
  /** Party filter (a `partyKey`), null = all parties. */
  partyFilter: string | null
  /** Set by the page: move DOM focus to a window / the search box. */
  ports: { focusWindow: ((w: ItemsWindow) => void) | null; focusSearch: (() => void) | null }

  /** `select`: group to highlight afterwards when it exists; `fallback`: used when the current selection vanished. */
  load(opts?: { select?: string | null; fallback?: string | null }): Promise<void>
  loadDetail(): Promise<void>
  /** Phase 114: read the selected group's sales (with the party filter); keeps the highlighted sale when it is still there. */
  loadSales(): Promise<void>
  setSalesTab(id: SalesTabId): void
  toggleSalesTab(): void
  setSalesCursor(i: number): void
  /** P: show only the highlighted sale's party; again (or on that party) = all parties. */
  filterByCursorParty(): Promise<void>
  setPartyFilter(key: string | null): Promise<void>
  clearPartyFilter(): Promise<boolean>
  /** Enter / double-click: open the highlighted sale's bill (asks first when the bill open on Create has unsaved changes). */
  openSaleBill(index?: number): Promise<boolean>
  /** Copy the CURRENT table (tab + party filter) to the clipboard as TSV. */
  copySales(): Promise<boolean>
  rebuild(): Promise<void>
  setQuery(q: string): void
  selectGroup(id: string | null): void
  setCursor(i: number): void
  /** The Spellings rows now (computed on demand, never stored). */
  spellingRows(): SpellingRow[]
  decide(input: DecisionInput): Promise<boolean>
  undoDecision(): Promise<void>
  /** M: mark the highlighted item, or (when one is marked) merge it into the highlighted item. */
  mergeKey(): Promise<void>
  /** V on a spelling: mark it to move; the target is picked in Groups. */
  moveKey(): void
  /** S on a spelling: pull it out into its own item. */
  splitKey(): Promise<void>
  /** Enter on a suggestion: do the merge it proposes. */
  confirmKey(): Promise<void>
  /** X on a suggestion: these are different items. */
  rejectKey(): Promise<void>
  /** Delete in Groups: not an item. */
  ignoreKey(): Promise<void>
  cancelPending(): boolean
  setWindow(w: ItemsWindow): void
  setPorts(p: Partial<ItemsState['ports']>): void
}

let token = 0
let detailToken = 0
let salesToken = 0

const groupRowsNow = (s: ItemsState) => (s.overview ? buildGroupRows(filterGroups(s.overview.groups, s.query), s.overview.families) : [])
const nameOfGroup = (s: ItemsState) => (id: string): string => s.overview?.groups.find((g) => g.id === id)?.display ?? id

export const useItemsStore = create<ItemsState>((set, get) => ({
  status: 'idle',
  error: '',
  overview: null,
  query: '',
  selectedGroupId: null,
  window: 'groups',
  rebuilding: false,
  progress: null,
  detail: null,
  cursor: 0,
  pending: null,
  notice: '',
  undo: null,
  busy: false,
  sales: null,
  salesTab: 'nonGst',
  salesCursor: 0,
  partyFilter: null,
  ports: { focusWindow: null, focusSearch: null },

  async load(opts) {
    const a = api()?.items
    if (!a) { set({ status: 'error', error: 'The items service is not available.' }); return }
    const my = ++token
    // A reload keeps what is on screen (no flash); only the first load shows the loading state.
    if (get().overview === null) set({ status: 'loading', error: '' })
    const res = await a.overview()
    if (my !== token) return
    if (!res.ok) { set({ status: 'error', error: res.error.message }); return }
    const has = (id: string | null | undefined): id is string => typeof id === 'string' && res.data.groups.some((g) => g.id === id)
    const sel = get().selectedGroupId
    const want = opts?.select
    const fb = opts?.fallback
    const next = has(want) ? want : has(sel) ? sel : has(fb) ? fb : (res.data.groups[0]?.id ?? null)
    set({ status: 'ready', error: '', overview: res.data, selectedGroupId: next, ...(next !== sel ? { cursor: 0, partyFilter: null, salesCursor: 0 } : {}) })
    const ld = await a.lastDecision?.()
    if (my === token && ld?.ok) set({ undo: ld.data.undo })
    await get().loadDetail()
    await get().loadSales()
  },

  async loadDetail() {
    const a = api()?.items
    const id = get().selectedGroupId
    if (!a || !a.group || id === null) { set({ detail: null }); return }
    const my = ++detailToken
    const res = await a.group({ groupId: id })
    if (my !== detailToken || get().selectedGroupId !== id) return
    if (!res.ok) { set({ detail: null }); return }
    const rows = res.data.spellings.length + res.data.suggestions.length
    set({ detail: res.data, cursor: Math.min(get().cursor, Math.max(0, rows - 1)) })
  },

  async loadSales() {
    const a = api()?.items
    const id = get().selectedGroupId
    if (!a || !a.sales || id === null) { set({ sales: null }); return }
    const my = ++salesToken
    const s0 = get()
    const keep = s0.sales && s0.sales.groupId === id ? (tabOf(s0.sales, s0.salesTab).rows[s0.salesCursor] ?? null) : null
    const keepKey = keep ? saleKey(keep) : null
    const res = await a.sales(s0.partyFilter ? { groupId: id, partyKey: s0.partyFilter } : { groupId: id })
    if (my !== salesToken || get().selectedGroupId !== id) return
    if (!res.ok) { set({ sales: null }); return }
    const sameGroup = s0.sales !== null && s0.sales.groupId === id
    const tab = sameGroup ? s0.salesTab : defaultTab(res.data)
    const rows = tabOf(res.data, tab).rows
    const at = saleRowIndex(rows, keepKey)
    set({ sales: res.data, salesTab: tab, salesCursor: at >= 0 ? at : Math.min(sameGroup ? s0.salesCursor : 0, Math.max(0, rows.length - 1)) })
  },

  setSalesTab(id) {
    const s = get()
    if (s.salesTab === id) return
    set({ salesTab: id, salesCursor: 0 })
  },
  toggleSalesTab() {
    const s = get()
    const i = SALES_TAB_IDS.indexOf(s.salesTab)
    get().setSalesTab(SALES_TAB_IDS[(i + 1) % SALES_TAB_IDS.length] as SalesTabId)
  },
  setSalesCursor: (salesCursor) => set({ salesCursor }),

  async setPartyFilter(key) {
    if (get().partyFilter === key) return
    set({ partyFilter: key, salesCursor: 0 })
    await get().loadSales()
  },
  async filterByCursorParty() {
    const s = get()
    if (!s.sales) return
    if (s.partyFilter !== null) { await get().setPartyFilter(null); return }
    const key = partyOfRow(tabOf(s.sales, s.salesTab).rows, s.salesCursor)
    if (key !== null) await get().setPartyFilter(key)
  },
  async clearPartyFilter() {
    if (get().partyFilter === null) return false
    await get().setPartyFilter(null)
    return true
  },

  async openSaleBill(index) {
    const s = get()
    if (!s.sales) return false
    const row = tabOf(s.sales, s.salesTab).rows[index ?? s.salesCursor]
    if (!row) return false
    const a = api()?.items
    if (!a || !a.openTarget) return false
    const say = (tone: 'ok' | 'warn' | 'danger', msg: string): void => useSaveUiStore.getState().announce(tone, msg)
    const res = await a.openTarget({ billId: row.billId })
    if (!res.ok) { say('danger', `Could not open ${row.poNumber}: ${res.error.message}`); return false }
    if (res.data === null) { say('warn', `${row.poNumber} no longer exists. Press F5 to read the bills again.`); return false }
    const t = res.data
    requestLeave(() => {
      void openBillForEdit(t.billId).then((ok) => { if (!ok) say('danger', `Could not open ${t.poNumber}`) })
    })
    return true
  },

  async copySales() {
    const s = get()
    const say = (tone: 'ok' | 'warn' | 'danger', msg: string): void => useSaveUiStore.getState().announce(tone, msg)
    if (!s.sales) { say('warn', 'Nothing to copy: select an item first'); return false }
    const tab = tabOf(s.sales, s.salesTab)
    if (tab.rows.length === 0) { say('warn', 'Nothing to copy: no sales in this list'); return false }
    const clip = api()?.clipboard
    if (!clip) { say('danger', 'Could not copy: clipboard is not available'); return false }
    try {
      const r = await clip.writeTsv({ text: salesToTsv(tab, s.salesTab) })
      if (!r.ok) { say('danger', `Could not copy: ${r.error.message}`); return false }
      say('ok', `${tab.rows.length} ${tab.rows.length === 1 ? 'sale' : 'sales'} copied - paste into Excel`)
      return true
    } catch (e) {
      say('danger', `Could not copy: ${e instanceof Error ? e.message : 'unknown error'}`)
      return false
    }
  },

  async rebuild() {
    const a = api()?.items
    if (!a || get().rebuilding) return
    set({ rebuilding: true, progress: null, error: '' })
    const unsub = api()?.on?.('items:progress', (p: unknown) => {
      const x = p as { done?: number; total?: number } | null
      if (x && typeof x.done === 'number' && typeof x.total === 'number') set({ progress: { done: x.done, total: x.total } })
    })
    try {
      const res = await a.rebuild()
      if (!res.ok) { set({ rebuilding: false, progress: null, error: res.error.message }); return }
      set({ rebuilding: false, progress: null })
      await get().load()
    } finally {
      unsub?.()
      if (get().rebuilding) set({ rebuilding: false, progress: null })
    }
  },

  setQuery: (query) => set({ query }),
  selectGroup(id) {
    if (get().selectedGroupId === id) return
    set({ selectedGroupId: id, cursor: 0, partyFilter: null, salesCursor: 0 })
    void get().loadDetail()
    void get().loadSales()
  },
  setCursor: (cursor) => set({ cursor }),

  spellingRows() {
    const s = get()
    return s.detail && s.detail.id === s.selectedGroupId ? buildSpellingRows(s.detail, nameOfGroup(s)) : []
  },

  async decide(input) {
    const a = api()?.items
    if (!a || !a.decide || get().busy) return false
    set({ busy: true })
    try {
      const s0 = get()
      // when the highlighted item disappears (ignore), land on its neighbour
      const ids = groupIdsOf(groupRowsNow(s0))
      const at = s0.selectedGroupId === null ? -1 : ids.indexOf(s0.selectedGroupId)
      const fallback = at >= 0 ? (ids[at + 1] ?? ids[at - 1] ?? null) : null
      const res = await a.decide(input)
      if (!res.ok) { set({ error: res.error.message, pending: null }); return false }
      set({ error: '', notice: res.data.message, undo: res.data.undo, pending: null })
      await get().load({ select: res.data.selectId, fallback })
      return true
    } finally { set({ busy: false }) }
  },

  async undoDecision() {
    const a = api()?.items
    if (!a || !a.undo || get().busy) return
    set({ busy: true })
    try {
      const res = await a.undo()
      if (!res.ok) { set({ error: res.error.message }); return }
      set({ error: '', notice: res.data.message, undo: res.data.undo, pending: null })
      await get().load()
    } finally { set({ busy: false }) }
  },

  async mergeKey() {
    const s = get()
    const sel = s.selectedGroupId
    if (sel === null) return
    const display = nameOfGroup(s)(sel)
    if (s.pending === null) { set({ pending: { kind: 'merge', fromGroupId: sel, label: display }, notice: '', error: '' }); return }
    const p = s.pending
    if (p.kind === 'merge') {
      if (p.fromGroupId === sel) { set({ pending: null, notice: 'Nothing merged: pick a different item first.' }); return }
      await get().decide({ op: 'merge', fromGroupId: p.fromGroupId, intoGroupId: sel })
    } else {
      if (p.groupId === sel) { set({ pending: null, notice: 'Nothing moved: pick a different item.' }); return }
      await get().decide({ op: 'move', groupId: p.groupId, spellingKey: p.spellingKey, intoGroupId: sel })
    }
  },

  moveKey() {
    const s = get()
    const row = s.spellingRows()[s.cursor]
    if (!row || row.kind !== 'spelling' || s.selectedGroupId === null) return
    set({ pending: { kind: 'move', groupId: s.selectedGroupId, spellingKey: row.spelling.originalKey, label: row.spelling.name }, notice: '', error: '' })
    s.ports.focusWindow?.('groups')
  },

  async splitKey() {
    const s = get()
    const row = s.spellingRows()[s.cursor]
    if (!row || row.kind !== 'spelling' || s.selectedGroupId === null) return
    await get().decide({ op: 'split', groupId: s.selectedGroupId, spellingKey: row.spelling.originalKey })
  },

  async confirmKey() {
    const row = get().spellingRows()[get().cursor]
    if (!row || row.kind !== 'suggestion') return
    await get().decide({ op: 'merge', fromGroupId: row.suggestion.fromId, intoGroupId: row.suggestion.toId })
  },

  async rejectKey() {
    const row = get().spellingRows()[get().cursor]
    if (!row || row.kind !== 'suggestion') return
    await get().decide({ op: 'reject', fromGroupId: row.suggestion.fromId, intoGroupId: row.suggestion.toId })
  },

  async ignoreKey() {
    const sel = get().selectedGroupId
    if (sel === null) return
    await get().decide({ op: 'ignore', groupId: sel })
  },

  cancelPending() {
    if (get().pending === null) return false
    set({ pending: null, notice: '' })
    return true
  },

  setWindow: (window) => set({ window }),
  setPorts: (p) => set((s) => ({ ports: { ...s.ports, ...p } }))
}))
