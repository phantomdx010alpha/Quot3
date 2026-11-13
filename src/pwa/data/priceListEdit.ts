/** Phone Price List EDITING (Phase 246, M23). Every change goes through `savePriceRecord` / `softDeletePrice` with `withPriceOutbox`, so it is queued
 *  in the SAME transaction and pushed by the normal push worker. Each function: (1) refuses in plain words when this tab is not the writer, the phone has no
 *  branch yet, or the seat's flags do not allow it (`guardChange`, the shared rule); (2) builds ONE record change (so exactly one outbox row per record);
 *  (3) never throws for a normal refusal (a result is returned). Names and prices are stored whole, never truncated; prices are decimal strings
 *  (`sanitizeCell`, no floating point). Data only: nothing typed is ever executed. */
import { defaultColumnSet, sanitizeColumns } from '../../shared/pricelist/columns'
import { sanitizeCell, newRow } from '../../shared/pricelist/rows'
import { addCategory, addTab, renameCategory, renameTab, sanitizeName, type NameResult } from '../../shared/pricelist/structure'
import { NAME_COLUMN_KEY, PRICELIST_LIMITS, type PriceCategory, type PriceTab } from '../../shared/pricelist/types'
import type { PermFlag, PermFlags } from '../../shared/pricelist/perms'
import { fromPlain, plain } from '../../shared/richtext/runs'
import type { Runs } from '../../shared/types'
import { getRecord, type PhoneDb } from './db'
import { getMetaValue } from './metaRepo'
import { getPriceRow, getPriceTab, listCategories, listRows, listTabs, listTiers, savePriceRecord, softDeletePrice, type PriceCategoryRec, type PriceRowRec, type PriceStamp, type PriceTabRec } from './priceListRepo'
import { guardChange, readCachedPerms } from './priceRights'
import { withPriceOutbox } from '../sync/outbox'
import type { PriceKind } from '../../shared/sync/priceListRecords'

export interface EditCtx { db: PhoneDb; flags: PermFlags; now?: () => Date; newId?: () => string }
export type EditFail = 'read_only' | 'not_linked' | 'not_allowed' | 'invalid' | 'missing' | 'duplicate' | 'empty' | 'unchanged'
export type EditResult = { ok: true; id: string } | { ok: false; reason: EditFail; message: string; missing?: PermFlag[] }

export const MSG = {
  readOnly: 'Quot3 is open in another tab. Close it to make changes here.',
  notLinked: 'Sign this phone in to the shared notebook before changing the Price List, so the change can reach the other branches.',
  missing: 'That item is no longer in the Price List.',
  empty: 'Type a name first.',
  duplicate: 'That name is already used here. Pick another name.',
  unchanged: 'Nothing was changed.'
} as const

const fail = (reason: EditFail, message: string, missing?: PermFlag[]): EditResult => ({ ok: false, reason, message, ...(missing ? { missing } : {}) })
const defaultId = (): string => globalThis.crypto.randomUUID()
const textOfRuns = (raw: unknown): string => (Array.isArray(raw) ? plain(raw.filter((r): r is { t: string } => typeof r === 'object' && r !== null && typeof (r as { t?: unknown }).t === 'string') as Runs) : '')
const nameFail = (r: Extract<NameResult<unknown>, { ok: false }>): EditResult => fail(r.reason === 'empty' ? 'empty' : r.reason === 'duplicate' ? 'duplicate' : 'missing', MSG[r.reason])

/** The stamp for a local change (author = this phone's branch and the seat the server gave it). `null` = not linked yet. */
async function stampFor(ctx: EditCtx): Promise<PriceStamp | null> {
  const branchId = await getMetaValue(ctx.db, 'branch_id')
  if (!branchId) return null
  const seat = await readCachedPerms(ctx.db)
  return { at: (ctx.now ?? (() => new Date()))().toISOString(), branchId, seatNo: seat?.seatNo ?? null }
}

/** Common start: writer tab + branch known. */
async function begin(ctx: EditCtx): Promise<{ stamp: PriceStamp } | EditResult> {
  if (!ctx.db.canWrite()) return fail('read_only', MSG.readOnly)
  const stamp = await stampFor(ctx)
  return stamp ? { stamp } : fail('not_linked', MSG.notLinked)
}
const isFail = (x: { stamp: PriceStamp } | EditResult): x is EditResult => 'ok' in x

