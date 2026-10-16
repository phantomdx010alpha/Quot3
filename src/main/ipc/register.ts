import { clipboard, ClipboardItem, ipcMain, shell } from 'electron'
import { z } from 'zod'
import type { AppInfo } from '../../shared/ipc'
import type { Logger } from '../logger'
import type { DbInfo } from '../../shared/ipc'
import type { SettingsService } from '../services/settingsService'
import type { ThemeService } from '../services/themeService'
import { AppError, fail, wrapHandler } from './envelope'
import { settingsHandlers } from './settings'
import { themeHandlers } from './themes'
import { partyHandlers } from './parties'
import { customerHandlers } from './customers'
import { partyImportHandlers, type FilePicker } from './partyImport'
import { legacyImportHandlers, type LegacyIpcDeps } from './legacyImport'
import { legacyWatchHandlers } from './legacyWatch'
import { LEGACY_WATCH_KEYS } from '../../shared/legacyWatch/watchConfig'
import type { LegacyWatchService } from '../services/legacyWatchService'
import type { LegacyWatchApply } from '../services/legacyWatchApply'
import type { LegacyImportService } from '../services/legacyImportService'
import { backupHandlers } from './backup'
import { publisherHandlers, wipeHandlers, type PublisherPorts } from './wipe'
import type { WipeService } from '../services/wipeService'
import { bootstrapHandlers } from './bootstrap'
import { licenseHandlers } from './license'
import { syncHandlers } from './sync'
import { syncSharedHandlers } from './syncShared'
import { cutoverHandlers } from './cutover'
import type { SharedSyncService } from '../sync/sharedSyncService'
import type { CutoverService } from '../sync/cutoverService'
import { auditHandlers } from './audit'
import { updateHandlers } from './updates'
import type { UpdateService } from '../services/updateService'
import type { AuditService } from '../services/auditService'
import type { DiagnosticsService } from '../services/diagnosticsService'
import type { Outbox } from '../sync/outbox'
import type { RemoteApplier } from '../sync/remoteApplier'
import type { SyncManager } from '../sync/syncManager'
import type { LicenseService } from '../sync/licenseService'
import type { BackupService } from '../services/backupService'
import type { BootstrapService } from '../sync/bootstrapService'
import type { PartyImportService } from '../services/partyImportService'
import { dashboardHandlers } from './dashboard'
import { dashboardLiveHandlers } from './dashboardLive'
import type { DashboardLiveService } from '../services/dashboardLiveService'
import { appSettingsHandlers } from './appSettings'
import type { AppSettingsService } from '../services/appSettingsService'
import type { DashboardService } from '../services/dashboardService'
import type { CustomerService } from '../services/customerService'
import { historyHandlers } from './history'
import { itemsHandlers } from './items'
import type { ItemsService } from '../services/itemsService'
import { draftHandlers } from './drafts'
import { billHandlers } from './bills'
import type { BillService } from '../services/billService'
import type { PartyService } from '../services/partyService'
import type { HistoryService } from '../services/historyService'
import type { DraftService } from '../services/draftService'
import type { TrashService } from '../services/trashService'
import { trashHandlers } from './trash'
import type { RevisionService } from '../services/revisionService'
import { revisionHandlers } from './revisions'
import { clipboardHandlers, type ClipboardPort } from './clipboard'
import { printHandlers } from './print'
import { imageHandlers } from './image'
import type { ImageService } from '../services/imageService'
import type { PrintService } from '../services/printService'

export interface IpcContext {
  info: AppInfo
  log: Logger
  themes: ThemeService
  settings: SettingsService
  /** Phase 48: the Settings screens (company, logo, PO prefix, print defaults, behaviour). */
  appSettings: AppSettingsService
  parties: PartyService
  customers: CustomerService
  partyImport: PartyImportService
  /** Phase 86: the old-app bill import (the service from Phase 85 plus its native dialogs / progress event). */
  legacyImport: LegacyImportService
  legacyDeps: LegacyIpcDeps
  /** Phase 160: the legacy folder watcher (status / scan now / pause). */
  legacyWatch: LegacyWatchService
  /** Phase 163: the engine behind Needs review / Activity. */
  legacyWatchApply: LegacyWatchApply
  /** Phase 50: backups, restore, import, reset. */
  backup: BackupService
  /** Phase 90: Start fresh (Level 1 / 2) and the About publisher contact. */
  wipe: WipeService
  publisher: PublisherPorts
  /** Phase 58: merge a backup from another branch into this computer (new-branch bootstrap). */
  bootstrap: BootstrapService
  /** Phase 52: license activation, branch registration. */
  license: LicenseService
  /** Phase 54: local change capture (read-only view over IPC). */
  outbox: Outbox
  /** Phase 59: on / off switch, status, retry and Sync now. */
  syncManager?: SyncManager
  /** Phase 140b: the shared-notebook sign-in, branch calls and first compare (`syncShared:*`). */
  sharedSync?: SharedSyncService
  /** Phase 140b: the move from the old sync to the shared notebook (`cutover:*`). */
  cutover?: CutoverService
  /** Phase 61: the activity log viewer. */
  audit: AuditService
  /** Phase 61: renderer error reports, Copy diagnostics, the launch crash notice. */
  diagnostics: DiagnosticsService
  /** Phase 62: check / download / install updates. */
  updates: UpdateService
  /** Phase 56: applies changes from other branches; knows which bill the editor has open. */
  remote: RemoteApplier
  filePicker: FilePicker
  dashboard: DashboardService
  /** Phase 125: weather / rates / metals (main-process network) + offline holidays. */
  dashboardLive: DashboardLiveService
  /** Phase 41: read-only History lists. */
  history: HistoryService
  /** Phase 110: the Items read model (groups, sales). */
  items: ItemsService
  /** Phase 110: sends `items:progress` to the window during a rebuild. */
  itemsEmit: (channel: 'items:progress', payload: { done: number; total: number }) => void
  drafts: DraftService
  bills: BillService
  /** Phase 43: Recently deleted (restore / purge). */
  trash: TrashService
  /** Phase 44: revision history (list / get / restore as an unsaved draft). */
  revisions: RevisionService
  /** Phase 37: decide the paper and print. */
  print: PrintService
  /** Phase 39: copy the bill as an image. */
  image: ImageService
  /** Phase 28: the renderer allowed leaving; really quit now. */
  confirmQuit: () => void
  /** Live DB facts for the dev "DB info" line. */
  dbInfo: () => DbInfo
  /** Sender-frame check; calls from any other page are refused. */
  isTrustedSender: (url: string) => boolean
}

