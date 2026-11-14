/**
 * Phase 219 (M21): one small adapter per page. Each reads the page's stores / DOM when the page is left and puts the remembered state
 * back on return. Everything is by ID (nearest neighbour when the item is gone); nothing here stores bill content.
 */
import type { StoreApi } from 'zustand'
import { restoreSelection, type PageMemory } from '@shared/nav/pageMemory'
import { tabOf } from '@shared/items/salesView'
import type { PageAdapter, PageSnapshot } from '../stores/pageMemoryStore'
import { useHistoryStore } from '../stores/historyStore'
import { useTrashStore } from '../stores/trashStore'
import { toggleTrash } from '../stores/trashActions'
import { useCustomersStore } from '../stores/customersStore'
import { useItemsStore } from '../stores/itemsStore'
import { usePriceListStore } from '../stores/priceListStore'
import { useSettingsStore, SETTINGS_SECTIONS, type SettingsSection } from '../stores/settingsStore'

export interface Region { sel: string; nth?: number }
type Root = () => ParentNode | null

const regionEl = (root: ParentNode | null, r: Region): HTMLElement | null => (root?.querySelectorAll<HTMLElement>(r.sel)[r.nth ?? 0]) ?? null

export function readScroll(root: ParentNode | null, regions: Record<string, Region>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, r] of Object.entries(regions)) { const el = regionEl(root, r); if (el) out[k] = Math.round(el.scrollTop) }
  return out
}

/** Sets each region's scrollTop; re-tries for a few frames because the rows may render a moment after the data arrives. */
export function applyScroll(root: Root, regions: Record<string, Region>, scroll: Record<string, number>): void {
  let frames = 0
  const step = (): void => {
    let pending = false
    for (const [k, r] of Object.entries(regions)) {
      const want = scroll[k]
      const el = regionEl(root(), r)
      if (want === undefined || !el) continue
      if (Math.abs(el.scrollTop - want) > 1) { el.scrollTop = want; if (Math.abs(el.scrollTop - want) > 1) pending = true }
    }
    if (pending && ++frames < 12 && typeof requestAnimationFrame === 'function') requestAnimationFrame(step)
  }
  step()
}

/** Resolves when `ready()` is true (checked on every store change), or after `ms` so a failed load never hangs the page. */
export function waitFor<T>(store: Pick<StoreApi<T>, 'getState' | 'subscribe'>, ready: (s: T) => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (ready(store.getState())) { resolve(); return }
    const off = store.subscribe((s) => { if (ready(s)) { clearTimeout(t); off(); resolve() } })
    const t = setTimeout(() => { off(); resolve() }, ms)
  })
}

const orderHint = (ids: readonly string[], id: string | null): number | undefined => { const i = id === null ? -1 : ids.indexOf(id); return i >= 0 ? i : undefined }

// ---------------------------------------------------------------- History
const HIST_REGIONS: Record<string, Region> = { dates: { sel: '.q3-hist__datelist' }, bills: { sel: '.q3-hist__billlist' } }

export function historyAdapter(root: Root): PageAdapter {
  return {
    capture(): PageSnapshot {
      const s = useHistoryStore.getState()
      const snap: PageSnapshot = {
        scroll: readScroll(root(), HIST_REGIONS),
        filters: { query: s.query, from: s.from, to: s.to, source: s.source, batch: s.batch, date: s.date },
        panels: { trash: useTrashStore.getState().open }
      }
      if (s.billId) snap.selection = { kind: 'bill', id: s.billId, ...(orderHint(s.bills.map((b) => b.id), s.billId) !== undefined ? { orderHint: orderHint(s.bills.map((b) => b.id), s.billId)! } : {}) }
      return snap
    },
    async apply(mem: PageMemory): Promise<void> {
      await waitFor(useHistoryStore, (s) => s.status === 'ready' || s.status === 'error')
      const h = useHistoryStore.getState()
      const f = mem.filters
      if (typeof f.query === 'string' && f.query !== h.query) await h.setQuery(f.query)
      if ((typeof f.from === 'string' && f.from !== h.from) || (typeof f.to === 'string' && f.to !== h.to)) await h.setRange(String(f.from ?? ''), String(f.to ?? ''))
      if ((typeof f.source === 'string' && f.source !== h.source) || (typeof f.batch === 'string' && f.batch !== h.batch)) await h.setSource((f.source as typeof h.source) ?? 'all', String(f.batch ?? ''))
      const cur = useHistoryStore.getState()
      if (typeof f.date === 'string' && cur.query.trim() === '' && f.date !== cur.date && cur.dates.some((d) => d.date === f.date)) await cur.selectDate(f.date)
      const st = useHistoryStore.getState()
      if (mem.selection?.kind === 'bill') {
        const r = restoreSelection(st.bills.map((b) => b.id), mem.selection)
        if (r.id !== null && r.id !== st.billId) st.selectBill(r.id)
      }
      if (mem.panels.trash === true && !useTrashStore.getState().open) await toggleTrash()
      applyScroll(root, HIST_REGIONS, mem.scroll)
    }
  }
}