const catView = (c: PriceCategoryRec): PriceCategory => ({ id: c.id, name: c.name, color: null, position: c.position })
const tabView = (t: PriceTabRec): PriceTab => ({ id: t.id, categoryId: t.categoryId, name: t.name, position: t.position, columns: sanitizeColumns(t.columns) })

// ---- rows ----------------------------------------------------------------------------------------------------------------------

export interface RowChange {
  /** New item name (plain text). Omitted = unchanged. */
  name?: string
  /** columnKey -> typed text. Only the cells that differ from the stored row count; '' clears a cell. */
  cells?: Record<string, string>
}

/** Saves the name and / or cells of ONE row as ONE record change (one outbox row). Filling an empty price needs `edit`, changing a price needs `overwrite`
 *  (the shared diff decides). Section rows have a name only. */
export async function saveRowEdit(ctx: EditCtx, rowId: string, change: RowChange): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const old = await getPriceRow(ctx.db, rowId)
  if (!old || old.deletedAt !== null) return fail('missing', MSG.missing)
  const tab = await getPriceTab(ctx.db, old.tabId)
  const columns = tab ? sanitizeColumns(tab.columns) : []
  const cells: Record<string, string> = { ...(typeof old.cells === 'object' && old.cells !== null ? old.cells : {}) }
  const fields: Record<string, unknown> = { id: rowId }
  if (change.name !== undefined) {
    const name = change.name.replace(/\s+/g, ' ').trim()
    if (Array.from(name).length > PRICELIST_LIMITS.nameMax) return fail('invalid', `The name is too long (at most ${PRICELIST_LIMITS.nameMax} characters).`)
    if (name !== textOfRuns(old.nameRuns).replace(/\s+/g, ' ').trim()) fields.nameRuns = name === '' ? [] : fromPlain(name)
  }
  if (change.cells && old.kind !== 'section') {
    for (const [key, raw] of Object.entries(change.cells)) {
      if (key === NAME_COLUMN_KEY) continue
      const col = columns.find((c) => c.key === key)
      if (!col) continue
      const val = sanitizeCell(col, raw)
      if (val === null) return fail('invalid', `"${raw.trim()}" is not a valid value for ${col.label}.`)
      if (val === (cells[key] ?? '')) continue
      if (val === '') delete cells[key]
      else cells[key] = val
      fields.cells = cells
    }
  }
  if (Object.keys(fields).length === 1) return fail('unchanged', MSG.unchanged)
  const next = { ...old, ...fields }
  const g = guardChange(ctx.flags, 'price_row', old, next)
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_row', fields as Record<string, unknown> & { id: string }, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id: rowId }
}

/** Adds an item (or a section heading) at the end of a tab. Needs `add`. A new item may start with its prices (a cell filled on a new row is part of the add). */
export async function addRow(ctx: EditCtx, tabId: string, input: { name: string; kind?: 'item' | 'section'; cells?: Record<string, string> }): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const tab = await getPriceTab(ctx.db, tabId)
  if (!tab || tab.deletedAt !== null) return fail('missing', 'That tab is no longer in the Price List.')
  const name = input.name.replace(/\s+/g, ' ').trim()
  if (name === '') return fail('empty', MSG.empty)
  if (Array.from(name).length > PRICELIST_LIMITS.nameMax) return fail('invalid', `The name is too long (at most ${PRICELIST_LIMITS.nameMax} characters).`)
  const columns = sanitizeColumns(tab.columns)
  const cells: Record<string, string> = {}
  const kind = input.kind === 'section' ? 'section' : 'item'
  if (kind === 'item') {
    for (const [key, raw] of Object.entries(input.cells ?? {})) {
      const col = columns.find((c) => c.key === key)
      if (!col || key === NAME_COLUMN_KEY) continue
      const val = sanitizeCell(col, raw)
      if (val === null) return fail('invalid', `"${raw.trim()}" is not a valid value for ${col.label}.`)
      if (val !== '') cells[key] = val
    }
  }
  const rows = await listRows(ctx.db, tabId)
  const idx = rows.reduce((m, r) => Math.max(m, r.idx), -1) + 1
  const id = (ctx.newId ?? defaultId)()
  const r = newRow(id, tabId, idx, kind, name)
  const fields = { id, tabId, idx, kind: r.kind, nameRuns: r.nameRuns, cells }
  const g = guardChange(ctx.flags, 'price_row', null, fields)
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_row', fields, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

