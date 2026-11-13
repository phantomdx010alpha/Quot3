import type { Quot3Bridge } from '@shared/ipc'
import type { PriceColumn, PriceRow } from '@shared/pricelist/types'
import type { SaveRowInput } from '@shared/pricelist/api'
import { adjustAmount, adjustPercent, applyChanges, applyNameChanges, cleanNames, findReplaceCells, findReplaceNames, fillFromColumn, type BulkPreview, type CellChange, type NameChange, type Rounding } from '@shared/pricelist/bulk'
import { toCsv } from '@shared/pricelist/csv'
import { rankHits, searchTabRows, type SearchHit } from '@shared/pricelist/search'
import { usePriceListStore } from './priceListStore'

/**
 * Phase 239 (M23) - Price List power tools glue (renderer). Pure maths lives in `shared/pricelist/{bulk,csv,search}.ts`; this file only
 * picks the rows in scope, shows nothing by itself, and writes through the store's ONE edit path so every change is one undo step.
 * Category-wide changes touch other tabs, which the open tab's undo history cannot hold: they get their own one-step undo here.
 */
type Bridge = Pick<Quot3Bridge, 'pricelist'>
const api = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3

export type BulkMode = 'percent' | 'amount' | 'fill'
export type BulkScopeKind = 'tab' | 'selection' | 'category'
export interface BulkSpec { mode: BulkMode; scope: BulkScopeKind; columnKey: string; fromKey?: string; value: string; rounding: Rounding; overwrite?: boolean }

const isNum = (v: string): boolean => /^[+-]?\d+(\.\d+)?$/.test(v.trim())
export const bulkValueOk = (v: string): boolean => isNum(v.trim())

function run(spec: BulkSpec, rows: readonly PriceRow[], columnKey: string, fromKey: string | undefined, rowIds?: ReadonlySet<string>): BulkPreview {
  const scope = rowIds ? { rowIds } : {}
  const v = spec.value.trim().replace(/^\+/, '')
  if (spec.mode === 'percent') return adjustPercent(rows, columnKey, v, scope, spec.rounding)
  if (spec.mode === 'amount') return adjustAmount(rows, columnKey, v, scope, spec.rounding)
  return fillFromColumn(rows, fromKey ?? '', columnKey, v, { ...scope, overwrite: !!spec.overwrite, rounding: spec.rounding })
}

/** Rows of the OPEN tab in scope (selection = the grid's selected rows; tab / category = every item row). */
function selectedRowIds(): ReadonlySet<string> {
  const s = usePriceListStore.getState()
  const vis = s.visibleRows()
  const b = s.nav.range ? { top: Math.min(s.nav.range.anchor.row, s.nav.range.focus.row), bottom: Math.max(s.nav.range.anchor.row, s.nav.range.focus.row) } : { top: s.nav.row, bottom: s.nav.row }
  const ids = new Set<string>()
  for (let i = b.top; i <= b.bottom; i++) { const r = vis[i]; if (r) ids.add(r.id) }
  return ids
}

/** The preview for the open tab (scope tab / selection). Category scope is previewed as counts per tab by `previewCategory`. */
export function previewBulk(spec: BulkSpec): BulkPreview {
  const s = usePriceListStore.getState()
  return run(spec, s.rows, spec.columnKey, spec.fromKey, spec.scope === 'selection' ? selectedRowIds() : undefined)
}

export function applyBulk(spec: BulkSpec): number {
  const s = usePriceListStore.getState()
  const p = previewBulk(spec)
  if (p.changes.length === 0) return 0
  s.applyRows(spec.mode === 'fill' ? 'Fill column' : 'Bulk adjust', applyChanges(s.rows, p.changes))
  return p.changes.length
}

interface CatTab { tabId: string; name: string; columnKey: string; fromKey?: string; rows: PriceRow[]; changes: CellChange[]; skipped: number }
let lastCategory: { tabId: string; before: PriceRow[] }[] | null = null
export const canUndoCategory = (): boolean => lastCategory !== null

/** A price column of another tab that means the same thing: same price level when the source column has one, else the same key. */
function sameColumn(cols: readonly PriceColumn[], like: PriceColumn | undefined, key: string): PriceColumn | undefined {
  if (like?.role === 'price' && like.tier) return cols.find((c) => c.role === 'price' && c.tier === like.tier)
  return cols.find((c) => c.key === key)
}

async function categoryPlan(spec: BulkSpec): Promise<CatTab[]> {
  const s = usePriceListStore.getState()
  await s.flush()
  const cur = s.tree?.tabs.find((t) => t.id === s.tabId)
  const like = cur?.columns.find((c) => c.key === spec.columnKey)
  const fromLike = cur?.columns.find((c) => c.key === spec.fromKey)
  const out: CatTab[] = []
  for (const tab of (s.tree?.tabs ?? []).filter((t) => t.categoryId === s.categoryId)) {
    const col = sameColumn(tab.columns, like, spec.columnKey)
    if (!col) continue
    const from = spec.mode === 'fill' ? sameColumn(tab.columns, fromLike, spec.fromKey ?? '') : undefined
    if (spec.mode === 'fill' && !from) continue
    const r = await api()?.pricelist?.rows(tab.id)
    if (!r || !r.ok) continue
    const p = run(spec, r.data, col.key, from?.key)
    out.push({ tabId: tab.id, name: tab.name, columnKey: col.key, ...(from ? { fromKey: from.key } : {}), rows: r.data, changes: p.changes, skipped: p.skipped })
  }
  return out
}

