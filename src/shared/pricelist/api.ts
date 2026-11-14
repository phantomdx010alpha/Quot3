import type { PermFlag, PermFlags } from './perms'
/** Phase 236 (M23) - Price List IPC contract types (pure, zod-free so the renderer may import them). API_CONTRACTS.md M23-7. */
import type { Runs } from '../types'
import type { PriceLogRow } from './apiLog'
import type { ColumnRole, ColumnType, PriceCategory, PriceColumn, PriceRow, PriceTab, PriceTier, RowKind } from './types'

import type { ImportPreview } from './legacyImport'

/** Phase 237: the outcome of `pricelist:importRun` (counts only; `backupFile` is null when nothing needed writing). */
export interface PriceImportRunResult { preview: ImportPreview; added: number; updated: number; backupFile: string | null }

export interface PriceTree { tiers: PriceTier[]; categories: PriceCategory[]; tabs: PriceTab[] }

export interface SaveRowInput { id?: string; idx?: number; kind: RowKind; nameRuns: Runs; cells: Record<string, string> }
export interface SaveRowsInput { tabId: string; rows: SaveRowInput[]; deleteIds?: string[] }
export interface SaveRowsResult { rows: PriceRow[]; deleted: number }

export type StructureInput =
  | { op: 'addCategory'; name: string; color?: string | null }
  | { op: 'renameCategory'; id: string; name: string }
  | { op: 'reorderCategory'; id: string; toIndex: number }
  | { op: 'deleteCategory'; id: string }
  | { op: 'addTab'; categoryId: string; name: string; copyColumnsFromTabId?: string }
  | { op: 'renameTab'; id: string; name: string }
  | { op: 'reorderTab'; id: string; toIndex: number }
  | { op: 'moveTab'; id: string; categoryId: string }
  | { op: 'duplicateTab'; id: string }
  | { op: 'deleteTab'; id: string }
  | { op: 'addTier'; label: string }
  | { op: 'renameTier'; key: string; label: string }
  | { op: 'removeTier'; key: string }
  | { op: 'reorderTier'; key: string; toIndex: number }
/** The fresh tree plus the id of what was created (category / tab / tier), when the op creates one. */
export interface StructureResult { tree: PriceTree; id?: string }

export type ColumnsAction =
  | { action: 'add'; label: string; type?: ColumnType; role?: ColumnRole; tier?: string }
  | { action: 'rename'; key: string; label: string }
  | { action: 'remove'; key: string }
  | { action: 'move'; key: string; toIndex: number }
  | { action: 'update'; key: string; patch: Partial<Pick<PriceColumn, 'label' | 'type' | 'tier' | 'widthPx' | 'align' | 'hidden' | 'frozen' | 'choices'>> }
export type ColumnsInput = { tabId: string } & ColumnsAction
export interface ColumnsResult { columns: PriceColumn[]; key?: string }

export type PriceTrashKind = 'category' | 'tab' | 'row'
export interface PriceTrashEntry { kind: PriceTrashKind; id: string; name: string; path: string; deletedAt: string; count: number }
export interface PriceTrashRef { kind: PriceTrashKind; id: string }

export interface PriceLogPage { rows: PriceLogRow[]; next?: number }
export interface PriceLogQuery { limit?: number; beforeId?: number }

/** Phase 243: where the Activity list comes from (`pricelist:activity`). `server` = the shared log (seat 1), `local` = this PC's own log (no sync, this PC counts as main [A]). */
export type PriceActivitySource = 'server' | 'local'
/** Who sees what: `canView` only for seat 1 (or a PC without sync); `visible` is the `pricelist.log.visible` switch; `retentionDays` is `pricelist.log.retentionDays`. */
export interface PriceActivityAccess { canView: boolean; visible: boolean; source: PriceActivitySource | null; retentionDays: number }
export interface PriceActivityPage { rows: PriceLogRow[]; next?: number; source: PriceActivitySource }
/** CSV text of up to `ACTIVITY_CSV_MAX` newest entries (the renderer saves it as a file). */
export interface PriceActivityCsv { csv: string; count: number; truncated: boolean }
export const ACTIVITY_CSV_MAX = 5000

/** Typed confirmation for "Clear Price List" (design 6; same style as the Start fresh words). */
export const PRICE_CLEAR_WORDS = 'CLEAR PRICE LIST'
export const isPriceClearConfirm = (typed: string): boolean => typed.trim().replace(/\s+/g, ' ').toUpperCase() === PRICE_CLEAR_WORDS

/** Phase 242: what this PC may do in the Price List (`pricelist:perms`). `refused` = how many local changes the main branch did not accept (ids only are kept). */
export interface PriceRightsInfo {
  seatNo: number | null; syncActive: boolean; isSeat1: boolean; flags: PermFlags; refused: number
  /** Phase 255: when this PC last ASKED the server (ISO, null = never), when it last GOT an answer (null = never; then a non-seat-1 PC has no rights), and the plain-words reason the last ask failed ('' = it worked). */
  checkedAt: string | null; answeredAt: string | null; lastError: string
  /** Phase 256: the flags the refused changes were missing ("needs Overwrite"), for the refusal text. */
  refusedNeeds: PermFlag[]
}
/** Phase 242: one seat of the organisation with its Price List rights (`pricelist:permsList`, seat 1 only). */
export interface PriceSeatRightsRow { seatNo: number; branchName: string | null; updatedAt: string | null; flags: PermFlags }
