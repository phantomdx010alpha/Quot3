/**
 * Phase 218 (M21-1): the page memory record and its pure rules (design section 3). UI state only: no bill content, no amounts,
 * no party text beyond IDs and the owner's own filter text. In memory; never synced, backed up or stored in the schema.
 * Remember by ID, never by row number; when the remembered item is gone, land on the nearest surviving neighbour.
 */
import { ROUTES } from '../routes'

export type SelectionKind = 'bill' | 'party' | 'itemGroup' | 'date'
export const SELECTION_KINDS: readonly SelectionKind[] = ['bill', 'party', 'itemGroup', 'date']

export interface PageSelection {
  kind: SelectionKind
  id: string
  /** Position in the list at save time. Used ONLY as a fallback hint when `id` is gone; never to find the item. */
  orderHint?: number
}

export type FilterValue = string | number | boolean | null

export interface PageMemory {
  path: string
  /** Set for pages remembered per party (paging pages): one record per party. */
  partyId?: string
  savedAt: number
  /** Region name -> scrollTop (History: dates, bills; Items: three windows). */
  scroll: Record<string, number>
  selection?: PageSelection
  /** Search text, date range, source filter, sort, trash flag of that page: the owner's own filter values. */
  filters: Record<string, FilterValue>
  /** Open panels / sections (revisions panel, sales panel, the Settings section). */
  panels: Record<string, string | boolean>
}

/** Pages that never store memory: Create always opens a clean bill (D-K15); the Dashboard is the root. */
export const NO_MEMORY_PATHS: readonly string[] = [ROUTES.create, ROUTES.dashboard]

/** At most this many per-party records are kept besides the one record per route path; the oldest are dropped. */
export const MAX_PARTY_RECORDS = 200
/** Safety caps for the maps inside one record. */
export const MAX_REGIONS = 8
export const MAX_KEYS = 24
export const MAX_TEXT = 200

export interface MemoryMap {
  records: Record<string, PageMemory>
}

export function emptyMemoryMap(): MemoryMap {
  return { records: {} }
}

export function canRemember(path: string): boolean {
  return !NO_MEMORY_PATHS.includes(path)
}

export function memoryKey(path: string, partyId?: string): string {
  return partyId ? `${path}#${partyId}` : path
}

export function emptyMemory(path: string, partyId?: string, now = 0): PageMemory {
  const m: PageMemory = { path, savedAt: now, scroll: {}, filters: {}, panels: {} }
  if (partyId) m.partyId = partyId
  return m
}

function cleanScroll(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (v === null || typeof v !== 'object') return out
  let n = 0
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_REGIONS) break
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0) {
      out[k.slice(0, 40)] = Math.round(x)
      n++
    }
  }
  return out
}

function cleanMap<T extends FilterValue | boolean>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> {
  const out: Record<string, T> = {}
  if (v === null || typeof v !== 'object') return out
  let n = 0
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_KEYS) break
    if (ok(x)) {
      out[k.slice(0, 40)] = (typeof x === 'string' ? x.slice(0, MAX_TEXT) : x) as T
      n++
    }
  }
  return out
}

const isFilterValue = (x: unknown): x is FilterValue =>
  x === null || typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))
const isPanelValue = (x: unknown): x is string | boolean => typeof x === 'boolean' || typeof x === 'string'

/** Drops unknown fields and bad values. Returns null when the record is unusable (no known path) or the page stores no memory. */
export function sanitize(raw: unknown): PageMemory | null {
  if (raw === null || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || !canRemember(r.path)) return null
  const m: PageMemory = {
    path: r.path,
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    scroll: cleanScroll(r.scroll),
    filters: cleanMap(r.filters, isFilterValue),
    panels: cleanMap(r.panels, isPanelValue)
  }
  if (typeof r.partyId === 'string' && r.partyId !== '') m.partyId = r.partyId
  const s = r.selection
  if (s !== null && typeof s === 'object') {
    const sel = s as Record<string, unknown>
    if (typeof sel.id === 'string' && sel.id !== '' && SELECTION_KINDS.includes(sel.kind as SelectionKind)) {
      const out: PageSelection = { kind: sel.kind as SelectionKind, id: sel.id }
      if (typeof sel.orderHint === 'number' && Number.isInteger(sel.orderHint) && sel.orderHint >= 0) out.orderHint = sel.orderHint
      m.selection = out
    }
  }
  return m
}

/**
 * Returns a NEW map with the record saved (the input is never mutated). Create and the Dashboard store nothing (map returned as is).
 * One record per route path plus one per party for paging pages; past MAX_PARTY_RECORDS the oldest party records are dropped.
 */
export function saveMemory(map: MemoryMap, mem: PageMemory, now: number = mem.savedAt): MemoryMap {
  const clean = sanitize({ ...mem, savedAt: now })
  if (!clean) return map
  const records = { ...map.records, [memoryKey(clean.path, clean.partyId)]: clean }
  const partyKeys = Object.keys(records).filter((k) => records[k]!.partyId)
  if (partyKeys.length > MAX_PARTY_RECORDS) {
    partyKeys.sort((a, b) => records[a]!.savedAt - records[b]!.savedAt || (a < b ? -1 : 1))
    for (const k of partyKeys.slice(0, partyKeys.length - MAX_PARTY_RECORDS)) delete records[k]
  }
  return { records }
}

export function getMemory(map: MemoryMap, path: string, partyId?: string): PageMemory | undefined {
  return canRemember(path) ? map.records[memoryKey(path, partyId)] : undefined
}

export interface RestoredSelection {
  /** The ID to select, or null only when the list is empty. */
  id: string | null
  /** True when the remembered ID itself was found. */
  found: boolean
}

/**
 * Where the selection lands after returning. The remembered ID if it is still in `orderedIds`; otherwise the nearest surviving
 * neighbour (by the saved `orderHint`, clamped); else the first item; null only for an empty list. Never throws.
 */
export function restoreSelection(orderedIds: readonly string[], remembered: PageSelection | undefined | null): RestoredSelection {
  if (orderedIds.length === 0) return { id: null, found: false }
  if (!remembered) return { id: orderedIds[0]!, found: false }
  if (orderedIds.includes(remembered.id)) return { id: remembered.id, found: true }
  const hint = remembered.orderHint
  if (hint === undefined) return { id: orderedIds[0]!, found: false }
  const i = Math.min(Math.max(hint, 0), orderedIds.length - 1)
  return { id: orderedIds[i]!, found: false }
}
