/**
 * Phase 219 (M21-1): the in-memory page memory. UI state only (IDs, scroll, the owner's own filter text): never synced, backed up or
 * stored in the schema. The pure rules (save / sanitize / nearest-neighbour) live in `@shared/nav/pageMemory`.
 * Phase 92 rule: selectors return a stored object or a primitive, never a fresh array or object.
 */
import { create } from 'zustand'
import { canRemember, emptyMemoryMap, getMemory, saveMemory, type MemoryMap, type PageMemory } from '@shared/nav/pageMemory'
import type { BillContext } from '@shared/nav/billStepping'

/** What a page reports when it is left (or scrolled / selected): everything except the path and the time. */
export type PageSnapshot = Pick<PageMemory, 'scroll' | 'filters' | 'panels'> & Pick<Partial<PageMemory>, 'selection'>

export interface PageAdapter {
  /** Read the page's current scroll / selection / filters / panels (cheap, no IO). */
  capture: () => PageSnapshot
  /** Put a remembered state back. May wait for the page's data; must never throw. */
  apply: (mem: PageMemory) => void | Promise<void>
}

interface PageMemoryState {
  map: MemoryMap
  /** The list the open bill came from (design 5.1); null for a bill opened without a list. IDs only. */
  billContext: BillContext | null
  save: (path: string, snap: PageSnapshot, partyId?: string) => void
  setBillContext: (ctx: BillContext | null) => void
  clear: () => void
}

export const usePageMemoryStore = create<PageMemoryState>((set, get) => ({
  map: emptyMemoryMap(),
  billContext: null,
  save: (path, snap, partyId) => {
    if (!canRemember(path)) return
    const now = Date.now()
    const mem: PageMemory = { path, savedAt: now, scroll: snap.scroll, filters: snap.filters, panels: snap.panels, ...(snap.selection ? { selection: snap.selection } : {}), ...(partyId ? { partyId } : {}) }
    const next = saveMemory(get().map, mem, now)
    if (next !== get().map) set({ map: next })
  },
  setBillContext: (billContext) => set({ billContext }),
  clear: () => set({ map: emptyMemoryMap(), billContext: null })
}))

export const recallPage = (path: string, partyId?: string): PageMemory | undefined => getMemory(usePageMemoryStore.getState().map, path, partyId)

// ---- adapter registry (module level: pages register on mount, the router asks on leave) ----
const adapters = new Map<string, PageAdapter>()
let timers = new Map<string, ReturnType<typeof setTimeout>>()
export const SAVE_DEBOUNCE_MS = 300

export function registerPageAdapter(path: string, a: PageAdapter): () => void {
  adapters.set(path, a)
  return () => { if (adapters.get(path) === a) adapters.delete(path) }
}

/** Save the page now (route change, Esc, opening a bill). A page that is not mounted or stores nothing is a no-op. */
export function savePageNow(path: string): void {
  const t = timers.get(path)
  if (t !== undefined) { clearTimeout(t); timers.delete(path) }
  const a = adapters.get(path)
  if (!a || !canRemember(path)) return
  try { usePageMemoryStore.getState().save(path, a.capture()) } catch { /* UI state only: never block navigation */ }
}

/** Phase 220 (M21-3): remember where a page was left for ONE party (History shows one party's bills at a time), keyed path + party ID. */
export function savePartyPageNow(path: string, partyId: string): void {
  const a = adapters.get(path)
  if (!a || !canRemember(path) || partyId === '') return
  try { usePageMemoryStore.getState().save(path, a.capture(), partyId) } catch { /* UI state only */ }
}

/** Phase 220: put a party's remembered position back (after its list has loaded). No record = nothing to do; never throws. */
export async function restorePartyPage(path: string, partyId: string): Promise<void> {
  const a = adapters.get(path)
  const mem = recallPage(path, partyId)
  if (!a || !mem) return
  try { await a.apply(mem) } catch { /* UI state only */ }
}

/** Drop a pending debounced save (page unmounted: the router already saved on leave). */
export function cancelPageSave(path: string): void {
  const t = timers.get(path)
  if (t !== undefined) { clearTimeout(t); timers.delete(path) }
}

/** Short debounce while scrolling / selecting, so a crash loses little. */
export function schedulePageSave(path: string): void {
  if (!canRemember(path) || timers.has(path)) return
  timers.set(path, setTimeout(() => { timers.delete(path); savePageNow(path) }, SAVE_DEBOUNCE_MS))
}

/**
 * Esc from a bill opened from History: the list returns with the bill the owner is CURRENTLY viewing selected (after stepping it can
 * differ from the one he opened). Only changes an existing History record's selection; never creates content.
 */
export function selectViewedBill(sourcePath: string, billId: string, orderedIds: readonly string[]): void {
  const mem = getMemory(usePageMemoryStore.getState().map, sourcePath)
  if (!mem || mem.selection?.kind !== 'bill') return
  const i = orderedIds.indexOf(billId)
  usePageMemoryStore.getState().save(sourcePath, { scroll: mem.scroll, filters: mem.filters, panels: mem.panels, selection: { kind: 'bill', id: billId, ...(i >= 0 ? { orderHint: i } : {}) } })
}

/** Test helper. */
export function resetPageMemoryForTests(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers = new Map()
  adapters.clear()
  usePageMemoryStore.getState().clear()
}
