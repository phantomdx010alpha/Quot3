/** Phase 235 (M23) - categories and tabs: unique names, reorder, move, duplicate (pure). Two levels only [A]: category -> tab. */
import { sliceGraphemes } from '../columnWidths'
import { copyColumns } from './columns'
import { PRICELIST_LIMITS, type PriceCategory, type PriceColumn, type PriceRow, type PriceTab } from './types'

export function sanitizeName(raw: unknown): string {
  return typeof raw === 'string' ? sliceGraphemes(raw.replace(/\s+/g, ' ').trim(), PRICELIST_LIMITS.nameMax).trim() : ''
}
/** Case / space-insensitive comparison key (the unique active (category, name) rule). */
export const nameKeyOf = (raw: string): string => raw.replace(/\s+/g, ' ').trim().toLowerCase()

/** `name`, or `name (2)`, `name (3)` ... not colliding (case / space-insensitive) with `taken`. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = sanitizeName(name) || 'New'
  const set = new Set(taken.map(nameKeyOf))
  if (!set.has(nameKeyOf(base))) return base
  for (let n = 2; ; n++) {
    const cand = `${sliceGraphemes(base, PRICELIST_LIMITS.nameMax - String(n).length - 3).trim()} (${n})`
    if (!set.has(nameKeyOf(cand))) return cand
  }
}

interface Positioned { position: number }
const renumber = <T extends Positioned>(list: T[]): T[] => list.map((x, i) => (x.position === i ? x : { ...x, position: i }))
const sorted = <T extends Positioned>(list: readonly T[]): T[] => [...list].sort((a, b) => a.position - b.position)

/** Move item `id` to `toIndex` (clamped) in position order; returns the full renumbered list (same identity for unmoved ids whose position is unchanged). */
export function reorderById<T extends Positioned & { id: string }>(list: readonly T[], id: string, toIndex: number): T[] {
  const l = sorted(list)
  const from = l.findIndex((x) => x.id === id)
  if (from < 0) return renumber(l)
  const [it] = l.splice(from, 1)
  l.splice(Math.max(0, Math.min(l.length, toIndex)), 0, it!)
  return renumber(l)
}

export type NameResult<T> = { ok: true; value: T } | { ok: false; reason: 'empty' | 'duplicate' | 'missing' }

export function addCategory(cats: readonly PriceCategory[], rawName: string, id: string, color: string | null = null): NameResult<PriceCategory[]> {
  const name = sanitizeName(rawName)
  if (name === '') return { ok: false, reason: 'empty' }
  if (cats.some((c) => nameKeyOf(c.name) === nameKeyOf(name))) return { ok: false, reason: 'duplicate' }
  return { ok: true, value: [...sorted(cats), { id, name, color, position: cats.length }] }
}

export function renameCategory(cats: readonly PriceCategory[], id: string, rawName: string): NameResult<PriceCategory[]> {
  const name = sanitizeName(rawName)
  if (!cats.some((c) => c.id === id)) return { ok: false, reason: 'missing' }
  if (name === '') return { ok: false, reason: 'empty' }
  if (cats.some((c) => c.id !== id && nameKeyOf(c.name) === nameKeyOf(name))) return { ok: false, reason: 'duplicate' }
  return { ok: true, value: cats.map((c) => (c.id === id ? { ...c, name } : c)) }
}

export function addTab(tabs: readonly PriceTab[], categoryId: string, rawName: string, id: string, columns: readonly PriceColumn[]): NameResult<PriceTab[]> {
  const name = sanitizeName(rawName)
  if (name === '') return { ok: false, reason: 'empty' }
  const sibs = tabs.filter((t) => t.categoryId === categoryId)
  if (sibs.some((t) => nameKeyOf(t.name) === nameKeyOf(name))) return { ok: false, reason: 'duplicate' }
  return { ok: true, value: [...tabs, { id, categoryId, name, position: sibs.length, columns: copyColumns(columns) }] }
}

export function renameTab(tabs: readonly PriceTab[], id: string, rawName: string): NameResult<PriceTab[]> {
  const cur = tabs.find((t) => t.id === id)
  const name = sanitizeName(rawName)
  if (!cur) return { ok: false, reason: 'missing' }
  if (name === '') return { ok: false, reason: 'empty' }
  if (tabs.some((t) => t.id !== id && t.categoryId === cur.categoryId && nameKeyOf(t.name) === nameKeyOf(name))) return { ok: false, reason: 'duplicate' }
  return { ok: true, value: tabs.map((t) => (t.id === id ? { ...t, name } : t)) }
}

/** Reorder a tab inside its category; other categories' tabs are untouched. */
export function reorderTab(tabs: readonly PriceTab[], id: string, toIndex: number): PriceTab[] {
  const cur = tabs.find((t) => t.id === id)
  if (!cur) return [...tabs]
  const moved = new Map(reorderById(tabs.filter((t) => t.categoryId === cur.categoryId), id, toIndex).map((t) => [t.id, t]))
  return tabs.map((t) => moved.get(t.id) ?? t)
}

/** Move a tab to another category (end of it); a clashing name gets " (2)". The source category is renumbered. */
export function moveTabToCategory(tabs: readonly PriceTab[], id: string, categoryId: string): PriceTab[] {
  const cur = tabs.find((t) => t.id === id)
  if (!cur || cur.categoryId === categoryId) return [...tabs]
  const dest = tabs.filter((t) => t.categoryId === categoryId)
  const name = uniqueName(cur.name, dest.map((t) => t.name))
  const out = tabs.map((t) => (t.id === id ? { ...t, categoryId, name, position: dest.length } : t))
  return renumberCategory(out, cur.categoryId)
}

function renumberCategory(tabs: PriceTab[], categoryId: string): PriceTab[] {
  const re = new Map(renumber(sorted(tabs.filter((t) => t.categoryId === categoryId))).map((t) => [t.id, t]))
  return tabs.map((t) => re.get(t.id) ?? t)
}

/**
 * Duplicate a tab with its rows. The caller supplies fresh ids (UUIDs) so this stays pure. The copy sits right after the original,
 * is named "<name> (2)" (unique among siblings) and keeps the column set and every cell.
 */
export function duplicateTab(
  tabs: readonly PriceTab[], rows: readonly PriceRow[], tabId: string, newTabId: string, newRowId: () => string
): { tabs: PriceTab[]; rows: PriceRow[]; tab: PriceTab } | null {
  const src = tabs.find((t) => t.id === tabId)
  if (!src) return null
  const copy: PriceTab = { ...src, id: newTabId, name: uniqueName(src.name, tabs.filter((t) => t.categoryId === src.categoryId).map((t) => t.name)), position: src.position + 1, columns: copyColumns(src.columns) }
  const sibs = sorted(tabs.filter((t) => t.categoryId === src.categoryId))
  const at = sibs.findIndex((t) => t.id === tabId) + 1
  sibs.splice(at, 0, copy)
  const re = new Map(renumber(sibs).map((t) => [t.id, t]))
  const newRows = rows.filter((r) => r.tabId === tabId).map((r) => ({ ...r, id: newRowId(), tabId: newTabId, nameRuns: r.nameRuns.map((x) => ({ ...x })), cells: { ...r.cells } }))
  return { tabs: [...tabs.map((t) => re.get(t.id) ?? t), re.get(newTabId)!], rows: newRows, tab: re.get(newTabId)! }
}
