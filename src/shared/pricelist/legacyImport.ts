/**
 * Phase 237 (M23) - legacy inventory import: the PURE part (no DOM, no Electron, no Node, no SQL).
 * Spec: docs/PRICELIST_IMPORT_SPEC.md. Input is the plain content of the three legacy `inv_*` tables; output is a preview (writes nothing)
 * and a plan the main-process service applies in ONE transaction. Names and prices are private business data: nothing here logs or prints them.
 */
import { fromPlain } from '../richtext/runs'
import type { Runs } from '../types'
import { priceColumn, nameColumn } from './columns'
import { rowPlain, sanitizeRow } from './rows'
import { nameKeyOf, sanitizeName } from './structure'
import { NAME_COLUMN_KEY, PRICELIST_LIMITS, type PriceCategory, type PriceColumn, type PriceRow, type PriceTab, type PriceTier } from './types'

// ---- the legacy source (as read; all price fields are TEXT in the old file)
export interface LegacyCategory { id: number; name: string }
export interface LegacyTab { id: number; categoryId: number; name: string; position: number }
export interface LegacyItem {
  id: number
  tabId: number
  rowIndex: number
  name: string
  /** `rate` = "cash w/o" */
  rate: string
  /** `rate_without_gst` = "wholesale w/o" */
  rateWithoutGst: string
  /** `unit_qty` = "cash+GST" (the DB column names are misleading; the legacy screen headers are the truth) */
  unitQty: string
  /** `qty` = "credit gst" */
  qty: string
  /** `qty_with_gst` = "Unit/Qty" (empty in all of today's rows) */
  qtyWithGst: string
}
export interface LegacyInventory { categories: LegacyCategory[]; tabs: LegacyTab[]; items: LegacyItem[] }

/** Legacy field -> tier key (spec 1.2). Data, not code paths: the unit column is found by its role. */
export const LEGACY_PRICE_FIELDS = [
  { field: 'rate', tier: 'cash_wo' },
  { field: 'rateWithoutGst', tier: 'wholesale_wo' },
  { field: 'unitQty', tier: 'cash_gst' },
  { field: 'qty', tier: 'credit_gst' }
] as const satisfies readonly { field: keyof LegacyItem; tier: string }[]
export const LEGACY_UNIT_LABEL = 'Unit/Qty'
export const LEGACY_UNIT_KEY = 'c5'

export const LEGACY_LIMITS = { maxCategories: 500, maxTabs: 5000, maxItems: 100_000 } as const

// ---- cleaning (spec section 2: trim, line breaks -> one space, collapse spaces; never change letters or numbers)
export function cleanLegacyName(raw: unknown): { text: string; hadLineBreak: boolean; hadEdgeSpace: boolean } {
  const s = typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String(raw)
  const hadLineBreak = /[\r\n\u2028\u2029]/.test(s)
  const hadEdgeSpace = s !== s.trim()
  return { text: s.replace(/[\r\n\u2028\u2029\t]+/g, ' ').replace(/ {2,}/g, ' ').trim(), hadLineBreak, hadEdgeSpace }
}

/** Re-run key: normalised (category, tab, item name); a repeated name inside one tab gets `#2`, `#3` ... in row order. */
export const legacyKey = (category: string, tab: string, item: string, n = 1): string => `${nameKeyOf(category)}\u241F${nameKeyOf(tab)}\u241F${nameKeyOf(item)}${n > 1 ? `#${n}` : ''}`

