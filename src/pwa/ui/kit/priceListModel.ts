/** Phase 245 (M23) - the phone Price List READ MODEL (pure: no DOM, no IndexedDB, no Electron, no Node). Read only: nothing here writes a record.
 *
 *  It turns the stored sync records (`data/priceListRepo.ts`, shared record shapes) into the SHARED Price List types and grid model
 *  (`shared/pricelist/*`: `sanitizeColumns`, `sanitizeRow`, `gridColumns`, `searchTabRows`, `rankHits`, `rightsNotice`), so the phone shows exactly what
 *  the desktop grid shows for the same data. Everything in a record is DATA: a category `color` or any other field is never used as a style or code.
 *
 *  Search is the shared deterministic search (every typed word must appear in the row; `shared/pricelist/search.ts`). It is NOT AI: the phone has no AI. */
import { gridColumns, cellText, type GridCol } from '../../../shared/pricelist/gridModel'
import { sanitizeColumns } from '../../../shared/pricelist/columns'
import { ALL_RIGHTS, normalizeFlags, rightsNotice, type PermFlags } from '../../../shared/pricelist/perms'
import { sanitizeRow } from '../../../shared/pricelist/rows'
import { rankHits, searchTabRows, SEARCH_LIMIT, type SearchHit } from '../../../shared/pricelist/search'
import { tierLabel } from '../../../shared/pricelist/tiers'
import type { PriceCategory, PriceColumn, PriceRow, PriceTab, PriceTier } from '../../../shared/pricelist/types'
import type { PriceCategoryRec, PriceRowRec, PriceTabRec, PriceTierRec } from '../../../shared/sync/priceListRecords'
import type { Run, Runs } from '../../../shared/types'
import { plain } from '../../../shared/richtext/runs'
import { plainNumber } from './display'
import type { SyncLine } from '../dashboardModel'

// ---- records -> shared types -------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Stored runs (the wire only checks "an array") -> valid runs; anything that is not a text run is dropped, never thrown on. */
export function coerceRuns(raw: unknown): Runs {
  if (!Array.isArray(raw)) return []
  const out: Run[] = []
  for (const r of raw) {
    if (!isObj(r) || typeof r.t !== 'string' || r.t === '') continue
    const run: Run = { t: r.t }
    if (r.b === 1 || r.b === true) run.b = 1
    if (r.r === 1 || r.r === true) run.r = 1
    if (r.hl === 1 || r.hl === true) run.hl = 1
    out.push(run)
  }
  return out
}

export const toTier = (r: PriceTierRec): PriceTier => ({ id: r.id, key: r.key, label: r.label, position: r.position })
export const toCategory = (r: PriceCategoryRec): PriceCategory => ({ id: r.id, name: r.name, color: null, position: r.position })
export const toTab = (r: PriceTabRec): PriceTab => ({ id: r.id, categoryId: r.categoryId, name: r.name, position: r.position, columns: sanitizeColumns(r.columns) })
export function toRow(r: PriceRowRec, columns: readonly PriceColumn[]): PriceRow {
  const cells: Record<string, string> = {}
  if (isObj(r.cells)) for (const [k, v] of Object.entries(r.cells)) if (typeof v === 'string') cells[k] = v
  return sanitizeRow({ id: r.id, tabId: r.tabId, idx: r.idx, kind: r.kind === 'section' ? 'section' : 'item', nameRuns: coerceRuns(r.nameRuns), cells }, columns)
}

/** Everything the screens read, in the shared types. `rows` is keyed by tab id (every live tab has an entry, maybe empty). */
export interface PriceListData {
  tiers: PriceTier[]
  categories: PriceCategory[]
  tabs: PriceTab[]
  rows: Record<string, PriceRow[]>
  /** True when the phone holds any Price List record at all (live or deleted): tells "not synced yet" from "everything was deleted". */
  anyRecords: boolean
}

export const EMPTY_PRICE_DATA: PriceListData = { tiers: [], categories: [], tabs: [], rows: {}, anyRecords: false }

