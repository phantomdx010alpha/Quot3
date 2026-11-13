import Database from 'better-sqlite3'
import { AppError } from '../ipc/envelope'
import { LEGACY_LIMITS, type LegacyInventory } from '../../shared/pricelist/legacyImport'

/**
 * Phase 237 (M23) - reads the old inventory file (`bills_data.db`) READ-ONLY. Only `inv_categories`, `inv_tabs` and `inv_items` are read; the
 * `bills` and `inv_last_state` tables are never touched. The file is private business data: nothing from it is logged or printed here.
 */
const needTables = ['inv_categories', 'inv_tabs', 'inv_items'] as const

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const int = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }

export function readLegacyInventory(file: string): LegacyInventory {
  let db: Database.Database
  try { db = new Database(file, { readonly: true, fileMustExist: true }) } catch { throw new AppError('IO_ERROR', 'That file could not be opened. Choose the old inventory file (bills_data.db).') }
  try {
    let have: Set<string>
    try { have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name)) }
    catch { throw new AppError('VALIDATION', 'That file is not a database the importer can read.') }
    if (!needTables.every((t) => have.has(t))) throw new AppError('VALIDATION', 'That file has no old inventory tables (inv_categories, inv_tabs, inv_items).')
    // Older files may lack a column (`unit_qty`, `position`): select NULL for it instead of failing.
    const cols = (t: string): Set<string> => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((r) => r.name))
    const pick = (have2: Set<string>, c: string): string => (have2.has(c) ? c : `NULL AS ${c}`)
    const tc = cols('inv_tabs'), ic = cols('inv_items')
    const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    if (count('inv_categories') > LEGACY_LIMITS.maxCategories || count('inv_tabs') > LEGACY_LIMITS.maxTabs || count('inv_items') > LEGACY_LIMITS.maxItems) {
      throw new AppError('VALIDATION', 'That inventory file is much larger than expected, so it was not read.')
    }
    const categories = (db.prepare(`SELECT id, name FROM inv_categories ORDER BY id`).all() as Array<Record<string, unknown>>).map((r) => ({ id: int(r.id), name: str(r.name) }))
    const tabs = (db.prepare(`SELECT id, category_id, name, ${pick(tc, 'position')} FROM inv_tabs ORDER BY category_id, id`).all() as Array<Record<string, unknown>>)
      .map((r) => ({ id: int(r.id), categoryId: int(r.category_id), name: str(r.name), position: int(r.position) }))
    const items = (db.prepare(`SELECT id, tab_id, ${pick(ic, 'row_index')}, item_name, ${pick(ic, 'rate')}, ${pick(ic, 'rate_without_gst')}, ${pick(ic, 'unit_qty')}, ${pick(ic, 'qty')}, ${pick(ic, 'qty_with_gst')} FROM inv_items ORDER BY tab_id, id`).all() as Array<Record<string, unknown>>)
      .map((r) => ({
        id: int(r.id), tabId: int(r.tab_id), rowIndex: int(r.row_index), name: str(r.item_name),
        rate: str(r.rate), rateWithoutGst: str(r.rate_without_gst), unitQty: str(r.unit_qty), qty: str(r.qty), qtyWithGst: str(r.qty_with_gst)
      }))
    return { categories, tabs, items }
  } finally { db.close() }
}