// ---- categories and tabs (structure) ------------------------------------------------------------------------------------------

export async function addCategoryRec(ctx: EditCtx, rawName: string): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const cats = (await listCategories(ctx.db)).map(catView)
  const id = (ctx.newId ?? defaultId)()
  const res = addCategory(cats, rawName, id)
  if (!res.ok) return nameFail(res)
  const made = res.value.find((c) => c.id === id)!
  const fields = { id, name: made.name, color: null, position: made.position }
  const g = guardChange(ctx.flags, 'price_category', null, fields)
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_category', fields, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

export async function renameCategoryRec(ctx: EditCtx, id: string, rawName: string): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const old = await getRecord<PriceCategoryRec>(ctx.db, 'price_categories', id)
  if (!old || old.deletedAt !== null) return fail('missing', 'That category is no longer in the Price List.')
  const res = renameCategory((await listCategories(ctx.db)).map(catView), id, rawName)
  if (!res.ok) return nameFail(res)
  const name = res.value.find((c) => c.id === id)!.name
  if (name === old.name) return fail('unchanged', MSG.unchanged)
  const g = guardChange(ctx.flags, 'price_category', old, { ...old, name })
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_category', { id, name }, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

/** A new tab starts with the standard column set built from the Price List's price levels (the same start as the desktop). */
export async function addTabRec(ctx: EditCtx, categoryId: string, rawName: string): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const cat = await getRecord<PriceCategoryRec>(ctx.db, 'price_categories', categoryId)
  if (!cat || cat.deletedAt !== null) return fail('missing', 'That category is no longer in the Price List.')
  const sibs = (await listTabs(ctx.db, categoryId)).map(tabView)
  const columns = defaultColumnSet((await listTiers(ctx.db)).map((t) => ({ key: t.key, label: t.label })))
  const id = (ctx.newId ?? defaultId)()
  const res = addTab(sibs, categoryId, rawName, id, columns)
  if (!res.ok) return nameFail(res)
  const made = res.value.find((t) => t.id === id)!
  const fields = { id, categoryId, name: made.name, position: made.position, columns: made.columns }
  const g = guardChange(ctx.flags, 'price_tab', null, fields)
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_tab', fields, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

export async function renameTabRec(ctx: EditCtx, id: string, rawName: string): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const old = await getPriceTab(ctx.db, id)
  if (!old || old.deletedAt !== null) return fail('missing', 'That tab is no longer in the Price List.')
  const res = renameTab((await listTabs(ctx.db, old.categoryId)).map(tabView), id, rawName)
  if (!res.ok) return nameFail(res)
  const name = res.value.find((t) => t.id === id)!.name
  if (name === old.name) return fail('unchanged', MSG.unchanged)
  const g = guardChange(ctx.flags, 'price_tab', old, { ...old, name })
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await savePriceRecord(ctx.db, 'price_tab', { id, name }, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

// ---- delete (soft: tombstone, like the desktop trash) ------------------------------------------------------------------------------

/** Deletes an item, a tab (with its items) or a category (with its tabs and items) as tombstones; every record gets its own outbox row. Needs `delete`. */
export async function deletePriceRec(ctx: EditCtx, kind: Exclude<PriceKind, 'price_tier'>, id: string): Promise<EditResult> {
  const b = await begin(ctx)
  if (isFail(b)) return b
  const old = kind === 'price_row' ? await getPriceRow(ctx.db, id) : kind === 'price_tab' ? await getPriceTab(ctx.db, id) : await getRecord<PriceCategoryRec>(ctx.db, 'price_categories', id)
  if (!old || (old as { deletedAt: string | null }).deletedAt !== null) return fail('missing', 'That is no longer in the Price List.')
  const g = guardChange(ctx.flags, kind, old, old, true)
  if (!g.ok) return fail('not_allowed', g.text, g.missing)
  await softDeletePrice(ctx.db, kind, id, b.stamp, withPriceOutbox({ now: ctx.now }))
  return { ok: true, id }
}

export type { PriceRowRec }
export const cleanName = sanitizeName