// ---------------------------------------------------------------- Customers
const CUST_REGIONS: Record<string, Region> = { list: { sel: '.q3-hist__billlist' } }
const CUST_BILL_REGIONS: Record<string, Region> = { bills: { sel: '.q3-hist__billlist' } }

export function customersAdapter(root: Root): PageAdapter {
  return {
    capture(): PageSnapshot {
      const s = useCustomersStore.getState()
      const ids = s.rows.map((r) => r.id)
      const inBills = s.view === 'bills' && s.billsOf !== null
      const snap: PageSnapshot = {
        scroll: readScroll(root(), inBills ? CUST_BILL_REGIONS : CUST_REGIONS),
        filters: { query: s.query, billId: inBills ? s.billId : null },
        // The customer's bills page is a real page: Esc from a bill opened there must come back to it (owner, 2026-11-11).
        panels: { view: inBills ? 'bills' : 'list' }
      }
      const selId = inBills ? s.billsOf!.id : s.selectedId
      const hint = orderHint(ids, selId)
      if (selId) snap.selection = { kind: 'party', id: selId, ...(hint !== undefined ? { orderHint: hint } : {}) }
      return snap
    },
    async apply(mem: PageMemory): Promise<void> {
      await waitFor(useCustomersStore, (s) => s.status === 'ready' || s.status === 'error')
      const s = useCustomersStore.getState()
      if (typeof mem.filters.query === 'string' && mem.filters.query !== s.query) s.setQuery(mem.filters.query)
      const st = useCustomersStore.getState()
      let found = false
      if (mem.selection?.kind === 'party') {
        const r = restoreSelection(st.rows.map((x) => x.id), mem.selection)
        found = r.found
        if (r.id !== null && r.id !== st.selectedId) st.select(r.id)
      }
      // Back on the customer's bills page, but only when that very customer still exists (never open another customer's bills).
      if (mem.panels.view === 'bills' && found && useCustomersStore.getState().view !== 'bills') {
        if (await useCustomersStore.getState().openBills()) {
          await waitFor(useCustomersStore, (x) => x.billsStatus === 'ready' || x.billsStatus === 'error')
          const c = useCustomersStore.getState()
          const bid = mem.filters.billId
          if (typeof bid === 'string') {
            const r = restoreSelection(c.bills.map((b) => b.id), { kind: 'bill', id: bid })
            if (r.id !== null) c.selectBill(r.id)
          }
          applyScroll(root, CUST_BILL_REGIONS, mem.scroll)
          return
        }
      }
      applyScroll(root, CUST_REGIONS, mem.scroll)
    }
  }
}

// ---------------------------------------------------------------- Items
const ITEMS_REGIONS: Record<string, Region> = { w1: { sel: '.q3-items__content', nth: 0 }, w2: { sel: '.q3-items__content', nth: 1 }, w3: { sel: '.q3-items__content', nth: 2 } }