export async function previewCategory(spec: BulkSpec): Promise<{ tab: string; changes: number }[]> {
  return (await categoryPlan(spec)).map((t) => ({ tab: t.name, changes: t.changes.length }))
}

/** Apply to every tab of the category. The open tab goes through the grid (Ctrl+Z); other tabs are saved directly and `undoCategory` reverts them. */
export async function applyCategory(spec: BulkSpec): Promise<number> {
  const s = usePriceListStore.getState()
  const plan = (await categoryPlan(spec)).filter((t) => t.changes.length > 0)
  const saved: { tabId: string; before: PriceRow[] }[] = []
  let total = 0
  for (const t of plan) {
    total += t.changes.length
    if (t.tabId === s.tabId) { s.applyRows('Bulk adjust', applyChanges(s.rows, t.changes)); continue }
    const next = applyChanges(t.rows, t.changes)
    const send: SaveRowInput[] = next.filter((r, i) => r !== t.rows[i]).map((r) => ({ id: r.id, idx: r.idx, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells }))
    const res = await api()?.pricelist?.saveRows({ tabId: t.tabId, rows: send })
    if (res?.ok) saved.push({ tabId: t.tabId, before: t.rows })
  }
  lastCategory = saved.length > 0 ? saved : null
  return total
}

export async function undoCategory(): Promise<boolean> {
  const l = lastCategory
  if (!l) return false
  lastCategory = null
  for (const t of l) {
    const send: SaveRowInput[] = t.before.map((r) => ({ id: r.id, idx: r.idx, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells }))
    await api()?.pricelist?.saveRows({ tabId: t.tabId, rows: send })
  }
  return true
}

/** Find & replace over names and the text cells of the open tab (literal). Returns what WOULD change; `applyFind` writes it as one undo step. */
export interface FindSpec { find: string; replace: string; caseSensitive: boolean; names: boolean; cells: boolean }
export function previewFind(spec: FindSpec): { names: NameChange[]; cells: CellChange[] } {
  const s = usePriceListStore.getState()
  const cols = s.tree?.tabs.find((t) => t.id === s.tabId)?.columns ?? []
  return {
    names: spec.names ? findReplaceNames(s.rows, spec.find, spec.replace, spec.caseSensitive) : [],
    cells: spec.cells ? findReplaceCells(s.rows, cols, spec.find, spec.replace, { caseSensitive: spec.caseSensitive }) : []
  }
}
export function applyFind(spec: FindSpec): number {
  const s = usePriceListStore.getState()
  const p = previewFind(spec)
  const n = p.names.length + p.cells.length
  if (n === 0) return 0
  s.applyRows('Find and replace', applyNameChanges(applyChanges(s.rows, p.cells), p.names))
  return n
}

export const previewClean = (): NameChange[] => cleanNames(usePriceListStore.getState().rows)
export function applyClean(): number {
  const s = usePriceListStore.getState()
  const ch = cleanNames(s.rows)
  if (ch.length === 0) return 0
  s.applyRows('Clean up names', applyNameChanges(s.rows, ch))
  return ch.length
}

/** Search every tab (saves first so the search sees what the owner just typed). Rows are fetched tab by tab; a stale answer is dropped by the caller. */
export async function searchAll(query: string): Promise<SearchHit[]> {
  const s = usePriceListStore.getState()
  if (query.trim().length < 2) return []
  await s.flush()
  const hits: SearchHit[] = []
  for (const tab of s.tree?.tabs ?? []) {
    let rows: readonly PriceRow[] | undefined
    if (tab.id === s.tabId) rows = usePriceListStore.getState().rows
    else { const r = await api()?.pricelist?.rows(tab.id); if (r?.ok) rows = r.data }
    if (!rows) continue
    hits.push(...searchTabRows(tab, rows, query))
  }
  return rankHits(hits, query)
}

/** Jump to a search hit: switch category / tab when needed, then put the cursor on the row. */
export async function jumpToHit(h: SearchHit): Promise<void> {
  const s = usePriceListStore.getState()
  if (s.tabId !== h.tabId) await s.selectTab(h.tabId)
  usePriceListStore.getState().jumpToRow(h.rowId)
}

/** CSV of the open tab, as the owner sees the columns. Saved through the browser download path (no file system access from the renderer). */
export function exportCsv(): boolean {
  const s = usePriceListStore.getState()
  const tab = s.tree?.tabs.find((t) => t.id === s.tabId)
  if (!tab) return false
  s.commit()
  const csv = toCsv(tab.columns, s.rows.filter((r) => !(r.id.startsWith('tmp-') && r.nameRuns.length === 0 && Object.keys(r.cells).length === 0)), { bom: true })
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${tab.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'price-list'}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
