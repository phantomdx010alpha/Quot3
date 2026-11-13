import { z } from 'zod'
import type { PriceListService } from '../services/priceListService'
import { PRICELIST_LIMITS } from '../../shared/pricelist/types'
import { randomUUID } from 'node:crypto'
import type { PriceImportService } from '../services/priceListImportService'
import type { PriceRightsService } from '../services/priceRightsService'
import type { PriceActivityService } from '../services/priceActivityService'
import { AppError, wrapHandler } from './envelope'

const COLUMN_TYPE_ENUM = ['text', 'number', 'choice'] as const
const COLUMN_ROLE_ENUM = ['name', 'price', 'unit', 'note', 'other'] as const
const empty = z.object({}).strict()
const id = z.string().min(1).max(64)
const name = z.string().max(PRICELIST_LIMITS.nameMax * 4)
const idx = z.number().int().min(0).max(1_000_000)
const run = z.object({ t: z.string().max(2000), b: z.literal(1).optional(), r: z.literal(1).optional(), hl: z.literal(1).optional() }).strict()
const row = z.object({
  id: id.optional(), idx: idx.optional(), kind: z.enum(['item', 'section']),
  nameRuns: z.array(run).max(200), cells: z.record(z.string().max(40), z.string().max(PRICELIST_LIMITS.cellMax * 4)).refine((o) => Object.keys(o).length <= 40, 'too many cells')
}).strict()
const saveRowsInput = z.object({ tabId: id, rows: z.array(row).max(2000), deleteIds: z.array(id).max(2000).optional() }).strict()

const structureInput = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addCategory'), name, color: z.string().max(20).nullable().optional() }).strict(),
  z.object({ op: z.literal('renameCategory'), id, name }).strict(),
  z.object({ op: z.literal('reorderCategory'), id, toIndex: idx }).strict(),
  z.object({ op: z.literal('deleteCategory'), id }).strict(),
  z.object({ op: z.literal('addTab'), categoryId: id, name, copyColumnsFromTabId: id.optional() }).strict(),
  z.object({ op: z.literal('renameTab'), id, name }).strict(),
  z.object({ op: z.literal('reorderTab'), id, toIndex: idx }).strict(),
  z.object({ op: z.literal('moveTab'), id, categoryId: id }).strict(),
  z.object({ op: z.literal('duplicateTab'), id }).strict(),
  z.object({ op: z.literal('deleteTab'), id }).strict(),
  z.object({ op: z.literal('addTier'), label: name }).strict(),
  z.object({ op: z.literal('renameTier'), key: z.string().min(1).max(PRICELIST_LIMITS.tierKeyMax), label: name }).strict(),
  z.object({ op: z.literal('removeTier'), key: z.string().min(1).max(PRICELIST_LIMITS.tierKeyMax) }).strict(),
  z.object({ op: z.literal('reorderTier'), key: z.string().min(1).max(PRICELIST_LIMITS.tierKeyMax), toIndex: idx }).strict()
])

const colKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/)
const columnsInput = z.discriminatedUnion('action', [
  z.object({ tabId: id, action: z.literal('add'), label: name, type: z.enum(COLUMN_TYPE_ENUM).optional(), role: z.enum(COLUMN_ROLE_ENUM).optional(), tier: z.string().max(PRICELIST_LIMITS.tierKeyMax).optional() }).strict(),
  z.object({ tabId: id, action: z.literal('rename'), key: colKey, label: name }).strict(),
  z.object({ tabId: id, action: z.literal('remove'), key: colKey }).strict(),
  z.object({ tabId: id, action: z.literal('move'), key: colKey, toIndex: idx }).strict(),
  z.object({
    tabId: id, action: z.literal('update'), key: colKey,
    patch: z.object({
      label: name.optional(), type: z.enum(COLUMN_TYPE_ENUM).optional(), tier: z.string().max(PRICELIST_LIMITS.tierKeyMax).optional(),
      widthPx: z.number().min(0).max(5000).optional(), align: z.enum(['left', 'center', 'right']).optional(), hidden: z.boolean().optional(),
      frozen: z.boolean().optional(), choices: z.array(z.string().max(PRICELIST_LIMITS.choiceMax * 4)).max(PRICELIST_LIMITS.choicesMax * 2).optional()
    }).strict()
  }).strict()
])