/** 53-bit FNV-style fingerprint of a row's content (name + cells in key order); not a security hash. */
export function rowFingerprint(row: Pick<PriceRow, 'kind' | 'nameRuns' | 'cells'>): string {
  const body = `${row.kind}\u241F${rowPlain(row)}\u241F${Object.keys(row.cells).sort().map((k) => `${k}=${row.cells[k]}`).join('\u241E')}`
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// ---- state the plan is built against (read by the service from the live Price List)
export interface ImportMapEntry { legacyKey: string; rowId: string; fingerprint: string }
export interface PlanState {
  tiers: readonly PriceTier[]
  categories: readonly PriceCategory[]
  tabs: readonly PriceTab[]
  /** Live rows of every live tab. */
  rowsByTab: ReadonlyMap<string, readonly PriceRow[]>
  map: ReadonlyMap<string, ImportMapEntry>
  /** Any row (live or in the trash) by id, for the rows the map points at. */
  rowById: ReadonlyMap<string, { row: PriceRow; deleted: boolean }>
}

// ---- preview (plain numbers + the structure; shown to the owner only)
export interface ImportPreviewTab { category: string; tab: string; items: number; isNew: boolean }
export interface ImportPreview {
  categories: { total: number; added: number; existing: number }
  tabs: { total: number; added: number; existing: number }
  items: {
    total: number
    withPrice: number
    nameOnly: number
    /** will be added */
    added: number
    /** same as before (map), or the same name is already typed here by hand (that one is also counted in `alreadyThere`; not touched) */
    unchanged: number
    /** edited at the source since the last import and not edited here: will be updated */
    changed: number
    /** edited here since the import AND changed at the source: reported, never overwritten */
    editedHere: number
    /** deleted here since the import: not brought back */
    removedHere: number
    /** same name already in the tab but not from an import: left alone */
    alreadyThere: number
  }
  cleaned: { lineBreaks: number; edgeSpaces: number }
  skipped: { emptyName: number; orphanTab: number; orphanItem: number }
  tabsWithGap: number
  /** Price values that were not plain numbers (dropped). */
  droppedValues: number
  /** Price values that had no matching column in an existing tab (dropped). */
  unmappedValues: number
  /** Tier keys the importer wanted but this Price List no longer has (that column is not imported). */
  missingTiers: string[]
  columns: Array<{ label: string; tier: string | null }>
  tabsList: ImportPreviewTab[]
}

export interface PlanCategory { id: string; name: string; position: number; isNew: boolean }
export interface PlanTab { id: string; categoryId: string; name: string; position: number; columns: PriceColumn[]; isNew: boolean }
export interface PlanRowOp { op: 'add' | 'update'; row: PriceRow; legacyKey: string; fingerprint: string }
export interface ImportPlan {
  preview: ImportPreview
  categories: PlanCategory[]
  tabs: PlanTab[]
  rows: PlanRowOp[]
  /** Map entries whose rows were found unchanged (refresh nothing) are omitted; only add / update ops write the map. */
  empty: boolean
}

const emptyPreview = (): ImportPreview => ({
  categories: { total: 0, added: 0, existing: 0 }, tabs: { total: 0, added: 0, existing: 0 },
  items: { total: 0, withPrice: 0, nameOnly: 0, added: 0, unchanged: 0, changed: 0, editedHere: 0, removedHere: 0, alreadyThere: 0 },
  cleaned: { lineBreaks: 0, edgeSpaces: 0 }, skipped: { emptyName: 0, orphanTab: 0, orphanItem: 0 },
  tabsWithGap: 0, droppedValues: 0, unmappedValues: 0, missingTiers: [], columns: [], tabsList: []
})

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/** The column set of a tab created by the import: Item name + one column per legacy tier that still exists + the Unit/Qty column. */
export function legacyColumns(tiers: readonly PriceTier[], unitHidden: boolean): { columns: PriceColumn[]; missingTiers: string[] } {
  const missingTiers: string[] = []
  const cols: PriceColumn[] = [nameColumn()]
  LEGACY_PRICE_FIELDS.forEach((f, i) => {
    const t = tiers.find((x) => x.key === f.tier)
    if (!t) { missingTiers.push(f.tier); return }
    cols.push(priceColumn(`c${i + 1}`, t.label, t.key))
  })
  const unit: PriceColumn = { key: LEGACY_UNIT_KEY, label: LEGACY_UNIT_LABEL, type: 'text', role: 'unit', widthPx: 120, align: 'left', hidden: unitHidden, frozen: false }
  cols.push(unit)
  return { columns: cols.slice(0, PRICELIST_LIMITS.maxColumns), missingTiers }
}

/** The legacy item as a Price List row for `columns` (an existing tab may have other columns: values are placed by tier / role, never by key). */
function toRow(it: LegacyItem, name: string, columns: readonly PriceColumn[], id: string, tabId: string, idx: number, count: { dropped: number; unmapped: number }): PriceRow {
  const cells: Record<string, string> = {}
  for (const f of LEGACY_PRICE_FIELDS) {
    const raw = text(it[f.field])
    if (raw === '') continue
    const col = columns.find((c) => c.role === 'price' && c.tier === f.tier)
    if (!col) { count.unmapped++; continue }
    cells[col.key] = raw
  }
  const unitRaw = text(it.qtyWithGst)
  if (unitRaw !== '') {
    const col = columns.find((c) => c.role === 'unit')
    if (col) cells[col.key] = unitRaw
    else count.unmapped++
  }
  const nameRuns: Runs = fromPlain(name)
  const row = sanitizeRow({ id, tabId, idx, kind: 'item', nameRuns, cells }, columns)
  count.dropped += Object.keys(cells).filter((k) => columns.find((c) => c.key === k)?.role === 'price' && row.cells[k] === undefined).length
  return row
}

/**
 * Plan the import. Pure: nothing is written. `newId` creates ids for new categories / tabs / rows (the service passes its generator).
 * Never deletes anything; never overwrites a row that was edited here since the last import.
 */
export function planLegacyImport(legacy: LegacyInventory, state: PlanState, newId: () => string): ImportPlan {
  const pv = emptyPreview()
  const cats = [...legacy.categories].sort((a, b) => a.id - b.id)
  const catById = new Map(cats.map((c) => [c.id, c]))
  const tabs = [...legacy.tabs].sort((a, b) => a.categoryId - b.categoryId || a.position - b.position || a.id - b.id)
  const tabById = new Map(tabs.map((t) => [t.id, t]))

  // Unit/Qty stays hidden while it is empty everywhere (spec section 2).
  const unitHidden = !legacy.items.some((i) => text(i.qtyWithGst) !== '')
  const fresh = legacyColumns(state.tiers, unitHidden)
  pv.missingTiers = fresh.missingTiers
  pv.columns = fresh.columns.filter((c) => c.role !== 'name').map((c) => ({ label: c.label, tier: c.tier ?? null }))

  // ---- categories: existing by case / space-insensitive name, else new (appended after the existing ones)
  const liveCatByKey = new Map(state.categories.map((c) => [nameKeyOf(c.name), c]))
  const planCats: PlanCategory[] = []
  const catIdOf = new Map<number, string>()
  const catNameOf = new Map<number, string>()
  const seenCatKey = new Map<string, string>()
  let nextCatPos = state.categories.reduce((m, c) => Math.max(m, c.position + 1), 0)
  for (const c of cats) {
    const name = sanitizeName(cleanLegacyName(c.name).text)
    if (name === '') { pv.skipped.orphanTab++; continue }
    const key = nameKeyOf(name)
    const dup = seenCatKey.get(key)
    if (dup) { catIdOf.set(c.id, dup); catNameOf.set(c.id, name); continue }
    const ex = liveCatByKey.get(key)
    const id = ex?.id ?? newId()
    seenCatKey.set(key, id)
    catIdOf.set(c.id, id); catNameOf.set(c.id, ex?.name ?? name)
    planCats.push({ id, name: ex?.name ?? name, position: ex?.position ?? nextCatPos++, isNew: !ex })
  }
  pv.categories = { total: planCats.length, added: planCats.filter((c) => c.isNew).length, existing: planCats.filter((c) => !c.isNew).length }

  // ---- tabs
  const planTabs: PlanTab[] = []
  const tabIdOf = new Map<number, PlanTab>()
  const nextTabPos = new Map<string, number>()
  const posOfTabs = (catId: string): number => {
    const cur = nextTabPos.get(catId) ?? state.tabs.filter((t) => t.categoryId === catId).reduce((m, t) => Math.max(m, t.position + 1), 0)
    nextTabPos.set(catId, cur + 1)
    return cur
  }
  for (const t of tabs) {
    const catId = catIdOf.get(t.categoryId)
    if (!catId || !catById.has(t.categoryId)) { pv.skipped.orphanTab++; continue }
    const name = sanitizeName(cleanLegacyName(t.name).text)
    if (name === '') { pv.skipped.orphanTab++; continue }
    const existing = state.tabs.find((x) => x.categoryId === catId && nameKeyOf(x.name) === nameKeyOf(name))
    const already = planTabs.find((x) => x.categoryId === catId && nameKeyOf(x.name) === nameKeyOf(name))
    if (already) { tabIdOf.set(t.id, already); continue }
    const pt: PlanTab = existing
      ? { id: existing.id, categoryId: catId, name: existing.name, position: existing.position, columns: existing.columns, isNew: false }
      : { id: newId(), categoryId: catId, name, position: posOfTabs(catId), columns: fresh.columns, isNew: true }
    planTabs.push(pt)
    tabIdOf.set(t.id, pt)
  }

  // ---- items
  const itemsOfTab = new Map<number, LegacyItem[]>()
  for (const it of legacy.items) {
    if (!tabById.has(it.tabId) || !tabIdOf.has(it.tabId)) { pv.skipped.orphanItem++; continue }
    const a = itemsOfTab.get(it.tabId) ?? []
    a.push(it); itemsOfTab.set(it.tabId, a)
  }
  const rowOps: PlanRowOp[] = []
  const used = new Map<string, number>()
  const nextIdx = new Map<string, number>() // plan tab id -> next row index to append at
  const tabCount = new Map<string, number>() // plan tab id -> items counted for the preview list
  const sortedTabIds = [...itemsOfTab.keys()].sort((a, b) => tabs.findIndex((t) => t.id === a) - tabs.findIndex((t) => t.id === b))
  for (const legacyTabId of sortedTabIds) {
    const pt = tabIdOf.get(legacyTabId)!
    const list = itemsOfTab.get(legacyTabId)!.sort((a, b) => a.rowIndex - b.rowIndex || a.id - b.id)
    // One gap in row_index is compacted on import (it is only reported).
    if (list.some((it, i) => i > 0 && it.rowIndex - list[i - 1]!.rowIndex > 1)) pv.tabsWithGap++
    const existingRows = pt.isNew ? [] : (state.rowsByTab.get(pt.id) ?? [])
    const existingByName = new Map<string, PriceRow>()
    for (const r of existingRows) if (r.kind === 'item') { const k = nameKeyOf(rowPlain(r)); if (!existingByName.has(k)) existingByName.set(k, r) }
    if (!nextIdx.has(pt.id)) nextIdx.set(pt.id, existingRows.reduce((m, r) => Math.max(m, r.idx + 1), 0))
    const catName = catNameOf.get(tabById.get(legacyTabId)!.categoryId) ?? ''
    for (const it of list) {
      const c = cleanLegacyName(it.name)
      if (c.text === '') { pv.skipped.emptyName++; continue }
      if (c.hadLineBreak) pv.cleaned.lineBreaks++
      if (c.hadEdgeSpace) pv.cleaned.edgeSpaces++
      pv.items.total++
      const hasPrice = LEGACY_PRICE_FIELDS.some((f) => text(it[f.field]) !== '')
      if (hasPrice) pv.items.withPrice++; else pv.items.nameOnly++
      tabCount.set(pt.id, (tabCount.get(pt.id) ?? 0) + 1)

      const base = legacyKey(catName, pt.name, c.text)
      const n = (used.get(base) ?? 0) + 1
      used.set(base, n)
      const key = n > 1 ? legacyKey(catName, pt.name, c.text, n) : base
      const counts = { dropped: 0, unmapped: 0 }
      const idx = nextIdx.get(pt.id)!
      const fresh1 = toRow(it, c.text, pt.columns, newId(), pt.id, idx, counts)
      pv.droppedValues += counts.dropped; pv.unmappedValues += counts.unmapped
      const fp = rowFingerprint(fresh1)
      const mapped = state.map.get(key)

      if (!mapped) {
        const same = existingByName.get(nameKeyOf(c.text))
        if (same) { pv.items.alreadyThere++; pv.items.unchanged++; continue }
        pv.items.added++
        rowOps.push({ op: 'add', row: fresh1, legacyKey: key, fingerprint: fp })
        nextIdx.set(pt.id, idx + 1)
        continue
      }
      const cur = state.rowById.get(mapped.rowId)
      if (!cur || cur.deleted) { pv.items.removedHere++; continue }
      const editedHere = rowFingerprint(cur.row) !== mapped.fingerprint
      if (fp === mapped.fingerprint) { pv.items.unchanged++; continue } // the source did not change
      if (editedHere) { pv.items.editedHere++; continue }
      pv.items.changed++
      rowOps.push({ op: 'update', row: { ...fresh1, id: cur.row.id, tabId: cur.row.tabId, idx: cur.row.idx }, legacyKey: key, fingerprint: fp })
    }
  }

  pv.tabs = { total: planTabs.length, added: planTabs.filter((t) => t.isNew).length, existing: planTabs.filter((t) => !t.isNew).length }
  pv.tabsList = planTabs.map((t) => ({ category: planCats.find((c) => c.id === t.categoryId)?.name ?? '', tab: t.name, items: tabCount.get(t.id) ?? 0, isNew: t.isNew }))
  const writesStructure = planCats.some((c) => c.isNew) || planTabs.some((t) => t.isNew)
  return { preview: pv, categories: planCats, tabs: planTabs, rows: rowOps, empty: !writesStructure && rowOps.length === 0 }
}

/** One plain sentence for the activity log (counts only; never a name). */
export const importLogLine = (p: ImportPreview): string =>
  `Imported from the old inventory: ${p.items.added} added, ${p.items.changed} updated (${p.categories.added} new categories, ${p.tabs.added} new tabs).`
