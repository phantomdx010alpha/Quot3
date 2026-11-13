/** Phase 235 (M23) - Price List column management (pure; mirrors shared/extraCols.ts). Columns belong to a TAB; max 12; keys are never reused. */
import { sliceGraphemes } from '../columnWidths'
import { COLUMN_ROLES, COLUMN_TYPES, NAME_COLUMN_KEY, PRICELIST_LIMITS, type ColumnAlign, type PriceColumn } from './types'

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()
const clampW = (n: unknown, dflt: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : dflt
  return Math.max(PRICELIST_LIMITS.widthMin, Math.min(PRICELIST_LIMITS.widthMax, v))
}

export function sanitizeColumnLabel(raw: unknown): string {
  return typeof raw === 'string' ? sliceGraphemes(collapse(raw), PRICELIST_LIMITS.labelMax).trim() : ''
}

export function nameColumn(): PriceColumn {
  return { key: NAME_COLUMN_KEY, label: 'Item', type: 'text', role: 'name', widthPx: 320, align: 'left', hidden: false, frozen: true }
}

export function priceColumn(key: string, label: string, tier: string): PriceColumn {
  return { key, label, type: 'number', role: 'price', tier, widthPx: 90, align: 'right', hidden: false, frozen: false }
}

/** [A] Default column set for a new tab: Item + one price column per seed tier. */
export function defaultColumnSet(tiers: readonly { key: string; label: string }[]): PriceColumn[] {
  return [nameColumn(), ...tiers.slice(0, PRICELIST_LIMITS.maxColumns - 1).map((t, i) => priceColumn(`c${i + 1}`, t.label, t.key))]
}

function sanitizeOne(raw: unknown): PriceColumn | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const key = typeof r.key === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(r.key) ? r.key : ''
  if (key === '') return null
  const role = COLUMN_ROLES.find((x) => x === r.role) ?? 'other'
  const type = role === 'price' ? 'number' : (COLUMN_TYPES.find((x) => x === r.type) ?? 'text')
  const align: ColumnAlign = r.align === 'right' || r.align === 'center' ? r.align : type === 'number' ? 'right' : 'left'
  const label = sanitizeColumnLabel(r.label) || key
  const out: PriceColumn = { key, label, type, role, widthPx: clampW(r.widthPx, 120), align, hidden: r.hidden === true, frozen: r.frozen === true }
  if (role === 'price' && typeof r.tier === 'string' && r.tier !== '') out.tier = r.tier
  if (type === 'choice' && Array.isArray(r.choices)) {
    const seen = new Set<string>()
    out.choices = r.choices
      .filter((c): c is string => typeof c === 'string')
      .map((c) => sliceGraphemes(collapse(c), PRICELIST_LIMITS.choiceMax).trim())
      .filter((c) => c !== '' && !seen.has(c.toLowerCase()) && !!seen.add(c.toLowerCase()))
      .slice(0, PRICELIST_LIMITS.choicesMax)
  }
  return out
}

/**
 * Stored / pasted data -> a valid column list: unknown or duplicate keys dropped, at most 12, and the FIRST column is always
 * the item name (created if missing, forced to role 'name' / text, never hidden). Only one name column is kept.
 */
export function sanitizeColumns(raw: unknown): PriceColumn[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const cols: PriceColumn[] = []
  for (const item of list) {
    const c = sanitizeOne(item)
    if (!c || seen.has(c.key)) continue
    seen.add(c.key)
    cols.push(c)
  }
  const nameIdx = cols.findIndex((c) => c.role === 'name')
  let name: PriceColumn
  if (nameIdx >= 0) name = cols.splice(nameIdx, 1)[0]!
  else name = nameColumn()
  name = { ...name, key: name.key, type: 'text', role: 'name', hidden: false, tier: undefined }
  delete name.tier
  const rest = cols.filter((c) => c.role !== 'name')
  return [name, ...rest].slice(0, PRICELIST_LIMITS.maxColumns)
}

/** Smallest `cN` used neither by a column nor in `usedKeys` (every key ever used on the tab, e.g. row cell keys), so keys are never reused. */
export function nextColumnKey(columns: readonly PriceColumn[], usedKeys: Iterable<string> = []): string {
  const used = new Set<string>([...columns.map((c) => c.key), ...usedKeys])
  let n = 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

export type ColumnsResult = { ok: true; columns: PriceColumn[]; column?: PriceColumn } | { ok: false; reason: 'limit' | 'missing' | 'name_column' }

export function addColumn(columns: readonly PriceColumn[], partial: Partial<PriceColumn> & { label: string }, usedKeys: Iterable<string> = []): ColumnsResult {
  if (columns.length >= PRICELIST_LIMITS.maxColumns) return { ok: false, reason: 'limit' }
  const key = nextColumnKey(columns, usedKeys)
  const col = sanitizeOne({ ...partial, key, role: partial.role === 'name' ? 'other' : partial.role })
  if (!col) return { ok: false, reason: 'missing' }
  return { ok: true, columns: [...columns, col], column: col }
}

export function renameColumn(columns: readonly PriceColumn[], key: string, label: string): ColumnsResult {
  const l = sanitizeColumnLabel(label)
  if (!columns.some((c) => c.key === key) || l === '') return { ok: false, reason: 'missing' }
  return { ok: true, columns: columns.map((c) => (c.key === key ? { ...c, label: l } : c)) }
}

/** The item-name column cannot be removed. Row cell data for the key is left to the caller (orphan data is harmless and never revived: keys are not reused). */
export function removeColumn(columns: readonly PriceColumn[], key: string): ColumnsResult {
  const c = columns.find((x) => x.key === key)
  if (!c) return { ok: false, reason: 'missing' }
  if (c.role === 'name') return { ok: false, reason: 'name_column' }
  return { ok: true, columns: columns.filter((x) => x.key !== key) }
}

/** Move a column to an index (1..n-1: nothing goes before the name column). */
export function moveColumn(columns: readonly PriceColumn[], key: string, toIndex: number): ColumnsResult {
  const from = columns.findIndex((c) => c.key === key)
  if (from < 0) return { ok: false, reason: 'missing' }
  if (columns[from]!.role === 'name') return { ok: false, reason: 'name_column' }
  const list = [...columns]
  const [c] = list.splice(from, 1)
  list.splice(Math.max(1, Math.min(list.length, toIndex)), 0, c!)
  return { ok: true, columns: list }
}

export function updateColumn(columns: readonly PriceColumn[], key: string, patch: Partial<Omit<PriceColumn, 'key' | 'role'>>): ColumnsResult {
  const cur = columns.find((c) => c.key === key)
  if (!cur) return { ok: false, reason: 'missing' }
  const next = sanitizeOne({ ...cur, ...patch, key, role: cur.role })
  if (!next) return { ok: false, reason: 'missing' }
  if (cur.role === 'name') { next.hidden = false; next.type = 'text'; delete next.tier }
  return { ok: true, columns: columns.map((c) => (c.key === key ? next : c)) }
}

/** The tab's column carrying a tier (first match), or null: a tab without the tier is simply not used for that fill. */
export function priceColumnForTier(columns: readonly PriceColumn[], tierKey: string): PriceColumn | null {
  return columns.find((c) => c.role === 'price' && c.tier === tierKey) ?? null
}

/** Copy the column set to another tab (design: copy columns from another tab / apply a template). Keys are kept so cells map 1:1. */
export const copyColumns = (columns: readonly PriceColumn[]): PriceColumn[] => sanitizeColumns(columns.map((c) => ({ ...c })))
