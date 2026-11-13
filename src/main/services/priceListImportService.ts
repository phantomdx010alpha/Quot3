import type { ImportPreview, LegacyInventory } from '../../shared/pricelist/legacyImport'
import { importLogLine, planLegacyImport, type ImportPlan, type PlanState } from '../../shared/pricelist/legacyImport'
import { makeLogEntry } from '../../shared/pricelist/logEntry'
import type { PriceRow, PriceTier } from '../../shared/pricelist/types'
import type { BackupInfo } from '../../shared/backup/backupRules'
import type { PriceListRepo, Stamp } from '../db/priceListRepo'
import type { PriceLogRepo } from '../db/priceLogRepo'
import { ALL_RIGHTS, missingFlags, notAllowedText, type PermFlag, type PermFlags } from '../../shared/pricelist/perms'
import { AppError } from '../ipc/envelope'
import { randomUUID } from 'node:crypto'

/**
 * Phase 237 (M23): the legacy inventory import (docs/PRICELIST_IMPORT_SPEC.md). `preview` writes nothing. `commit` takes the `pre-import`
 * safety backup first, then writes in ONE transaction (structure, rows, import map) with ONE activity-log entry, through the same repo
 * the normal write path uses (so the later sync outbox sees these rows like any edit). Re-run safe; nothing is ever deleted.
 */
export interface PriceImportResult {
  preview: ImportPreview
  added: number
  updated: number
  /** null when there was nothing to write (no backup is taken then). */
  backupFile: string | null
}
export interface PriceImportService {
  preview(file: string): ImportPreview
  commit(file: string): Promise<PriceImportResult>
}
export interface PriceImportDeps {
  repo: PriceListRepo
  logRepo: PriceLogRepo
  branchId: () => string | null
  /** Live tiers; reading them seeds the four seed tiers on first use. */
  tiers: () => PriceTier[]
  readLegacy: (file: string) => LegacyInventory
  backup: { create(kind: 'pre-import'): Promise<BackupInfo> }
}
export interface PriceImportOpts { writable?: boolean; now?: () => Date; newId?: () => string; seatNo?: () => number | null; /** Phase 242: this PC's rights (no option = full rights). */ rights?: () => PermFlags }

export function createPriceListImportService(deps: PriceImportDeps, opts: PriceImportOpts = {}): PriceImportService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const { repo } = deps

  const stateNow = (): PlanState => {
    const categories = repo.listCategories()
    const tabs = repo.listTabs()
    const rowsByTab = new Map<string, readonly PriceRow[]>(tabs.map((t) => [t.id, repo.listRows(t.id)]))
    const map = new Map(repo.listImportMap().map((e) => [e.legacyKey, e]))
    const rowById = new Map<string, { row: PriceRow; deleted: boolean }>()
    for (const e of map.values()) { const r = repo.getRow(e.rowId); if (r) rowById.set(e.rowId, { row: r, deleted: r.deletedAt !== null }) }
    return { tiers: deps.tiers(), categories, tabs, rowsByTab, map, rowById }
  }
  const planFor = (file: string): ImportPlan => planLegacyImport(deps.readLegacy(file), stateNow(), newId)

  return {
    preview: (file) => planFor(file).preview,

    async commit(file) {
      if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
      const branch = deps.branchId()
      if (!branch) throw new AppError('VALIDATION', 'This computer has no branch yet')
      const legacy = deps.readLegacy(file) // read once; a failure here writes nothing and takes no backup
      const first = planLegacyImport(legacy, stateNow(), newId)
      if (first.empty) return { preview: first.preview, added: 0, updated: 0, backupFile: null }
      // Phase 242: an import adds rows and may change existing prices, so it needs add + edit + overwrite (and structure for a new category or tab). Nothing is backed up or written otherwise.
      const need: PermFlag[] = ['add', 'edit', 'overwrite']
      if (first.categories.some((c) => c.isNew) || first.tabs.some((t) => t.isNew)) need.push('structure')
      const missing = missingFlags(opts.rights?.() ?? ALL_RIGHTS, need)
      if (missing.length > 0) throw new AppError('VALIDATION', notAllowedText(missing))
      // Safety first: a pre-import backup of the live database. If this fails nothing has been written.
      const backup = await deps.backup.create('pre-import')
      const stamp: Stamp = { at: now().toISOString(), branchId: branch, seatNo: opts.seatNo?.() ?? null }
      return repo.transaction(() => {
        // Plan again inside the transaction so what is written matches the database at this instant.
        const plan = planLegacyImport(legacy, stateNow(), newId)
        for (const c of plan.categories) if (c.isNew) repo.upsertCategory({ id: c.id, name: c.name, color: null, position: c.position }, stamp)
        for (const t of plan.tabs) if (t.isNew) repo.upsertTab({ id: t.id, categoryId: t.categoryId, name: t.name, position: t.position, columns: t.columns }, stamp)
        for (const op of plan.rows) {
          repo.upsertRows([op.row], stamp)
          repo.upsertImportMap({ legacyKey: op.legacyKey, rowId: op.row.id, fingerprint: op.fingerprint }, stamp.at)
        }
        const added = plan.rows.filter((r) => r.op === 'add').length
        const updated = plan.rows.length - added
        deps.logRepo.insert(makeLogEntry({
          now: new Date(stamp.at), seatNo: stamp.seatNo, branchId: branch, deviceKind: 'pc', entity: 'list', entityId: 'import', op: 'import',
          path: ['Price List', importLogLine(plan.preview)], count: Math.max(1, added + updated + plan.categories.filter((c) => c.isNew).length + plan.tabs.filter((t) => t.isNew).length)
        }))
        return { preview: plan.preview, added, updated, backupFile: backup.file }
      })
    }
  }
}
