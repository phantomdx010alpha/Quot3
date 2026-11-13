import type Database from 'better-sqlite3'
import { sanitizeColumns } from '../../shared/pricelist/columns'
import { rowNameKey, rowPlain } from '../../shared/pricelist/rows'
import { nameKeyOf, uniqueName } from '../../shared/pricelist/structure'
import type { PriceCategory, PriceRow, PriceTab, PriceTier, RowKind } from '../../shared/pricelist/types'
import { priceFingerprint, priceIncomingWins, type PriceKind, type PriceRec } from '../../shared/sync/priceListRecords'

/**
 * The only SQL for the Price List tables (Phase 236, MILESTONE23_DESIGN 7.1): tiers, categories, tabs, rows. Everything is soft deleted
 * (`deleted_at`), so Trash / restore work and sync can send tombstones later. Deleting a category or tab soft-deletes its live children with
 * the SAME `deleted_at`, and restoring brings back exactly those children (a row deleted earlier stays in the trash).
 * The repo holds no rules (names, columns, money): the service runs the shared pure modules first. Writes need a `Stamp`.
 */
export interface Stamp { at: string; branchId: string; seatNo: number | null }
export type TrashKind = 'category' | 'tab' | 'row'
export interface TrashEntry { kind: TrashKind; id: string; name: string; path: string; deletedAt: string; count: number }
export type RestoreOutcome = 'ok' | 'missing' | 'not_deleted' | 'parent_deleted'
/** Phase 241: one local change, as the sync outbox needs it (the record id is the entity id). */
export interface PriceChange { kind: PriceKind; id: string; deleted: boolean }
/** Phase 241: what `applyRemote` did with a record that came from another PC. */
export type RemotePriceOutcome = 'inserted' | 'updated' | 'ignored'
export interface PriceListRepoOptions {
  /**
   * Called INSIDE the write, after every LOCAL change (and for every child a cascade touched), so the sync outbox row commits with the data.
   * Never called by `applyRemote` (a change that came from another PC is never sent back out). Not called by `purge` / `clearAll`:
   * hard deletes stay on this PC [A] (the trash is local; "Clear Price List" never deletes other PCs' data).
   */
  onChange?: (changes: readonly PriceChange[]) => void
}

interface RawTab { id: string; categoryId: string; name: string; position: number; columnsJson: string }
interface RawRow { id: string; tabId: string; idx: number; kind: string; nameRunsJson: string; cellsJson: string }

const safeJson = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T } catch { return fallback } }
const toTab = (r: RawTab): PriceTab => ({ id: r.id, categoryId: r.categoryId, name: r.name, position: r.position, columns: sanitizeColumns(safeJson<unknown>(r.columnsJson, [])) })
const toRow = (r: RawRow): PriceRow => ({
  id: r.id, tabId: r.tabId, idx: r.idx, kind: (r.kind === 'section' ? 'section' : 'item') as RowKind,
  nameRuns: safeJson(r.nameRunsJson, []), cells: safeJson<Record<string, string>>(r.cellsJson, {})
})
const TAB_COLS = 'id, category_id AS categoryId, name, position, columns_json AS columnsJson'
const ROW_COLS = 'id, tab_id AS tabId, idx, kind, name_runs_json AS nameRunsJson, cells_json AS cellsJson'