const emptyInput = z.object({}).strict()
const appInfoSchema = z.object({
  version: z.string(),
  dataDir: z.string(),
  platform: z.string(),
  devMode: z.boolean()
})
const emptyOutput = z.object({}).strict()

type RawHandler = (raw: unknown) => Promise<unknown>

/**
 * Electron 44's clipboard is async (`readText`, `read` → web ClipboardItems; no `readBuffer`). A custom flavour can only be
 * found when it is among the item types (Chromium prefixes web custom formats with `web `); absent → `null`, never throws.
 */
function electronClipboardPort(): ClipboardPort {
  return {
    readText: () => clipboard.readText(),
    // Electron 44: one atomic write of every flavour as a web ClipboardItem (text/plain for Excel cells, text/html table).
    write: async ({ text, html }) => { await clipboard.write([new ClipboardItem(html === undefined ? { 'text/plain': text } : { 'text/plain': text, 'text/html': html })]) },
    readFlavour: async (format) => {
      try {
        const items = await clipboard.read()
        for (const item of items) {
          const type = item.types.find((t) => t === format || t === `web ${format}`)
          if (type) {
            const blob = await item.getType(type)
            if ('text' in blob) return await blob.text()
          }
        }
      } catch { /* unreadable clipboard */ }
      return null
    }
  }
}

/** Registers every IPC channel. Later phases add `<ns>.ts` modules and list them here. */
export function registerIpc(ctx: IpcContext): void {
  const handlers: Record<string, RawHandler> = {
    'app:getInfo': wrapHandler(emptyInput, () => ctx.info, appInfoSchema),
    'app:openDataFolder': wrapHandler(
      emptyInput,
      async () => {
        const err = await shell.openPath(ctx.info.dataDir)
        if (err) {
          ctx.log.warn('openDataFolder failed', { err })
          throw new AppError('IO_ERROR', 'Could not open the data folder')
        }
        return {}
      },
      emptyOutput
    ),
    'app:getDbInfo': wrapHandler(emptyInput, () => ctx.dbInfo()),
    'app:confirmQuit': wrapHandler(emptyInput, () => { ctx.confirmQuit(); return {} }, emptyOutput),
    ...themeHandlers(ctx.themes),
    ...settingsHandlers(ctx.settings),
    ...appSettingsHandlers(ctx.appSettings),
    ...partyHandlers(ctx.parties),
    ...customerHandlers(ctx.customers),
    ...partyImportHandlers(ctx.partyImport, ctx.filePicker),
    ...legacyImportHandlers(ctx.legacyImport, ctx.legacyDeps),
    ...legacyWatchHandlers(ctx.legacyWatch, {
      pickFolder: () => ctx.legacyDeps.picker.pickFolder(),
      saveFolder: (path) => { ctx.settings.set(LEGACY_WATCH_KEYS.folder, path) }
    }, ctx.legacyWatchApply),
    ...backupHandlers(ctx.backup),
    ...wipeHandlers(ctx.wipe),
    ...publisherHandlers(ctx.publisher),
    ...bootstrapHandlers(ctx.bootstrap),
    ...licenseHandlers(ctx.license),
    ...auditHandlers(ctx.audit, ctx.diagnostics),
    ...updateHandlers(ctx.updates),
    ...syncHandlers(ctx.outbox, ctx.remote, ctx.syncManager),
    ...(ctx.sharedSync ? syncSharedHandlers(ctx.sharedSync) : {}),
    ...(ctx.cutover ? cutoverHandlers(ctx.cutover) : {}),
    ...dashboardHandlers(ctx.dashboard),
    ...dashboardLiveHandlers(ctx.dashboardLive),
    ...historyHandlers(ctx.history),
    ...itemsHandlers(ctx.items, ctx.itemsEmit),
    ...billHandlers(ctx.bills),
    ...trashHandlers(ctx.trash),
    ...revisionHandlers(ctx.revisions),
    ...draftHandlers(ctx.drafts),
    ...printHandlers(ctx.print),
    ...imageHandlers(ctx.image),
    ...clipboardHandlers(electronClipboardPort())
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, raw: unknown) => {
      const url = event.senderFrame?.url ?? ''
      if (!ctx.isTrustedSender(url)) {
        ctx.log.warn('IPC call from untrusted sender refused', { channel })
        return fail('VALIDATION', 'Untrusted sender')
      }
      return handler(raw)
    })
  }
}