const trashRef = z.object({ kind: z.enum(['category', 'tab', 'row']), id }).strict()
const tabInput = z.object({ tabId: id }).strict()
const logInput = z.object({ limit: z.number().int().min(1).max(500).optional(), beforeId: z.number().int().min(1).optional() }).strict()
const clearInput = z.object({ typed: z.string().max(100) }).strict()

const permsInput = z.object({ refresh: z.boolean().optional() }).strict()
const permsSetInput = z.object({
  seatNo: z.number().int().min(1).max(50),
  flags: z.object({ add: z.boolean(), edit: z.boolean(), overwrite: z.boolean(), delete: z.boolean(), structure: z.boolean() }).strict()
}).strict()
const sourceInput = z.object({ sourceId: z.string().min(1).max(64) }).strict()
const MAX_SOURCES = 4

/** The legacy-import part of `pricelist:*` (Phase 237): the file dialog and the service. The chosen path stays in main; the renderer holds an opaque `sourceId`. */
export interface PriceImportIpc { service: PriceImportService; pickFile: () => Promise<string | null> }

/** `pricelist:*` handlers (Phase 236; import added in 237). IPC calls the services only; bulk / search / permissions / CSV arrive in later phases. */
export function priceListHandlers(svc: PriceListService, imp?: PriceImportIpc, rights?: PriceRightsService, activity?: PriceActivityService): Record<string, (raw: unknown) => Promise<unknown>> {
  const held = new Map<string, { path: string; label: string }>()
  const get = (id: string): string => {
    const h = held.get(id)
    if (!h) throw new AppError('NOT_FOUND', 'That file is no longer available. Choose it again.')
    return h.path
  }
  const rightsSvc = (): PriceRightsService => { if (!rights) throw new AppError('VALIDATION', 'Rights are not available.'); return rights }
  const activitySvc = (): PriceActivityService => { if (!activity) throw new AppError('VALIDATION', 'The activity list is not available.'); return activity }
  const importer = (): PriceImportIpc => { if (!imp) throw new AppError('VALIDATION', 'The import is not available.'); return imp }
  return {
    'pricelist:importPick': wrapHandler(empty, async () => {
      const path = await importer().pickFile()
      if (!path) return null
      const id = randomUUID()
      held.set(id, { path, label: path.split(/[\\/]/).pop() ?? 'Chosen file' })
      while (held.size > MAX_SOURCES) held.delete(held.keys().next().value as string)
      return { sourceId: id, label: held.get(id)!.label }
    }),
    'pricelist:importPreview': wrapHandler(sourceInput, (i) => importer().service.preview(get(i.sourceId))),
    'pricelist:importRun': wrapHandler(sourceInput, (i) => importer().service.commit(get(i.sourceId))),
    'pricelist:activityAccess': wrapHandler(empty, () => activitySvc().access()),
    'pricelist:activity': wrapHandler(logInput, (i) => activitySvc().list(i)),
    'pricelist:activityCsv': wrapHandler(empty, () => activitySvc().csv()),
    'pricelist:perms': wrapHandler(permsInput, async (i) => (i.refresh === true ? rightsSvc().refresh() : rightsSvc().info())),
    'pricelist:permsList': wrapHandler(empty, () => rightsSvc().list()),
    'pricelist:permsSet': wrapHandler(permsSetInput, (i) => rightsSvc().set(i.seatNo, i.flags)),
    'pricelist:tree': wrapHandler(empty, () => svc.tree()),
    'pricelist:rows': wrapHandler(tabInput, (i) => svc.rows(i.tabId)),
    'pricelist:saveRows': wrapHandler(saveRowsInput, (i) => svc.saveRows(i as Parameters<PriceListService['saveRows']>[0])),
    'pricelist:structure': wrapHandler(structureInput, (i) => svc.structure(i as Parameters<PriceListService['structure']>[0])),
    'pricelist:columns': wrapHandler(columnsInput, (i) => svc.columns(i as Parameters<PriceListService['columns']>[0])),
    'pricelist:trash': wrapHandler(empty, () => svc.trash()),
    'pricelist:restore': wrapHandler(trashRef, (i) => svc.restore(i)),
    'pricelist:purge': wrapHandler(trashRef, (i) => svc.purge(i)),
    'pricelist:clear': wrapHandler(clearInput, (i) => svc.clearAll(i.typed)),
    'pricelist:log': wrapHandler(logInput, (i) => svc.log(i))
  }
}