export function itemsAdapter(root: Root): PageAdapter {
  return {
    capture(): PageSnapshot {
      const s = useItemsStore.getState()
      const sale = s.sales ? (tabOf(s.sales, s.salesTab).rows[s.salesCursor] ?? null) : null
      const snap: PageSnapshot = {
        scroll: readScroll(root(), ITEMS_REGIONS),
        filters: { query: s.query, salesTab: s.salesTab, saleBillId: sale ? sale.billId : null },
        panels: { window: s.window }
      }
      if (s.selectedGroupId) snap.selection = { kind: 'itemGroup', id: s.selectedGroupId }
      return snap
    },
    async apply(mem: PageMemory): Promise<void> {
      await waitFor(useItemsStore, (s) => s.status === 'ready' || s.status === 'error')
      const s = useItemsStore.getState()
      if (typeof mem.filters.query === 'string' && mem.filters.query !== s.query) s.setQuery(mem.filters.query)
      if (mem.panels.window === 'groups' || mem.panels.window === 'spellings' || mem.panels.window === 'sales') s.setWindow(mem.panels.window)
      const groups = useItemsStore.getState().overview?.groups ?? []
      if (mem.selection?.kind === 'itemGroup' && groups.some((g) => g.id === mem.selection!.id)) {
        useItemsStore.getState().selectGroup(mem.selection.id)
        await waitFor(useItemsStore, (x) => x.sales !== null && x.sales.groupId === mem.selection!.id)
        const st = useItemsStore.getState()
        const bill = mem.filters.saleBillId
        if (st.sales && typeof bill === 'string') {
          const tab = (mem.filters.salesTab as typeof st.salesTab) ?? st.salesTab
          if (tab !== st.salesTab) st.setSalesTab(tab)
          const rows = tabOf(st.sales, tab).rows
          const i = rows.findIndex((r) => r.billId === bill)
          if (i >= 0) useItemsStore.getState().setSalesCursor(i)
        }
      }
      applyScroll(root, ITEMS_REGIONS, mem.scroll)
    }
  }
}

// ---------------------------------------------------------------- Settings
export function settingsAdapter(): PageAdapter {
  return {
    capture: (): PageSnapshot => ({ scroll: {}, filters: {}, panels: { section: useSettingsStore.getState().section } }),
    apply(mem: PageMemory): void {
      const id = mem.panels.section
      if (typeof id === 'string' && SETTINGS_SECTIONS.some((s) => s.id === id) && id !== useSettingsStore.getState().section) useSettingsStore.getState().setSection(id as SettingsSection)
    }
  }
}

// ---------------------------------------------------------------- Price List (Phase 238)
const PL_REGIONS: Record<string, Region> = { grid: { sel: '.q3-plgrid' } }

export function priceListAdapter(root: Root): PageAdapter {
  return {
    capture(): PageSnapshot {
      const s = usePriceListStore.getState()
      return {
        scroll: readScroll(root(), PL_REGIONS),
        // Phase 252: the "Filter this tab" box is gone, so its text is no longer remembered (an old saved value must never hide rows).
        filters: { noPrice: s.filter.noPrice },
        panels: { categoryId: s.categoryId ?? '', tabId: s.tabId ?? '', panel: s.panelOpen }
      }
    },
    async apply(mem: PageMemory): Promise<void> {
      await waitFor(usePriceListStore, (s) => s.status === 'ready' || s.status === 'error')
      const s = usePriceListStore.getState()
      const tab = typeof mem.panels.tabId === 'string' ? s.tree?.tabs.find((t) => t.id === mem.panels.tabId) : undefined
      if (tab && tab.id !== s.tabId) {
        await s.selectTab(tab.id)
        await waitFor(usePriceListStore, (x) => x.tabId === tab.id && !x.rowsLoading)
      }
      const st = usePriceListStore.getState()
      if (typeof mem.panels.panel === 'boolean' && mem.panels.panel !== st.panelOpen) st.togglePanel()
      const noPrice = typeof mem.filters.noPrice === 'boolean' ? mem.filters.noPrice : st.filter.noPrice
      if (st.filter.contains !== '' || noPrice !== st.filter.noPrice) st.setFilter({ contains: '', noPrice }) // an old remembered `contains` is dropped
      applyScroll(root, PL_REGIONS, mem.scroll)
    }
  }
}