export function buildPriceData(input: { tiers: readonly PriceTierRec[]; categories: readonly PriceCategoryRec[]; tabs: readonly PriceTabRec[]; rows: Readonly<Record<string, readonly PriceRowRec[]>>; anyRecords: boolean }): PriceListData {
  const tabs = input.tabs.map(toTab)
  const rows: Record<string, PriceRow[]> = {}
  for (const t of tabs) rows[t.id] = (input.rows[t.id] ?? []).map((r) => toRow(r, t.columns))
  return { tiers: input.tiers.map(toTier), categories: input.categories.map(toCategory), tabs, rows, anyRecords: input.anyRecords }
}

export const tabsOf = (data: PriceListData, categoryId: string): PriceTab[] => data.tabs.filter((t) => t.categoryId === categoryId)
export const rowCount = (data: PriceListData, tabId: string): number => (data.rows[tabId] ?? []).filter((r) => r.kind === 'item').length

// ---- the view of one tab ---------------------------------------------------------------------------------------------------

/** What an empty price cell shows (a dash, never a blank that could be read as "0"). */
export const EMPTY_CELL = '\u2014'

export interface ViewCell {
  key: string
  label: string
  /** The tier a price column asks for, in words ('' when the column is not a price column or has no tier). Shown only when it adds something to the label. */
  tier: string
  text: string
  numeric: boolean
  align: GridCol['align']
}
export interface ViewRow {
  id: string
  kind: 'item' | 'section'
  runs: Runs
  name: string
  cells: ViewCell[]
  /** An item with no price in any price column (the desktop shows the same quiet cue). */
  noPrice: boolean
}
export interface TabView { tabId: string; name: string; columns: TabCol[]; rows: ViewRow[] }

/** Display text of one cell: numbers get Indian grouping (fraction exactly as stored, nothing added); text is always shown whole (M18 rule). */
export function cellDisplay(row: PriceRow, col: GridCol): string {
  const t = cellText(row, col).trim()
  if (t === '') return ''
  return col.numeric ? plainNumber(t) : t
}

/** A grid column plus the tier key its tab column points at ('' when none). */
export type TabCol = GridCol & { tierKey?: string }

export function viewRow(row: PriceRow, columns: readonly TabCol[], tiers: readonly PriceTier[]): ViewRow {
  const cols = columns.filter((c) => !c.isName)
  const cells: ViewCell[] =
    row.kind === 'section'
      ? []
      : cols.map((c) => {
          const raw = row.cells[c.key] ?? ''
          const tier = c.role === 'price' ? tierWords(c, tiers) : ''
          return { key: c.key, label: c.label, tier, text: raw.trim() === '' ? '' : cellDisplay(row, c), numeric: c.numeric, align: c.align }
        })
  const priceCols = cols.filter((c) => c.role === 'price')
  const noPrice = row.kind === 'item' && priceCols.length > 0 && priceCols.every((c) => (row.cells[c.key] ?? '').trim() === '')
  return { id: row.id, kind: row.kind, runs: row.nameRuns, name: plain(row.nameRuns), cells, noPrice }
}

/** The tier a price column points at, as words, only when it is not just the column label again. */
function tierWords(col: TabCol, tiers: readonly PriceTier[]): string {
  const key = col.tierKey
  if (!key) return ''
  const w = tierLabel(tiers, key)
  return w !== '' && w.toLowerCase() !== col.label.toLowerCase() ? w : ''
}

export function tabView(tab: PriceTab, rows: readonly PriceRow[], tiers: readonly PriceTier[]): TabView {
  // gridColumns drops the tier key, so attach it again from the tab's own columns (same order, hidden ones skipped).
  const tierByKey = new Map(tab.columns.map((c) => [c.key, c.tier ?? '']))
  const columns: TabCol[] = gridColumns(tab.columns).map((c) => Object.assign(c, { tierKey: tierByKey.get(c.key) ?? '' }))
  return { tabId: tab.id, name: tab.name, columns, rows: rows.map((r) => viewRow(r, columns, tiers)) }
}

// ---- search ---------------------------------------------------------------------------------------------------------------------

