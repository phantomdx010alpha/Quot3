import { randomUUID } from 'node:crypto'
import type {
  ColumnsInput, ColumnsResult, PriceLogPage, PriceLogQuery, PriceTrashEntry, PriceTrashRef, PriceTree, SaveRowsInput, SaveRowsResult,
  StructureInput, StructureResult
} from '../../shared/pricelist/api'
import { isPriceClearConfirm } from '../../shared/pricelist/api'
import { addColumn, defaultColumnSet, moveColumn, removeColumn, renameColumn, sanitizeColumns, updateColumn } from '../../shared/pricelist/columns'
import { makeLogEntry, retentionCutoff, type LogEntity, type LogOp } from '../../shared/pricelist/logEntry'
import { sanitizeRow } from '../../shared/pricelist/rows'
import { addCategory, addTab, duplicateTab, moveTabToCategory, renameCategory, renameTab, reorderById, reorderTab } from '../../shared/pricelist/structure'
import { SEED_TIERS, addTier, removeTier, renameTier, reorderTier } from '../../shared/pricelist/tiers'
import { ALL_RIGHTS, missingFlags, notAllowedText, requiredFlags, type PermFlag, type PermFlags, type PermRecord } from '../../shared/pricelist/perms'
import { PRICELIST_LIMITS, type PriceCategory, type PriceRow, type PriceTab } from '../../shared/pricelist/types'
import type { PriceListRepo, Stamp } from '../db/priceListRepo'
import type { PriceLogRepo } from '../db/priceLogRepo'
import { AppError } from '../ipc/envelope'

/**
 * Phase 236 (M23): the Price List on the desktop (MILESTONE23_DESIGN 7.1 / 7.4). Rules come from the shared pure modules (Phase 235);
 * this service only loads, validates, writes in ONE transaction per call and records ONE `price_log` entry per call (never per cell).
 * Not wired to billing, import, sync or seat permissions yet (Phases 237-241). A read-only database refuses every write.
 */
export interface PriceListService {
  tree(): PriceTree
  rows(tabId: string): PriceRow[]
  saveRows(input: SaveRowsInput): SaveRowsResult
  structure(input: StructureInput): StructureResult
  columns(input: ColumnsInput): ColumnsResult
  trash(): PriceTrashEntry[]
  restore(ref: PriceTrashRef): { restored: boolean }
  purge(ref: PriceTrashRef): { purged: boolean }
  /** "Clear Price List": typed confirmation required; a safety backup (`pre-wipe-*`, never auto-removed) is taken first. */
  clearAll(typed: string): Promise<{ categories: number; tabs: number; rows: number }>
  log(q?: PriceLogQuery): PriceLogPage
  /** Removes log entries older than the retention (days, clamped 30..3650). Returns how many. */
  trimLog(): number
}

export interface PriceListDeps { repo: PriceListRepo; logRepo: PriceLogRepo; branchId: () => string | null }
export interface PriceListOpts {
  writable?: boolean
  now?: () => Date
  newId?: () => string
  /** The seat number of this PC when shared sync gives it one (Phase 240); null until then [A]. */
  seatNo?: () => number | null
  /** Phase 242: this PC's rights (`priceRightsService.own`). No option = full rights (no sync, and the older tests). A missing right refuses the change in plain words BEFORE anything is written. */
  rights?: () => PermFlags
  /** Default column set for a new tab (setting `pricelist.defaultColumns`); falls back to Item + one column per tier. */
  defaultColumns?: () => unknown
  /** `pricelist.log.retentionDays` */
  logRetentionDays?: () => number
  /** Safety backup taken before "Clear Price List" (the `pre-wipe` kind, which backups pruning and Start fresh never remove). */
  backupBefore?: () => Promise<unknown>
}

const LOG_PAGE = { dflt: 100, max: 500 } as const