export function createPriceListRepo(sqlite: Database.Database, opts: PriceListRepoOptions = {}) {
  const emit = (changes: readonly PriceChange[]): void => { if (changes.length > 0) opts.onChange?.(changes) }
  // tiers
  const tiersLive = sqlite.prepare('SELECT id, key, label, position FROM price_tiers WHERE deleted_at IS NULL ORDER BY position, id')
  const tierKeysAll = sqlite.prepare('SELECT key FROM price_tiers')
  const tierGet = sqlite.prepare('SELECT id FROM price_tiers WHERE id = ?')
  const tierIns = sqlite.prepare('INSERT INTO price_tiers (id, key, label, position, created_at, updated_at, deleted_at, branch_id) VALUES (@id, @key, @label, @position, @at, @at, NULL, @branchId)')
  const tierUpd = sqlite.prepare('UPDATE price_tiers SET label = @label, position = @position, updated_at = @at, deleted_at = NULL, branch_id = @branchId WHERE id = @id')
  const tierDel = sqlite.prepare('UPDATE price_tiers SET deleted_at = @at, updated_at = @at, branch_id = @branchId WHERE id = @id AND deleted_at IS NULL')
  // categories
  const catLive = sqlite.prepare('SELECT id, name, color, position FROM price_categories WHERE deleted_at IS NULL ORDER BY position, id')
  const catGet = sqlite.prepare('SELECT id, name, color, position, deleted_at AS deletedAt FROM price_categories WHERE id = ?')
  const catIns = sqlite.prepare('INSERT INTO price_categories (id, name, color, position, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @name, @color, @position, @at, @at, NULL, @branchId, @seatNo)')
  const catUpd = sqlite.prepare('UPDATE price_categories SET name = @name, color = @color, position = @position, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const catDel = sqlite.prepare('UPDATE price_categories SET deleted_at = @at, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const catRestore = sqlite.prepare('UPDATE price_categories SET name = @name, deleted_at = NULL, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NOT NULL')
  // tabs
  const tabLive = sqlite.prepare(`SELECT t.id, t.category_id AS categoryId, t.name, t.position, t.columns_json AS columnsJson FROM price_tabs t JOIN price_categories c ON c.id = t.category_id WHERE t.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY c.position, c.id, t.position, t.id`)
  const tabGet = sqlite.prepare(`SELECT ${TAB_COLS}, deleted_at AS deletedAt FROM price_tabs WHERE id = ?`)
  const tabIns = sqlite.prepare('INSERT INTO price_tabs (id, category_id, name, position, columns_json, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @categoryId, @name, @position, @columnsJson, @at, @at, NULL, @branchId, @seatNo)')
  const tabUpd = sqlite.prepare('UPDATE price_tabs SET category_id = @categoryId, name = @name, position = @position, columns_json = @columnsJson, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const tabDel = sqlite.prepare('UPDATE price_tabs SET deleted_at = @at, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const tabRestore = sqlite.prepare('UPDATE price_tabs SET name = @name, deleted_at = NULL, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NOT NULL')
  const tabsOfCatLive = sqlite.prepare('SELECT id FROM price_tabs WHERE category_id = ? AND deleted_at IS NULL')
  const tabsOfCatAt = sqlite.prepare('SELECT id, name FROM price_tabs WHERE category_id = ? AND deleted_at = ?')
  const tabNamesLive = sqlite.prepare('SELECT name FROM price_tabs WHERE category_id = ? AND deleted_at IS NULL')
  const catNamesLive = sqlite.prepare('SELECT name FROM price_categories WHERE deleted_at IS NULL')
  // rows
  const rowsLive = sqlite.prepare(`SELECT ${ROW_COLS} FROM price_rows WHERE tab_id = ? AND deleted_at IS NULL ORDER BY idx, id`)
  const rowGet = sqlite.prepare(`SELECT ${ROW_COLS}, deleted_at AS deletedAt, tab_id AS tabIdRaw FROM price_rows WHERE id = ?`)
  const rowIns = sqlite.prepare('INSERT INTO price_rows (id, tab_id, idx, kind, name_runs_json, name_plain, name_norm, cells_json, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @tabId, @idx, @kind, @nameRunsJson, @namePlain, @nameNorm, @cellsJson, @at, @at, NULL, @branchId, @seatNo)')
  const rowUpd = sqlite.prepare('UPDATE price_rows SET tab_id = @tabId, idx = @idx, kind = @kind, name_runs_json = @nameRunsJson, name_plain = @namePlain, name_norm = @nameNorm, cells_json = @cellsJson, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const rowDel = sqlite.prepare('UPDATE price_rows SET deleted_at = @at, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NULL')
  const rowsDelOfTab = sqlite.prepare('UPDATE price_rows SET deleted_at = @at, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE tab_id = @tabId AND deleted_at IS NULL')
  const rowsRestoreOfTab = sqlite.prepare('UPDATE price_rows SET deleted_at = NULL, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE tab_id = @tabId AND deleted_at = @deletedAt')
  const rowRestore = sqlite.prepare('UPDATE price_rows SET deleted_at = NULL, updated_at = @at, branch_id = @branchId, updated_by_seat = @seatNo WHERE id = @id AND deleted_at IS NOT NULL')
  const rowMax = sqlite.prepare('SELECT COALESCE(MAX(idx), -1) AS m FROM price_rows WHERE tab_id = ? AND deleted_at IS NULL')
  const rowCount = sqlite.prepare('SELECT COUNT(*) AS n FROM price_rows WHERE tab_id = ? AND deleted_at IS NULL')
  const rowCountAt = sqlite.prepare('SELECT COUNT(*) AS n FROM price_rows WHERE tab_id = ? AND deleted_at = ?')
  // trash
  const trashCats = sqlite.prepare('SELECT id, name, deleted_at AS deletedAt FROM price_categories WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id')
  const trashTabs = sqlite.prepare(`SELECT t.id, t.name, t.deleted_at AS deletedAt, c.name AS cat FROM price_tabs t JOIN price_categories c ON c.id = t.category_id WHERE t.deleted_at IS NOT NULL AND c.deleted_at IS NULL ORDER BY t.deleted_at DESC, t.id`)
  const trashRows = sqlite.prepare(`SELECT r.id, r.name_plain AS name, r.deleted_at AS deletedAt, t.name AS tab, c.name AS cat FROM price_rows r JOIN price_tabs t ON t.id = r.tab_id JOIN price_categories c ON c.id = t.category_id WHERE r.deleted_at IS NOT NULL AND t.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY r.deleted_at DESC, r.id`)
  const tabIdsOfCat = sqlite.prepare('SELECT id FROM price_tabs WHERE category_id = ?')
  // legacy import map (Phase 237)
  const mapAll = sqlite.prepare('SELECT legacy_key AS legacyKey, row_id AS rowId, source_fingerprint AS fingerprint FROM price_import_map')
  const mapUpsert = sqlite.prepare('INSERT INTO price_import_map (legacy_key, row_id, source_fingerprint, imported_at, edited_since_import) VALUES (@legacyKey, @rowId, @fingerprint, @at, 0) ON CONFLICT(legacy_key) DO UPDATE SET row_id = excluded.row_id, source_fingerprint = excluded.source_fingerprint, imported_at = excluded.imported_at, edited_since_import = 0')

  // sync (Phase 241)
  const syncTier = sqlite.prepare('SELECT id, key, label, position, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, branch_id AS branchId FROM price_tiers WHERE id = ?')
  const syncCat = sqlite.prepare('SELECT id, name, color, position, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, branch_id AS branchId, updated_by_seat AS updatedBySeat FROM price_categories WHERE id = ?')
  const syncTab = sqlite.prepare('SELECT id, category_id AS categoryId, name, position, columns_json AS columnsJson, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, branch_id AS branchId, updated_by_seat AS updatedBySeat FROM price_tabs WHERE id = ?')
  const syncRow = sqlite.prepare('SELECT id, tab_id AS tabId, idx, kind, name_runs_json AS nameRunsJson, cells_json AS cellsJson, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, branch_id AS branchId, updated_by_seat AS updatedBySeat FROM price_rows WHERE id = ?')
  const idsOf: Record<PriceKind, Database.Statement<[]>> = {
    price_tier: sqlite.prepare('SELECT id FROM price_tiers ORDER BY id'), price_category: sqlite.prepare('SELECT id FROM price_categories ORDER BY id'),
    price_tab: sqlite.prepare('SELECT id FROM price_tabs ORDER BY id'), price_row: sqlite.prepare('SELECT id FROM price_rows ORDER BY id')
  }
  const tierByKey = sqlite.prepare('SELECT id FROM price_tiers WHERE key = ? AND id <> ?')
  const tierRename = sqlite.prepare('UPDATE price_tiers SET id = ? WHERE id = ?')
  const tierWrite = sqlite.prepare('INSERT INTO price_tiers (id, key, label, position, created_at, updated_at, deleted_at, branch_id) VALUES (@id, @key, @label, @position, @createdAt, @updatedAt, @deletedAt, @branchId) ON CONFLICT(id) DO UPDATE SET label = excluded.label, position = excluded.position, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, branch_id = excluded.branch_id')
  const catWrite = sqlite.prepare('INSERT INTO price_categories (id, name, color, position, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @name, @color, @position, @createdAt, @updatedAt, @deletedAt, @branchId, @seatNo) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, position = excluded.position, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, branch_id = excluded.branch_id, updated_by_seat = excluded.updated_by_seat')
  const tabWrite = sqlite.prepare('INSERT INTO price_tabs (id, category_id, name, position, columns_json, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @categoryId, @name, @position, @columnsJson, @createdAt, @updatedAt, @deletedAt, @branchId, @seatNo) ON CONFLICT(id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name, position = excluded.position, columns_json = excluded.columns_json, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, branch_id = excluded.branch_id, updated_by_seat = excluded.updated_by_seat')
  const rowWrite = sqlite.prepare('INSERT INTO price_rows (id, tab_id, idx, kind, name_runs_json, name_plain, name_norm, cells_json, created_at, updated_at, deleted_at, branch_id, updated_by_seat) VALUES (@id, @tabId, @idx, @kind, @nameRunsJson, @namePlain, @nameNorm, @cellsJson, @createdAt, @updatedAt, @deletedAt, @branchId, @seatNo) ON CONFLICT(id) DO UPDATE SET tab_id = excluded.tab_id, idx = excluded.idx, kind = excluded.kind, name_runs_json = excluded.name_runs_json, name_plain = excluded.name_plain, name_norm = excluded.name_norm, cells_json = excluded.cells_json, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, branch_id = excluded.branch_id, updated_by_seat = excluded.updated_by_seat')
  const catNamesOther = sqlite.prepare('SELECT name FROM price_categories WHERE deleted_at IS NULL AND id <> ?')
  const tabNamesOther = sqlite.prepare('SELECT name FROM price_tabs WHERE category_id = ? AND deleted_at IS NULL AND id <> ?')
  const rowIdsDeletedAt = sqlite.prepare('SELECT id FROM price_rows WHERE tab_id = ? AND deleted_at = ?')
  const rowIdsRestoredAt = sqlite.prepare('SELECT id FROM price_rows WHERE tab_id = ? AND updated_at = ? AND deleted_at IS NULL')

  const tx = <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  const bind = (s: Stamp) => ({ at: s.at, branchId: s.branchId, seatNo: s.seatNo })

  function restoreTabInternal(id: string, s: Stamp, deletedAt: string): PriceChange[] {
    const t = tabGet.get(id) as (RawTab & { deletedAt: string | null }) | undefined
    if (!t) return []
    const taken = (tabNamesLive.all(t.categoryId) as Array<{ name: string }>).map((r) => r.name)
    tabRestore.run({ id, name: nameKeyOf(t.name) && taken.some((n) => nameKeyOf(n) === nameKeyOf(t.name)) ? uniqueName(t.name, taken) : t.name, ...bind(s) })
    rowsRestoreOfTab.run({ tabId: id, deletedAt, ...bind(s) })
    return [{ kind: 'price_tab', id, deleted: false }, ...(rowIdsRestoredAt.all(id, s.at) as Array<{ id: string }>).map((r): PriceChange => ({ kind: 'price_row', id: r.id, deleted: false }))]
  }

  /** The record with this id in ANY state (live or tombstone), whichever of the four kinds it is; undefined when no such id (purged). */
  function readSync(id: string): PriceRec | undefined {
    const t = syncTier.get(id) as Record<string, unknown> | undefined
    if (t) return { kind: 'price_tier', rec: t as never }
    const c = syncCat.get(id) as Record<string, unknown> | undefined
    if (c) return { kind: 'price_category', rec: c as never }
    const b = syncTab.get(id) as (RawTab & Record<string, unknown>) | undefined
    if (b) { const { columnsJson, ...rest } = b; return { kind: 'price_tab', rec: { ...rest, columns: sanitizeColumns(safeJson<unknown>(columnsJson, [])) } as never } }
    const r = syncRow.get(id) as (RawRow & Record<string, unknown>) | undefined
    if (r) { const { nameRunsJson, cellsJson, kind, ...rest } = r; return { kind: 'price_row', rec: { ...rest, kind: kind === 'section' ? 'section' : 'item', nameRuns: safeJson(nameRunsJson, []), cells: safeJson<Record<string, string>>(cellsJson, {}) } as never } }
    return undefined
  }

  return {
    transaction: tx,

    // ---- tiers
    listTiers: (): PriceTier[] => tiersLive.all() as PriceTier[],
    /** Every tier key ever used, including removed tiers (keys are never reused). */
    allTierKeys: (): string[] => (tierKeysAll.all() as Array<{ key: string }>).map((r) => r.key),
    upsertTier: (t: PriceTier, s: Stamp): void => { (tierGet.get(t.id) ? tierUpd : tierIns).run({ ...t, ...bind(s) }); emit([{ kind: 'price_tier', id: t.id, deleted: false }]) },
    softDeleteTier: (id: string, s: Stamp): boolean => { const ok = tierDel.run({ id, ...bind(s) }).changes > 0; if (ok) emit([{ kind: 'price_tier', id, deleted: true }]); return ok },

    // ---- categories
    listCategories: (): PriceCategory[] => catLive.all() as PriceCategory[],
    getCategory: (id: string): (PriceCategory & { deletedAt: string | null }) | undefined => catGet.get(id) as (PriceCategory & { deletedAt: string | null }) | undefined,
    upsertCategory: (c: PriceCategory, s: Stamp): void => { (catGet.get(c.id) ? catUpd : catIns).run({ ...c, ...bind(s) }); emit([{ kind: 'price_category', id: c.id, deleted: false }]) },
    /** Soft-deletes the category and its live tabs and rows with one `deleted_at`. Returns the tab and row counts moved to the trash. */
    softDeleteCategory: (id: string, s: Stamp): { tabs: number; rows: number } | null => tx(() => {
      if (catDel.run({ id, ...bind(s) }).changes === 0) return null
      let rows = 0
      const tabs = tabsOfCatLive.all(id) as Array<{ id: string }>
      const ch: PriceChange[] = [{ kind: 'price_category', id, deleted: true }]
      for (const t of tabs) {
        rows += rowsDelOfTab.run({ tabId: t.id, ...bind(s) }).changes; tabDel.run({ id: t.id, ...bind(s) })
        ch.push({ kind: 'price_tab', id: t.id, deleted: true }, ...(rowIdsDeletedAt.all(t.id, s.at) as Array<{ id: string }>).map((r): PriceChange => ({ kind: 'price_row', id: r.id, deleted: true })))
      }
      emit(ch)
      return { tabs: tabs.length, rows }
    }),
    restoreCategory: (id: string, s: Stamp): RestoreOutcome => tx(() => {
      const c = catGet.get(id) as { name: string; deletedAt: string | null } | undefined
      if (!c) return 'missing'
      if (c.deletedAt === null) return 'not_deleted'
      const taken = (catNamesLive.all() as Array<{ name: string }>).map((r) => r.name)
      catRestore.run({ id, name: taken.some((n) => nameKeyOf(n) === nameKeyOf(c.name)) ? uniqueName(c.name, taken) : c.name, ...bind(s) })
      const ch: PriceChange[] = [{ kind: 'price_category', id, deleted: false }]
      for (const t of tabsOfCatAt.all(id, c.deletedAt) as Array<{ id: string }>) ch.push(...restoreTabInternal(t.id, s, c.deletedAt))
      emit(ch)
      return 'ok'
    }),

    // ---- tabs
    listTabs: (): PriceTab[] => (tabLive.all() as RawTab[]).map(toTab),
    getTab: (id: string): (PriceTab & { deletedAt: string | null }) | undefined => {
      const r = tabGet.get(id) as (RawTab & { deletedAt: string | null }) | undefined
      return r ? { ...toTab(r), deletedAt: r.deletedAt } : undefined
    },
    upsertTab: (t: PriceTab, s: Stamp): void => { (tabGet.get(t.id) ? tabUpd : tabIns).run({ id: t.id, categoryId: t.categoryId, name: t.name, position: t.position, columnsJson: JSON.stringify(t.columns), ...bind(s) }); emit([{ kind: 'price_tab', id: t.id, deleted: false }]) },
    softDeleteTab: (id: string, s: Stamp): { rows: number } | null => tx(() => {
      if (tabDel.run({ id, ...bind(s) }).changes === 0) return null
      const n = rowsDelOfTab.run({ tabId: id, ...bind(s) }).changes
      emit([{ kind: 'price_tab', id, deleted: true }, ...(rowIdsDeletedAt.all(id, s.at) as Array<{ id: string }>).map((r): PriceChange => ({ kind: 'price_row', id: r.id, deleted: true }))])
      return { rows: n }
    }),
    restoreTab: (id: string, s: Stamp): RestoreOutcome => tx(() => {
      const t = tabGet.get(id) as (RawTab & { deletedAt: string | null }) | undefined
      if (!t) return 'missing'
      if (t.deletedAt === null) return 'not_deleted'
      const c = catGet.get(t.categoryId) as { deletedAt: string | null } | undefined
      if (!c || c.deletedAt !== null) return 'parent_deleted'
      emit(restoreTabInternal(id, s, t.deletedAt))
      return 'ok'
    }),

    // ---- rows
    listRows: (tabId: string): PriceRow[] => (rowsLive.all(tabId) as RawRow[]).map(toRow),
    getRow: (id: string): (PriceRow & { deletedAt: string | null }) | undefined => {
      const r = rowGet.get(id) as (RawRow & { deletedAt: string | null }) | undefined
      return r ? { ...toRow(r), deletedAt: r.deletedAt } : undefined
    },
    nextIdx: (tabId: string): number => (rowMax.get(tabId) as { m: number }).m + 1,
    countRows: (tabId: string): number => (rowCount.get(tabId) as { n: number }).n,
    /** Insert or update (a live row). `name_plain` / `name_norm` are derived here from the runs, so they can never disagree with them. */
    upsertRows: (rows: readonly PriceRow[], s: Stamp): void => {
      for (const r of rows) {
        const p = { id: r.id, tabId: r.tabId, idx: r.idx, kind: r.kind, nameRunsJson: JSON.stringify(r.nameRuns), namePlain: rowPlain(r), nameNorm: rowNameKey(r), cellsJson: JSON.stringify(r.cells), ...bind(s) }
        if (rowGet.get(r.id)) rowUpd.run(p)
        else rowIns.run(p)
      }
      emit(rows.map((r): PriceChange => ({ kind: 'price_row', id: r.id, deleted: false })))
    },
    softDeleteRows: (ids: readonly string[], s: Stamp): number => {
      let n = 0
      const ch: PriceChange[] = []
      for (const id of ids) { const c = rowDel.run({ id, ...bind(s) }).changes; n += c; if (c > 0) ch.push({ kind: 'price_row', id, deleted: true }) }
      emit(ch)
      return n
    },
    restoreRow: (id: string, s: Stamp): RestoreOutcome => tx(() => {
      const r = rowGet.get(id) as (RawRow & { deletedAt: string | null }) | undefined
      if (!r) return 'missing'
      if (r.deletedAt === null) return 'not_deleted'
      const t = tabGet.get(r.tabId) as { categoryId: string; deletedAt: string | null } | undefined
      const c = t ? (catGet.get(t.categoryId) as { deletedAt: string | null } | undefined) : undefined
      if (!t || t.deletedAt !== null || !c || c.deletedAt !== null) return 'parent_deleted'
      rowRestore.run({ id, ...bind(s) })
      emit([{ kind: 'price_row', id, deleted: false }])
      return 'ok'
    }),

    // ---- sync (Phase 241): read a record as the push worker sends it, list ids for the first-sync compare, apply a record from another PC
    getSyncRecord: readSync,
    /** Every id of one kind in any state (for the first-sync compare). */
    listSyncIds: (kind: PriceKind): string[] => (idsOf[kind].all() as Array<{ id: string }>).map((r) => r.id),
    /**
     * A record that came from another PC. Newer (`updatedAt`, then branch id) wins; the same content or an older version changes nothing. The stored
     * `updatedAt` / `branchId` are the incoming ones (so it never looks like a new local change). A live category / tab whose name is taken by
     * another live one gets "name (2)" [A]. A tier whose KEY is already used by another tier id: the smaller id keeps the key (so every PC picks the
     * same one; both PCs seed the same four tiers with different ids); the other one is left out. Never writes the outbox, never hard-deletes.
     */
    applyRemote: (pr: PriceRec): RemotePriceOutcome => {
      const x = pr.rec as unknown as Record<string, unknown> & { id: string; updatedAt: string; branchId: string; createdAt: string; deletedAt: string | null }
      const curOf = (): (Record<string, unknown> & { updatedAt: string; branchId: string }) | undefined => { const r = readSync(x.id); return r && r.kind === pr.kind ? (r.rec as never) : undefined }
      const fp = (cur: Record<string, unknown> | undefined): string | null => (cur ? priceFingerprint(pr.kind, cur) : null)
      const gate = (cur: Record<string, unknown> & { updatedAt: string; branchId: string } | undefined): RemotePriceOutcome | null => {
        if (!cur) return null
        if (fp(cur) === priceFingerprint(pr.kind, x)) return 'ignored'
        return priceIncomingWins(cur, x) ? null : 'ignored'
      }
      const seatNo = typeof x.updatedBySeat === 'number' ? x.updatedBySeat : null
      const base = { id: x.id, createdAt: x.createdAt, updatedAt: x.updatedAt, deletedAt: x.deletedAt, branchId: x.branchId, seatNo }
      switch (pr.kind) {
        case 'price_tier': {
          const rec = pr.rec
          const clash = tierByKey.get(rec.key, rec.id) as { id: string } | undefined
          if (clash) { if (rec.id < clash.id) tierRename.run(rec.id, clash.id); else return 'ignored' }
          const cur = curOf()
          const g = gate(cur); if (g) return g
          tierWrite.run({ id: rec.id, key: rec.key, label: rec.label, position: rec.position, createdAt: rec.createdAt, updatedAt: rec.updatedAt, deletedAt: rec.deletedAt, branchId: rec.branchId })
          return cur ? 'updated' : 'inserted'
        }
        case 'price_category': {
          const rec = pr.rec
          const cur = curOf()
          const g = gate(cur); if (g) return g
          let name = rec.name
          if (rec.deletedAt === null) { const taken = (catNamesOther.all(rec.id) as Array<{ name: string }>).map((r) => r.name); if (taken.some((n) => nameKeyOf(n) === nameKeyOf(name))) name = uniqueName(name, taken) }
          catWrite.run({ ...base, name, color: rec.color, position: rec.position })
          return cur ? 'updated' : 'inserted'
        }
        case 'price_tab': {
          const rec = pr.rec
          const cur = curOf()
          const g = gate(cur); if (g) return g
          let name = rec.name
          if (rec.deletedAt === null) { const taken = (tabNamesOther.all(rec.categoryId, rec.id) as Array<{ name: string }>).map((r) => r.name); if (taken.some((n) => nameKeyOf(n) === nameKeyOf(name))) name = uniqueName(name, taken) }
          tabWrite.run({ ...base, categoryId: rec.categoryId, name, position: rec.position, columnsJson: JSON.stringify(sanitizeColumns(rec.columns)) })
          return cur ? 'updated' : 'inserted'
        }
        case 'price_row': {
          const rec = pr.rec
          const cur = curOf()
          const g = gate(cur); if (g) return g
          const row: PriceRow = { id: rec.id, tabId: rec.tabId, idx: rec.idx, kind: rec.kind, nameRuns: rec.nameRuns as PriceRow['nameRuns'], cells: rec.cells }
          rowWrite.run({ ...base, tabId: row.tabId, idx: row.idx, kind: row.kind, nameRunsJson: JSON.stringify(row.nameRuns), namePlain: rowPlain(row), nameNorm: rowNameKey(row), cellsJson: JSON.stringify(row.cells) })
          return cur ? 'updated' : 'inserted'
        }
      }
    },

    // ---- legacy import map (Phase 237): which Price List row came from which legacy item, and what the import wrote
    listImportMap: (): Array<{ legacyKey: string; rowId: string; fingerprint: string }> => mapAll.all() as Array<{ legacyKey: string; rowId: string; fingerprint: string }>,
    upsertImportMap: (e: { legacyKey: string; rowId: string; fingerprint: string }, at: string): void => { mapUpsert.run({ ...e, at }) },

    // ---- trash (top-level entries only: a tab that went with its category is listed under the category)
    listTrash: (): TrashEntry[] => {
      const out: TrashEntry[] = []
      for (const c of trashCats.all() as Array<{ id: string; name: string; deletedAt: string }>) {
        let count = 0
        for (const t of tabsOfCatAt.all(c.id, c.deletedAt) as Array<{ id: string }>) count += 1 + (rowCountAt.get(t.id, c.deletedAt) as { n: number }).n
        out.push({ kind: 'category', id: c.id, name: c.name, path: c.name, deletedAt: c.deletedAt, count })
      }
      for (const t of trashTabs.all() as Array<{ id: string; name: string; deletedAt: string; cat: string }>) {
        out.push({ kind: 'tab', id: t.id, name: t.name, path: `${t.cat} \u203A ${t.name}`, deletedAt: t.deletedAt, count: (rowCountAt.get(t.id, t.deletedAt) as { n: number }).n })
      }
      for (const r of trashRows.all() as Array<{ id: string; name: string; deletedAt: string; tab: string; cat: string }>) {
        out.push({ kind: 'row', id: r.id, name: r.name, path: `${r.cat} \u203A ${r.tab} \u203A ${r.name}`, deletedAt: r.deletedAt, count: 1 })
      }
      return out.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0))
    },
    /** Hard delete of something that IS in the trash (with its children). Returns whether anything was removed. */
    purge: (kind: TrashKind, id: string): boolean => tx(() => {
      if (kind === 'row') return sqlite.prepare('DELETE FROM price_rows WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes > 0
      if (kind === 'tab') {
        if (sqlite.prepare('SELECT 1 FROM price_tabs WHERE id = ? AND deleted_at IS NOT NULL').get(id) === undefined) return false
        sqlite.prepare('DELETE FROM price_rows WHERE tab_id = ?').run(id)
        return sqlite.prepare('DELETE FROM price_tabs WHERE id = ?').run(id).changes > 0
      }
      if (sqlite.prepare('SELECT 1 FROM price_categories WHERE id = ? AND deleted_at IS NOT NULL').get(id) === undefined) return false
      for (const t of tabIdsOfCat.all(id) as Array<{ id: string }>) sqlite.prepare('DELETE FROM price_rows WHERE tab_id = ?').run(t.id)
      sqlite.prepare('DELETE FROM price_tabs WHERE category_id = ?').run(id)
      return sqlite.prepare('DELETE FROM price_categories WHERE id = ?').run(id).changes > 0
    }),
    /** "Clear Price List": removes every category, tab, row (trash included) and the import map. Tiers are kept [A]. */
    clearAll: (): { categories: number; tabs: number; rows: number } => tx(() => {
      const rows = sqlite.prepare('DELETE FROM price_rows').run().changes
      const tabs = sqlite.prepare('DELETE FROM price_tabs').run().changes
      const categories = sqlite.prepare('DELETE FROM price_categories').run().changes
      sqlite.prepare('DELETE FROM price_import_map').run()
      return { categories, tabs, rows }
    })
  }
}
export type PriceListRepo = ReturnType<typeof createPriceListRepo>