export const SEARCH_MIN = 2
export const SEARCH_HINT = 'Finds items that contain every word you type, in the name or any price. No AI.'
export const searchActive = (query: string): boolean => query.trim().length >= SEARCH_MIN

/** Search every tab. Empty for a query shorter than two letters. Name matches come first (shared ranking). */
export function searchAll(data: PriceListData, query: string, limit = SEARCH_LIMIT): SearchHit[] {
  if (!searchActive(query)) return []
  const hits: SearchHit[] = []
  for (const t of data.tabs) hits.push(...searchTabRows(t, data.rows[t.id] ?? [], query, limit))
  return rankHits(hits, query, limit)
}

export interface ResolvedHit { key: string; path: string; row: ViewRow }

/** A hit with its path (Category > Tab) and the row drawn with the tab's own columns, so a result shows labelled prices, not a raw text line. */
export function resolveHits(data: PriceListData, hits: readonly SearchHit[]): ResolvedHit[] {
  const out: ResolvedHit[] = []
  const catName = new Map(data.categories.map((c) => [c.id, c.name]))
  const tabById = new Map(data.tabs.map((t) => [t.id, t]))
  const views = new Map<string, TabView>()
  for (const h of hits) {
    const tab = tabById.get(h.tabId)
    if (!tab) continue
    let v = views.get(tab.id)
    if (!v) { v = tabView(tab, data.rows[tab.id] ?? [], data.tiers); views.set(tab.id, v) }
    const row = v.rows.find((r) => r.id === h.rowId)
    if (!row) continue
    const cat = catName.get(tab.categoryId) ?? ''
    out.push({ key: `${tab.id}:${row.id}`, path: cat === '' ? tab.name : `${cat} > ${tab.name}`, row })
  }
  return out
}

// ---- rights and words -----------------------------------------------------------------------------------------------------------

export const PHONE_EDIT_LATER = 'Changing the Price List on this phone is not available yet.'

/** The seat's rights as the phone knows them [A]. The phone does not keep its seat number or ask the server for its flags yet (Phase 246 does), so:
 *  no sync = this phone has full rights (shared rule); a linked phone has the flags last stored (`pricelist.seatFlags`) or NONE. Reading is always allowed. */
export function phoneRights(syncActive: boolean, stored: unknown): PermFlags {
  return syncActive ? normalizeFlags(stored) : { ...ALL_RIGHTS }
}

/** The plain-words lines at the top of the Price List: the shared `rightsNotice` ("Read only: ...") plus the Phase 245 line that nothing can be changed yet. */
export function priceNotices(flags: PermFlags, refused = 0): string[] {
  // Phase 246: editing exists, so the Phase 245 "not available yet" line is gone; the shared note names what this seat may not do and the refused count.
  return rightsNotice(flags, refused)
}

export const EMPTY_TITLE = 'Price List not on this phone yet'
export const EMPTY_OFF_TITLE = 'Price List is switched off'
export const EMPTY_LIST_TITLE = 'The Price List is empty'

export interface PriceEmpty { title: string; body: string; syncLine: string }

const joinSync = (s: SyncLine | null): string => (s === null ? '' : s.detail === '' ? s.text : `${s.text} \u00b7 ${s.detail}`)

/** What the phone says when there is nothing to browse. `enabled` false = the master switch is off. */
export function emptyState(input: { enabled: boolean; linked: boolean; anyRecords: boolean; sync: SyncLine | null }): PriceEmpty {
  const syncLine = joinSync(input.sync)
  if (!input.enabled) return { title: EMPTY_OFF_TITLE, body: 'The Price List is turned off in this app.', syncLine: '' }
  if (input.anyRecords) return { title: EMPTY_LIST_TITLE, body: 'Every category was removed. Add items on your computer and they will appear here after the next sync.', syncLine }
  return input.linked
    ? { title: EMPTY_TITLE, body: 'It arrives with the next sync. Make sure the Price List has items on your computer, then check the sync line below.', syncLine }
    : { title: EMPTY_TITLE, body: 'This phone is not signed in to sync. Open Settings and sign in to get the Price List from your computer.', syncLine }
}
