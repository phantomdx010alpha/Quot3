/**
 * Phase 239 (M23) - Price List search and duplicate warning (pure; no AI, no DOM, no Node).
 * Global search is literal and case-insensitive: every typed word must appear somewhere in the row (name or any cell).
 * The duplicate warning uses the SAME safe matcher key as billing (shared/items/normalise: protected tokens), so "BALL 1/2" never matches "BALL 3/4".
 */
import { normaliseItem } from '../items/normalise'
import { plain } from '../richtext/runs'
import type { PriceRow } from './types'

export interface SearchTab { id: string; categoryId: string; name: string }
export interface SearchHit { tabId: string; categoryId: string; tabName: string; rowId: string; rowIndex: number; name: string; detail: string }
export const SEARCH_LIMIT = 100
const MIN_QUERY = 2

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter((w) => w !== '')

/** Search the rows of ONE tab. `rowIndex` is the row's position in `rows` (the tab's full order, not a filtered view). */
export function searchTabRows(tab: SearchTab, rows: readonly PriceRow[], query: string, limit = SEARCH_LIMIT): SearchHit[] {
  const w = words(query)
  if (w.length === 0 || query.trim().length < MIN_QUERY) return []
  const out: SearchHit[] = []
  for (let i = 0; i < rows.length && out.length < limit; i++) {
    const r = rows[i]!
    const name = plain(r.nameRuns)
    if (name === '' && r.kind === 'item' && Object.keys(r.cells).length === 0) continue
    const cells = Object.values(r.cells).filter((v) => v !== '')
    const hay = [name, ...cells].join(' ').toLowerCase()
    if (!w.every((t) => hay.includes(t))) continue
    out.push({ tabId: tab.id, categoryId: tab.categoryId, tabName: tab.name, rowId: r.id, rowIndex: i, name, detail: cells.join(' | ') })
  }
  return out
}

/** Merge hits from several tabs: name matches first, then the rest, each group keeps tab / row order. Capped. */
export function rankHits(hits: readonly SearchHit[], query: string, limit = SEARCH_LIMIT): SearchHit[] {
  const w = words(query)
  const inName = (h: SearchHit): boolean => w.every((t) => h.name.toLowerCase().includes(t))
  const a = hits.filter(inName)
  const b = hits.filter((h) => !inName(h))
  return [...a, ...b].slice(0, limit)
}

export interface DuplicateHit { rowId: string; name: string }
/** Other ITEM rows of the tab whose name means the same item as `name` (same normalised key AND same protected tokens). Empty for a blank or non-product name. */
export function findDuplicates(rows: readonly PriceRow[], name: string, excludeRowId = '', limit = 3): DuplicateHit[] {
  const q = normaliseItem(name)
  if (q.empty || q.nonProduct || q.key === '') return []
  const out: DuplicateHit[] = []
  for (const r of rows) {
    if (r.kind !== 'item' || r.id === excludeRowId) continue
    const text = plain(r.nameRuns)
    if (text === '') continue
    const n = normaliseItem(text)
    if (n.key === q.key) { out.push({ rowId: r.id, name: text }); if (out.length >= limit) break }
  }
  return out
}