export function createPriceListService({ repo, logRepo, branchId }: PriceListDeps, opts: PriceListOpts = {}): PriceListService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): string => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
    const b = branchId()
    if (!b) throw new AppError('VALIDATION', 'This computer has no branch yet')
    return b
  }
  /** Phase 242: refuses (plain words, nothing written) when this PC lacks a right the change needs. The server checks again on push. */
  const enforce = (need: readonly PermFlag[]): void => {
    const missing = missingFlags(opts.rights?.() ?? ALL_RIGHTS, need)
    if (missing.length > 0) throw new AppError('VALIDATION', notAllowedText(missing))
  }
  const rowRec = (r: { kind: 'item' | 'section'; idx: number; nameRuns: ReadonlyArray<{ t: string }>; cells: Readonly<Record<string, string>> }): PermRecord =>
    ({ kind: 'price_row', rowKind: r.kind, idx: r.idx, name: r.nameRuns.map((n) => n.t).join(''), cells: { ...r.cells } })
  const structureNeeds = (i: StructureInput): PermFlag[] => {
    switch (i.op) {
      case 'deleteCategory': case 'deleteTab': return ['delete']
      case 'removeTier': return ['delete', 'structure'] // the other tiers are renumbered
      case 'duplicateTab': return ['structure', 'add'] // a new tab and a copy of its rows
      default: return ['structure']
    }
  }
  const stampOf = (b: string): Stamp => ({ at: now().toISOString(), branchId: b, seatNo: opts.seatNo?.() ?? null })
  const nameErr = (reason: 'empty' | 'duplicate' | 'missing' | 'limit' | 'name_column'): never => {
    const m: Record<string, string> = {
      empty: 'The name cannot be empty', duplicate: 'That name is already used here', missing: 'That item no longer exists',
      limit: `At most ${PRICELIST_LIMITS.maxColumns} columns per tab`, name_column: 'The item name column cannot be changed that way'
    }
    throw new AppError(reason === 'missing' ? 'NOT_FOUND' : 'VALIDATION', m[reason]!)
  }
  const log = (s: Stamp, entity: LogEntity, entityId: string, op: LogOp, path: string[], extra: { count?: number; changes?: Array<{ column: string; before: string; after: string }> } = {}): void => {
    logRepo.insert(makeLogEntry({ now: new Date(s.at), seatNo: s.seatNo, branchId: s.branchId, deviceKind: 'pc', entity, entityId, op, path, ...extra }))
  }

  // First use: the seed tiers (design 4.1). Only when no tier was EVER stored, so a removed seed tier never comes back by itself.
  const ensureTiers = (): void => {
    if (opts.writable === false || repo.allTierKeys().length > 0) return
    const b = branchId()
    if (!b) return
    const s = stampOf(b)
    repo.transaction(() => SEED_TIERS.forEach((t, i) => repo.upsertTier({ id: newId(), key: t.key, label: t.label, position: i }, s)))
  }
  const treeNow = (): PriceTree => { ensureTiers(); return { tiers: repo.listTiers(), categories: repo.listCategories(), tabs: repo.listTabs() } }
  const newTabColumns = () => {
    const custom = opts.defaultColumns?.()
    return custom !== undefined && Array.isArray(custom) && custom.length > 0 ? sanitizeColumns(custom) : defaultColumnSet(repo.listTiers())
  }
  const liveTab = (id: string): PriceTab => {
    const t = repo.getTab(id)
    if (!t || t.deletedAt !== null) throw new AppError('NOT_FOUND', 'That tab no longer exists')
    return t
  }
  const catName = (id: string): string => repo.getCategory(id)?.name ?? ''

  const saveCategories = (cats: readonly PriceCategory[], s: Stamp): void => {
    const before = new Map(repo.listCategories().map((c) => [c.id, c]))
    for (const c of cats) { const o = before.get(c.id); if (!o || o.name !== c.name || o.position !== c.position || o.color !== c.color) repo.upsertCategory(c, s) }
  }
  const saveTabs = (tabs: readonly PriceTab[], s: Stamp): void => {
    const before = new Map(repo.listTabs().map((t) => [t.id, t]))
    for (const t of tabs) { const o = before.get(t.id); if (!o || o.name !== t.name || o.position !== t.position || o.categoryId !== t.categoryId) repo.upsertTab(t, s) }
  }

  function structure(i: StructureInput): StructureResult {
    const b = guard()
    enforce(structureNeeds(i))
    const s = stampOf(b)
    ensureTiers()
    return repo.transaction(() => {
      const cats = repo.listCategories()
      const tabs = repo.listTabs()
      let id: string | undefined
      switch (i.op) {
        case 'addCategory': {
          id = newId()
          const r = addCategory(cats, i.name, id, i.color ?? null)
          if (!r.ok) return nameErr(r.reason)
          saveCategories(r.value, s)
          log(s, 'category', id, 'structure', [r.value.find((c) => c.id === id)!.name])
          break
        }
        case 'renameCategory': {
          const r = renameCategory(cats, i.id, i.name)
          if (!r.ok) return nameErr(r.reason)
          saveCategories(r.value, s)
          log(s, 'category', i.id, 'structure', [r.value.find((c) => c.id === i.id)!.name])
          break
        }
        case 'reorderCategory': {
          if (!cats.some((c) => c.id === i.id)) return nameErr('missing')
          saveCategories(reorderById(cats, i.id, i.toIndex), s)
          log(s, 'category', i.id, 'structure', [catName(i.id)])
          break
        }
        case 'deleteCategory': {
          const name = catName(i.id)
          const r = repo.softDeleteCategory(i.id, s)
          if (!r) return nameErr('missing')
          log(s, 'category', i.id, 'delete', [name], { count: 1 + r.tabs + r.rows })
          break
        }
        case 'addTab': {
          if (!cats.some((c) => c.id === i.categoryId)) return nameErr('missing')
          id = newId()
          const src = i.copyColumnsFromTabId ? tabs.find((t) => t.id === i.copyColumnsFromTabId) : undefined
          const r = addTab(tabs, i.categoryId, i.name, id, src ? src.columns : newTabColumns())
          if (!r.ok) return nameErr(r.reason)
          saveTabs(r.value, s)
          log(s, 'tab', id, 'add', [catName(i.categoryId), r.value.find((t) => t.id === id)!.name])
          break
        }
        case 'renameTab': {
          const r = renameTab(tabs, i.id, i.name)
          if (!r.ok) return nameErr(r.reason)
          const t = r.value.find((x) => x.id === i.id)!
          saveTabs(r.value, s)
          log(s, 'tab', i.id, 'structure', [catName(t.categoryId), t.name])
          break
        }
        case 'reorderTab': {
          const t = tabs.find((x) => x.id === i.id)
          if (!t) return nameErr('missing')
          saveTabs(reorderTab(tabs, i.id, i.toIndex), s)
          log(s, 'tab', i.id, 'structure', [catName(t.categoryId), t.name])
          break
        }
        case 'moveTab': {
          const t = tabs.find((x) => x.id === i.id)
          if (!t || !cats.some((c) => c.id === i.categoryId)) return nameErr('missing')
          const moved = moveTabToCategory(tabs, i.id, i.categoryId)
          saveTabs(moved, s)
          log(s, 'tab', i.id, 'structure', [catName(i.categoryId), moved.find((x) => x.id === i.id)!.name])
          break
        }
        case 'duplicateTab': {
          const t = tabs.find((x) => x.id === i.id)
          if (!t) return nameErr('missing')
          id = newId()
          const d = duplicateTab(tabs, repo.listRows(i.id), i.id, id, newId)
          if (!d) return nameErr('missing')
          saveTabs(d.tabs, s)
          repo.upsertRows(d.rows, s)
          log(s, 'tab', id, 'add', [catName(t.categoryId), d.tab.name], { count: 1 + d.rows.length })
          break
        }
        case 'deleteTab': {
          const t = tabs.find((x) => x.id === i.id)
          const r = t ? repo.softDeleteTab(i.id, s) : null
          if (!t || !r) return nameErr('missing')
          log(s, 'tab', i.id, 'delete', [catName(t.categoryId), t.name], { count: 1 + r.rows })
          break
        }
        case 'addTier': {
          id = newId()
          const used = new Set(repo.allTierKeys())
          const r = addTier(repo.listTiers(), i.label, id, used)
          if (!r.ok) return nameErr(r.reason === 'limit' ? 'limit' : r.reason)
          repo.upsertTier(r.tier, s)
          log(s, 'tier', id, 'structure', [r.tier.label])
          break
        }
        case 'renameTier': {
          const r = renameTier(repo.listTiers(), i.key, i.label)
          if (!r.ok) return nameErr(r.reason === 'limit' ? 'limit' : r.reason)
          repo.upsertTier(r.tier, s)
          log(s, 'tier', r.tier.id, 'structure', [r.tier.label])
          break
        }
        case 'removeTier': {
          const tiers = repo.listTiers()
          const t = tiers.find((x) => x.key === i.key)
          if (!t) return nameErr('missing')
          repo.softDeleteTier(t.id, s)
          // The remaining tiers keep their order; positions are renumbered so the list stays dense.
          removeTier(tiers, i.key).forEach((x) => repo.upsertTier(x, s))
          log(s, 'tier', t.id, 'delete', [t.label])
          break
        }
        case 'reorderTier': {
          const tiers = repo.listTiers()
          if (!tiers.some((x) => x.key === i.key)) return nameErr('missing')
          reorderTier(tiers, i.key, i.toIndex).forEach((x) => { const o = tiers.find((y) => y.id === x.id)!; if (o.position !== x.position) repo.upsertTier(x, s) })
          log(s, 'tier', tiers.find((x) => x.key === i.key)!.id, 'structure', [tiers.find((x) => x.key === i.key)!.label])
          break
        }
      }
      return { tree: { tiers: repo.listTiers(), categories: repo.listCategories(), tabs: repo.listTabs() }, ...(id ? { id } : {}) }
    })
  }

  return {
    tree: treeNow,
    rows: (tabId) => { liveTab(tabId); return repo.listRows(tabId) },
    saveRows(i) {
      const b = guard()
      const tab = liveTab(i.tabId)
      const s = stampOf(b)
      return repo.transaction(() => {
        const existing = new Map(repo.listRows(i.tabId).map((r) => [r.id, r]))
        let next = repo.nextIdx(i.tabId)
        const saved: PriceRow[] = []
        const changes: Array<{ column: string; before: string; after: string }> = []
        let added = 0
        const need = new Set<PermFlag>()
        for (const r of i.rows) {
          const old = r.id ? existing.get(r.id) : undefined
          if (r.id && !old) throw new AppError('NOT_FOUND', 'A row no longer exists; reload the tab')
          const row = sanitizeRow({ id: old?.id ?? newId(), tabId: i.tabId, idx: r.idx ?? old?.idx ?? next++, kind: r.kind, nameRuns: r.nameRuns, cells: r.cells }, tab.columns)
          saved.push(row)
          for (const f of requiredFlags(old ? rowRec(old) : null, rowRec(row))) need.add(f)
          if (!old) added++
          else for (const c of tab.columns) {
            if (c.role === 'name') continue
            const a = old.cells[c.key] ?? ''; const z = row.cells[c.key] ?? ''
            if (a !== z) changes.push({ column: c.label, before: a, after: z })
          }
        }
        if ((i.deleteIds ?? []).some((id) => existing.has(id))) need.add('delete')
        enforce([...need])
        repo.upsertRows(saved, s)
        const deleted = repo.softDeleteRows((i.deleteIds ?? []).filter((id) => existing.has(id)), s)
        const path = [catName(tab.categoryId), tab.name]
        const first = saved[0]
        if (added > 0) log(s, 'row', first && !existing.has(first.id) ? first.id : tab.id, 'add', path, { count: added })
        if (changes.length > 0) log(s, 'row', saved.find((r) => existing.has(r.id))?.id ?? tab.id, 'edit', path, { changes, count: saved.length - added })
        if (deleted > 0) log(s, 'row', tab.id, 'delete', path, { count: deleted })
        return { rows: saved, deleted }
      })
    },
    structure,
    columns(i) {
      const b = guard()
      enforce(['structure'])
      const tab = liveTab(i.tabId)
      const s = stampOf(b)
      return repo.transaction(() => {
        // Every key ever used on this tab's rows is kept out of reach, so a removed column's key is never reused for new data.
        const used = new Set<string>()
        for (const r of repo.listRows(i.tabId)) for (const k of Object.keys(r.cells)) used.add(k)
        let res
        switch (i.action) {
          case 'add': res = addColumn(tab.columns, { label: i.label, ...(i.type ? { type: i.type } : {}), ...(i.role ? { role: i.role } : {}), ...(i.tier ? { tier: i.tier } : {}) }, used); break
          case 'rename': res = renameColumn(tab.columns, i.key, i.label); break
          case 'remove': res = removeColumn(tab.columns, i.key); break
          case 'move': res = moveColumn(tab.columns, i.key, i.toIndex); break
          case 'update': res = updateColumn(tab.columns, i.key, i.patch); break
        }
        if (!res.ok) return nameErr(res.reason)
        repo.upsertTab({ ...tab, columns: res.columns }, s)
        log(s, 'column', i.tabId, 'structure', [catName(tab.categoryId), tab.name])
        return { columns: res.columns, ...(res.column ? { key: res.column.key } : {}) }
      })
    },
    trash: () => repo.listTrash(),
    restore(ref) {
      const b = guard()
      enforce(ref.kind === 'row' ? ['add'] : ['structure'])
      const s = stampOf(b)
      return repo.transaction(() => {
        const out = ref.kind === 'category' ? repo.restoreCategory(ref.id, s) : ref.kind === 'tab' ? repo.restoreTab(ref.id, s) : repo.restoreRow(ref.id, s)
        if (out === 'missing' || out === 'not_deleted') throw new AppError('NOT_FOUND', 'That item is not in the trash')
        if (out === 'parent_deleted') throw new AppError('VALIDATION', ref.kind === 'row' ? 'Restore its tab first' : 'Restore its category first')
        const rowRef = ref.kind === 'row' ? repo.getRow(ref.id) : undefined
        const where = ref.kind === 'category' ? [catName(ref.id)] : ref.kind === 'tab' ? [repo.getTab(ref.id)?.name ?? ''] : [rowRef ? (repo.getTab(rowRef.tabId)?.name ?? '') : '']
        log(s, ref.kind, ref.id, 'restore', where)
        return { restored: true }
      })
    },
    purge(ref) {
      const b = guard()
      enforce(['delete'])
      const s = stampOf(b)
      const gone = repo.purge(ref.kind, ref.id)
      if (gone) log(s, ref.kind, ref.id, 'delete', [`(removed from the trash)`])
      return { purged: gone }
    },
    async clearAll(typed) {
      const b = guard()
      enforce(['delete', 'structure'])
      if (!isPriceClearConfirm(typed)) throw new AppError('VALIDATION', 'Type CLEAR PRICE LIST to confirm')
      await opts.backupBefore?.()
      const s = stampOf(b)
      return repo.transaction(() => {
        const r = repo.clearAll()
        log(s, 'list', 'all', 'delete', ['Price List'], { count: Math.max(1, r.categories + r.tabs + r.rows) })
        return r
      })
    },
    log(q = {}) {
      const limit = Math.max(1, Math.min(LOG_PAGE.max, Math.round(q.limit ?? LOG_PAGE.dflt)))
      const rows = logRepo.list({ limit: limit + 1, ...(q.beforeId !== undefined ? { beforeId: q.beforeId } : {}) })
      const more = rows.length > limit
      const page = more ? rows.slice(0, limit) : rows
      return { rows: page, ...(more ? { next: page[page.length - 1]!.id } : {}) }
    },
    trimLog() {
      if (opts.writable === false) return 0
      return logRepo.purgeOlderThan(retentionCutoff(now(), opts.logRetentionDays?.() ?? 365).toISOString())
    }
  }
}
