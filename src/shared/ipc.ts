// Shared IPC contract types (pure, zod-free so the renderer may import them). See API_CONTRACTS.md §2.
import type { ThemeFile } from './theme/validateTheme'
import type { PartyLite } from './party/partyLite'
import type { BillListItem, HistoryBranch, HistoryDate, HistorySource } from './history/historyList'
import type { SearchHit } from './history/historySearch'
import type { DecisionInput, DecisionResult, GroupDetail, GroupSales, ItemsOverview, LastDecisionInfo, OpenTarget, RebuildSummary, UndoOutcome } from './items/api'
import type { DraftSummary } from './draft'
import type { TrashItem } from './trash'
import type { CustomerInput, CustomerRow } from './customers/customerList'
import type { DuplicateSuggestion, MergeResult, UndoMergeResult, UnifyResult } from './customers/duplicates'
import type { ColumnMapping, ImportMode, PartyImportPreview, PartyImportReport, PartyImportSummary, PartyImportUndoResult } from './partyImport/partyImport'
import type { ClashChoice, ImportReport } from './legacyImport/plan'
import type { LegacyBillTag, LegacyPickResult, ReportFormat } from './legacyImport/uiModel'
import type { DashboardStats } from './dashboard/dashboardStats'
import type { CityHit, DashCity, DashTileKey, LiveResult, MetalsData, RatesData, WeatherData } from './dashboard/live'
import type { UpcomingHoliday } from './dashboard/holidays'
import type { BackupInfo, BackupStatus } from './backup/backupRules'
import type { WipeOptions } from './wipe/wipeRules'
import type { ActivateInput, LicenseStatus } from './sync/license'
import type { OutboxStatus } from './sync/outbox'
import type { HeldChange, ResolveHeldInput } from './sync/pull'
import type { ConflictInfo } from './sync/conflict'
import type { SyncOverview } from './sync/manager'
import type { SharedSyncBridge } from './sync/sharedUi'
import type { CutoverBridge } from './sync/cutover'
import type { BootstrapPreview, BootstrapResult } from './sync/bootstrap'
import type { AuditFacets, AuditPage, AuditQuery } from './audit'
import type { CrashNotice, RendererReportKind } from './diagnostics'
import type { UpdateChannel, UpdateState } from './updater'
import type { VersionList } from './rollback'
import type { AppSettingsState, BehaviourSettings } from './settings/appSettings'
import type { RestoreDraft, RevisionDetail, RevisionSummary } from './revisions'
import type { Bill, BillRow, ExtraColDef, FooterExtras, TailRow, IsoDate, IsoDateTime, Paper, PartySnapshot, PrintMode } from './types'
import type { PaperDecision } from './paper/paperTypes'
import type { PrintSettings } from './print/printModel'

/** Phase 27: what the renderer sends to `bills:save` (the server owns branch, PO number, revision, timestamps and the party link). */
export interface SaveBillPayload {
  id: string
  party: PartySnapshot
  formatId: string
  extraCols: ExtraColDef[]
  paperOverride: 'A4' | 'A5' | null
  billDate: IsoDate
  rows: BillRow[]
  /** Phase 79: free extra cells on the footer rows / extra-only tail rows (absent = none). Trimmed again on the server. */
  footerExtras?: FooterExtras
  tailRows?: TailRow[]
}
export interface SaveBillResponse {
  id: string
  poNumber: string
  poSeq: number
  revision: number
  partyId: string | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** Phase 77: the round-off flag the server stamped on this save (from `calc.roundOff`). */
  roundOff?: 0 | 1
}

/** Phase 37: the bill as the renderer holds it, plus the PO number to print. `forced`: 'auto' = ignore the bill's saved override. */
export interface PrintDecideInput {
  /** `roundOff` (Phase 77): the bill's flag, so print / image / copy total exactly like the grid (absent = 0). */
  bill: SaveBillPayload & { poNumber?: string; roundOff?: 0 | 1 }
  mode: PrintMode
  forced?: Paper | 'auto'
}
export interface PrintDecideResponse {
  decision: PaperDecision
  settings: PrintSettings
  switchedByMeasure: boolean
  measureFailed: boolean
  /** Phase 73: true for the instant answer (pure paper engine, nothing measured yet); `print:decide` then returns the measured one. */
  provisional?: boolean
  /** Phase 40: A4 density tier the preview must render at (0 = normal). */
  density: number
}
export interface PrintResponse {
  printed: boolean
  cancelled: boolean
  decision: PaperDecision
  switchedByMeasure: boolean
}

/** Phase 39: what `image:copy` reports - the PNG's real pixel size and the paper the decision chose. */
export interface ImageCopyResponse {
  width: number
  height: number
  paper: Paper
  /** Phase 71: the PNG came from the content-hash cache (a pre-render) rather than a fresh capture. */
  cached?: boolean
  /** Phase 72: the scale the capture used (lower than Settings > Image quality only for a very long bill) and whether the PNG's real width confirmed it. */
  scale?: number
  scaleApplied?: boolean
  /** Dev flag `QUOT3_IMAGE_DEBUG=1` only: the temp PNG path. */
  debugFile?: string
}

/** Phase 38: export the bill as a PDF. `savePath` skips the Save dialog (History / tests); must be absolute and end in `.pdf`. */
export interface PrintPdfInput extends PrintDecideInput {
  ack?: boolean
  savePath?: string
}
export interface PrintPdfResponse {
  saved: boolean
  /** The owner closed the Save dialog (not an error). */
  cancelled: boolean
  filePath: string | null
  pages: number
  decision: PaperDecision
  switchedByMeasure: boolean
}

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT_REVISION'
  | 'DB_ERROR'
  | 'PRINT_FAILED'
  | 'IMAGE_FAILED'
  | 'LICENSE_INVALID'
  | 'SYNC_OFFLINE'
  /** Phase 132 (shared notebook): the seat's e-mail / password was refused, or its login ended. */
  | 'AUTH_FAILED'
  /** Phase 132: the Supabase project answered but is paused (Free plan, about 7 days idle); not the same as offline. */
  | 'SERVER_PAUSED'
  /** Phase 133: the record was set aside because it needs a newer app (`min_reader_ver`); a local edit is blocked. */
  | 'RECORD_ASIDE'
  | 'DECRYPT_FAILED'
  | 'IO_ERROR'
  | 'UNKNOWN'

export interface IpcError {
  code: ErrorCode
  message: string
  details?: unknown
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export interface AppInfo {
  version: string
  dataDir: string
  platform: string
  devMode: boolean
}

export interface DbInfo {
  /** Migrations applied (PRAGMA user_version) and shipped by this build. */
  userVersion: number
  schemaVersion: number
  writable: boolean
  localBranchPrefix: string
  nextPoPreview: string
}

export interface ThemeLoadError {
  file: string
  message: string
}

export interface ThemeListing {
  themes: ThemeFile[]
  errors: ThemeLoadError[]
}

export interface LegacyPreviewResult { sourceLabel: string; poPrefix: string; report: ImportReport; canImport: boolean }
export interface LegacyCommitSummary { batchId: string | null; sourceLabel: string; poPrefix: string; report: ImportReport; backupFile: string | null; reportFile: string | null }
export interface LegacyUndoSummary { deleted: number; keptEdited: Array<{ id: string; poNumber: string }>; alreadyDeleted: number; partiesRemoved: number }
export interface LegacyBatchInfo {
  id: string; at: string; sourceLabel: string; poPrefix: string; filesFound: number; created: number; skipped: number; errors: number
  newParties: number; poFirst: number | null; poLast: number | null; reportFile: string | null; undoneAt: string | null
}

/** Main → renderer events the bridge will subscribe to. Whitelist only. */
export const EVENT_CHANNELS = [
  'sync:status',
  'sync:progress',
  'backup:done',
  'app:before-quit',
  'drafts:recoverable',
  'bills:remoteChanged',
  'updates:state',
  'legacyImport:progress',
  'items:progress'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value)
}

/** Everything the renderer can reach: `window.quot3`. Grows one namespace per phase. */
export interface Quot3Bridge {
  app: {
    getInfo(): Promise<Result<AppInfo>>
    openDataFolder(): Promise<Result<Record<string, never>>>
    getDbInfo(): Promise<Result<DbInfo>>
    /** Phase 28: answer to the `app:before-quit` event once leaving is allowed. */
    confirmQuit(): Promise<Result<Record<string, never>>>
  }
  settings: {
    get(key: string): Promise<Result<{ value: unknown }>>
    set(key: string, value: unknown): Promise<Result<Record<string, never>>>
    getAll(): Promise<Result<Record<string, unknown>>>
  }
  themes: {
    list(): Promise<Result<ThemeListing>>
    reload(): Promise<Result<ThemeListing>>
    load(id: string): Promise<Result<ThemeFile>>
    getActive(): Promise<Result<{ id: string }>>
    setActive(id: string): Promise<Result<{ id: string }>>
    /** Phase 49: opens `%LOCALAPPDATA%\\Quot3\\themes\\` in Explorer. */
    openFolder(): Promise<Result<Record<string, never>>>
    /** Phase 49: writes `<id>-copy.json` (never overwrites) from the computed token values the renderer read; the new theme appears after a reload. */
    exportStarter(id: string, computed: Record<string, string>): Promise<Result<{ file: string; path: string; id: string }>>
    /** Phase 98: recolour the native window-button strip (`titleBarOverlay`) from the live theme tokens. Values are re-parsed in main; Windows only (no-op elsewhere). */
    setTitleBar(input: { bg: string; symbol: string; height: string }): Promise<Result<Record<string, never>>>
  }
  parties: {
    /** Phase 26: every saved (non-deleted) party, name A–Z. */
    list(): Promise<Result<PartyLite[]>>
    /** Phase 26: with `id` update that party; without, update the same-name party or insert a new one. */
    upsert(party: { id?: string; name: string; phone?: string; address?: string; transport?: string }): Promise<Result<{ id: string }>>
  }
  appSettings: {
    /** Phase 48: everything the Settings screens show (company + logo preview, branch / PO prefix + next PO, print defaults, behaviour). */
    get(): Promise<Result<AppSettingsState>>
    /** Phase 48: name is required; phone / address optional. `VALIDATION` carries the message to show. */
    saveCompany(input: { name: string; phone: string; address: string }): Promise<Result<AppSettingsState>>
    /** Phase 48: native Open dialog, then type / size / pixel checks and a copy into assets/. `cancelled` = dialog closed. */
    chooseLogo(): Promise<Result<{ cancelled: boolean; state: AppSettingsState }>>
    removeLogo(): Promise<Result<AppSettingsState>>
    /** Phase 48: new prefix for FUTURE bills only (saved bills keep their number); unique across known branches. */
    savePrefix(prefix: string): Promise<Result<AppSettingsState>>
    savePrint(input: { rupeeOnTotal: boolean; silent: boolean; printer: string }): Promise<Result<AppSettingsState>>
    saveBehaviour(input: BehaviourSettings): Promise<Result<AppSettingsState>>
    /** Phase 72: Image quality (`image.scale`, whole number 2 to 5). */
    saveImage(input: { scale: number }): Promise<Result<AppSettingsState>>
    /** Phase 75: smooth arrow keys (`nav.smoothArrows`, default ON). */
    saveNav(input: { smoothArrows: boolean }): Promise<Result<AppSettingsState>>
    /** Phase 77: round off (`calc.roundOff`, default ON). Applies to bills saved after the change. */
    saveCalc(input: { roundOff?: boolean; percentPresets?: string }): Promise<Result<AppSettingsState>>
    /** Phase 48: installed printer names ([] when none / not available). */
    printers(): Promise<Result<{ printers: string[] }>>
  }
  wipe: {
    /** Phase 90: typed confirmation (`START FRESH` / `FACTORY RESET`), `pre-wipe` backup first, then the app restarts and the wipe is applied at launch. Never sends deletes to other branches. */
    start(options: WipeOptions, confirm: string): Promise<Result<{ restarting: true; backup: string }>>
  }
  publisher: {
    /** Phase 90: puts the publisher email on the clipboard (main writes it; the renderer sends no text). */
    copyEmail(): Promise<Result<{ copied: true }>>
    /** Phase 90: opens the default mail app with a fixed address and subject. */
    openMail(): Promise<Result<{ opened: true }>>
  }
  backup: {
    /** Phase 50: a manual backup now (SQLite online backup, verified after writing). */
    create(): Promise<Result<BackupInfo>>
    /** Phase 50: every backup file, newest first, with size and bill count. */
    list(): Promise<Result<BackupInfo[]>>
    /** Phase 50: startup integrity result, last automatic backup, retention, read-only flag. */
    status(): Promise<Result<BackupStatus>>
    /** Phase 50: needs `confirm` = RESTORE; makes a pre-restore backup, stages the file and restarts the app. */
    restore(file: string, confirm: string): Promise<Result<{ restarting: true; preRestore: string }>>
    delete(file: string): Promise<Result<{ deleted: true }>>
    /** Phase 50: native Open dialog; the file is checked and copied into the list as an `imported` backup (restore it from there). */
    importFile(): Promise<Result<{ cancelled: boolean; backup?: BackupInfo }>>
    /** Phase 50: needs `confirm` = RESET; pre-restore backup first, then an empty database after the restart. */
    resetLocalData(confirm: string): Promise<Result<{ restarting: true; preRestore: string }>>
  }
  license: {
    /** Phase 52: activation state (never the key itself); `check: true` also contacts Supabase and records online / offline / license problem. */
    status(check?: boolean): Promise<Result<LicenseStatus>>
    /** Phase 52: registers this branch with the license (`qt_register_branch`); stores the key and passphrase only via safeStorage. */
    activate(input: ActivateInput): Promise<Result<LicenseStatus>>
    /** Phase 52: needs `confirm` = DEACTIVATE; forgets the license on this computer (bills and the server's branch row are untouched). */
    deactivate(confirm: string): Promise<Result<LicenseStatus>>
  }
  /** Phase 140b: the shared-notebook sign-in, branch name / list and first compare (`syncShared:*`). Answers carry masked hints only. */
  syncShared: SharedSyncBridge
  /** Phase 140b: the move from the old sync (`cutover:*`). Counts and a file name only. */
  cutover: CutoverBridge
  audit: {
    /** Phase 61: one page of the activity log, newest first (filters: entity, action, day range, text). Read-only. */
    list(query: AuditQuery): Promise<Result<AuditPage>>
    /** Phase 61: the entity / action values present, the row count and the retention in days. */
    facets(): Promise<Result<AuditFacets>>
  }
  updates: {
    /** Phase 62: the current update state (never throws; `unavailable` when the app is not installed). */
    state(): Promise<Result<UpdateState>>
    /** Phase 62: check now (manual). Downloads a newer version in the background; never restarts anything. */
    check(): Promise<Result<UpdateState>>
    /** Phase 62: restart and install the downloaded version. Refused while the editor holds an unsaved bill or nothing is downloaded. */
    install(): Promise<Result<Record<string, never>>>
    /** Phase 62: the editor tells main whether an unsaved bill is open (install is refused while true). */
    setBusy(busy: boolean): Promise<Result<Record<string, never>>>
    /** Phase 62: automatic checks, channel and feed address (validated; an invalid address is refused with its reason). */
    setConfig(input: { auto?: boolean; channel?: UpdateChannel; feedUrl?: string }): Promise<Result<UpdateState>>
    /** 0.1.5: the releases that can really be installed (cached a few minutes; `refresh` asks GitHub again), each marked allowed / blocked with a plain reason. */
    listVersions(refresh?: boolean): Promise<Result<VersionList>>
    /** 0.1.5: downloads a version from that list in the background. Installs nothing. Refused with a reason when its data format is older than the bills in use. */
    chooseVersion(version: string): Promise<Result<UpdateState>>
    /** 0.1.5: backup, stay-on-this-version, restart into the downloaded version. Refused while a bill is unsaved. */
    installRollback(): Promise<Result<Record<string, never>>>
    /** 0.1.5: ends "stay on this version" and checks for the newest release. */
    backToLatest(): Promise<Result<UpdateState>>
  }
  diagnostics: {
    /** Phase 61: the renderer reports an error / unhandled rejection / render crash; main logs it scrubbed and throttled. */
    report(input: { kind: RendererReportKind; message: string; stack?: string }): Promise<Result<{ logged: boolean }>>
    /** Phase 61: builds the support text (versions, counts, last log lines; no bill content) and puts it on the clipboard. */
    copy(): Promise<Result<{ chars: number; lines: number }>>
    /** Phase 61: the "did not close properly last time" notice, if one is waiting. */
    crashNotice(): Promise<Result<{ notice: CrashNotice | null }>>
    dismissCrash(): Promise<Result<Record<string, never>>>
  }
  bootstrap: {
    /** Phase 58: what importing this backup (a file already in the backups list, e.g. from `backup.importFile`) would add; writes nothing. */
    preview(file: string): Promise<Result<BootstrapPreview>>
    /** Phase 58: safety backup, optional new PO prefix, then merge the bills / customers / branches of the file (dedupe by bill id, PO numbers kept, never queued for sending). */
    apply(file: string, prefix?: string): Promise<Result<BootstrapResult>>
  }
  sync: {
    /** Phase 54: what is waiting to be sent to the other branches (counts, oldest, the pending and failed lists). Read-only. */
    outbox(): Promise<Result<OutboxStatus>>
    /** Phase 56: tells main which bill the editor has open (null = none), so a change from another branch never lands under it. */
    setEditor(billId: string | null): Promise<Result<{ ok: true }>>
    /** Phase 56: changes from other branches that are waiting for the bill that is open in the editor. */
    held(): Promise<Result<HeldChange[]>>
    /** Phase 56: Keep mine (forget it) or Load theirs (apply it now; the `bills:remoteChanged` event then reloads the editor). */
    resolveHeld(input: ResolveHeldInput): Promise<Result<{ done: boolean }>>
    /** Phase 57: bills where a local edit lost to another branch's change (the lost version is kept in the audit log). */
    conflicts(): Promise<Result<ConflictInfo[]>>
    /** Phase 57: the owner has seen the conflict; clears the `conflict` mark. */
    dismissConflict(billId: string): Promise<Result<{ done: boolean }>>
    /** Phase 59: the headline state and numbers of sync (mode, pending / failed / conflicts, last push / pull, problems). No network. */
    status(): Promise<Result<SyncOverview>>
    /** Phase 59: the owner's on / off switch (refused while no license is activated). Off keeps queuing changes but sends and fetches nothing. */
    setEnabled(enabled: boolean): Promise<Result<SyncOverview>>
    /** Phase 59: put failed changes back in the queue (all, or the given outbox ids) and send soon. */
    retry(ids?: number[]): Promise<Result<{ retried: number; overview: SyncOverview }>>
    /** Phase 59: run one send and one fetch now. */
    now(): Promise<Result<SyncOverview>>
  }
  dashboard: {
    /** Phase 46: the landing-page numbers (today / month / last 7 days / recent bills / top customers / last backup / sync placeholder). */
    stats(): Promise<Result<DashboardStats>>
    /** Phase 125: live data, fetched by the MAIN process only (cached; `offline` = last good value because the network failed). `force` skips a fresh cache. */
    weather(opts?: { force?: boolean }): Promise<Result<LiveResult<WeatherData>>>
    rates(opts?: { force?: boolean }): Promise<Result<LiveResult<RatesData>>>
    metals(opts?: { force?: boolean }): Promise<Result<LiveResult<MetalsData>>>
    /** Phase 125: next holidays from the OFFLINE table (no network). `expired` = the table has nothing left. */
    holidays(count?: number): Promise<Result<{ items: UpcomingHoliday[]; expired: boolean }>>
    /** Phase 125: city search (only the typed name leaves the PC), the saved city (`dash.city`, default Bangalore) and tile on/off flags (`dash.tiles`). */
    searchCities(query: string): Promise<Result<CityHit[]>>
    getCity(): Promise<Result<DashCity>>
    setCity(city: DashCity): Promise<Result<DashCity>>
    getTiles(): Promise<Result<Record<DashTileKey, boolean>>>
    setTiles(tiles: Partial<Record<DashTileKey, boolean>>): Promise<Result<Record<DashTileKey, boolean>>>
  }
  customers: {
    /** Phase 45: every live customer with bill count / last bill date / total billed (live bills only), name A-Z. Search is client-side. */
    list(): Promise<Result<CustomerRow[]>>
    /** Phase 45: add a customer; `VALIDATION` for a blank or already-used name. */
    create(customer: CustomerInput): Promise<Result<{ id: string }>>
    /** Phase 45: replace the four fields of a customer (bills keep their party snapshot). */
    update(id: string, customer: CustomerInput): Promise<Result<{ id: string }>>
    /** Phase 45: soft delete (bills keep their snapshot). */
    delete(id: string): Promise<Result<{ id: string }>>
    /** Phase 45: this customer's live bills, newest first, paged like `history.listBills`. */
    bills(input: { partyId: string; cursor?: string; limit?: number }): Promise<Result<{ items: BillListItem[]; next?: string }>>
    /** Phase 137: customers with similar (never equal) names, strongest rule first; "Not the same" pairs are left out. */
    duplicates(): Promise<Result<DuplicateSuggestion[]>>
    /** Phase 137: merge one customer into another (bills move, blanks filled, one undo step). */
    merge(input: { survivorId: string; mergedId: string }): Promise<Result<MergeResult>>
    /** Phase 137: never suggest this pair again. */
    notSame(input: { aId: string; bId: string }): Promise<Result<{ ok: true }>>
    /** Phase 137: undo the newest merge (or the whole newest unify); `undone: 0` when there is none. */
    undoLastMerge(): Promise<Result<UndoMergeResult>>
    /** Phase 137: the one-time unify of customers with EQUAL names (idempotent; counts only). */
    unify(): Promise<Result<UnifyResult>>
  }
  partyImport: {
    /** Phase 47: native Open dialog; `null` = cancelled. */
    pickFile(): Promise<Result<{ filePath: string } | null>>
    /** Phase 47: read the sheet, auto-detect (or apply) the column mapping, plan the first rows against the saved parties. */
    preview(input: { filePath: string; sheet?: string; headerRow?: number; mapping?: ColumnMapping; mode?: ImportMode }): Promise<Result<PartyImportPreview>>
    /** Phase 47: import (main re-reads the file); one batch that can be undone. */
    commit(input: { filePath: string; sheet?: string; headerRow?: number; mapping: ColumnMapping; mode: ImportMode }): Promise<Result<PartyImportReport>>
    /** Phase 47: remove the parties the import added and restore the ones it updated (anything edited since is kept). */
    undo(importId: string): Promise<Result<PartyImportUndoResult>>
    /** Phase 47: the latest imports, newest first. */
    list(): Promise<Result<PartyImportSummary[]>>
  }
  legacyImport: {
    /** Phase 86: native folder / .json picker. Main keeps the path; the renderer gets an opaque `sourceId`. `null` = cancelled. */
    pick(kind: 'folder' | 'files'): Promise<Result<LegacyPickResult | null>>
    /** Phase 86: read + plan against this database; writes nothing. Progress arrives as `legacyImport:progress`. */
    preview(input: { sourceId: string; choices?: Record<string, ClashChoice> }): Promise<Result<LegacyPreviewResult>>
    /** Phase 86: `pre-import` backup, then ONE all-or-nothing transaction. */
    commit(input: { sourceId: string; choices?: Record<string, ClashChoice>; /** Phase 88: false = do not queue the bills for the other branches (default true). */ send?: boolean }): Promise<Result<LegacyCommitSummary>>
    /** Phase 86: abort the running read (honoured until the write transaction starts). */
    cancel(): Promise<Result<Record<string, never>>>
    /** Phase 86: forget a picked source. */
    release(sourceId: string): Promise<Result<Record<string, never>>>
    /** Phase 86: save the last preview / import report as text or CSV (Save dialog); `null` = cancelled. */
    saveReport(input: { sourceId: string; format: ReportFormat }): Promise<Result<{ saved: true } | null>>
    /** Phase 86: move the batch's untouched bills to Recently deleted; edited bills are kept and listed. */
    undo(batchId: string): Promise<Result<LegacyUndoSummary>>
    /** Phase 86: past imports, newest first. */
    list(): Promise<Result<LegacyBatchInfo[]>>
    /** Phase 86: the old-app reference of a bill, or `null` for a bill made here. */
    billTag(billId: string): Promise<Result<LegacyBillTag | null>>
  }
  items: {
    /** Phase 110: groups (light rows), families, not-items and totals; brings the index up to date first. */
    overview(): Promise<Result<ItemsOverview>>
    /** Phase 110: spellings (with why) and suggested merges of one group. */
    group(input: { groupId: string }): Promise<Result<GroupDetail>>
    /** Phase 110: the group's sales, Non-GST and GST separately; `partyKey` narrows rows and stats to one party. */
    sales(input: { groupId: string; partyKey?: string }): Promise<Result<GroupSales>>
    /** Phase 110: read every bill again (progress arrives as `items:progress`). */
    rebuild(): Promise<Result<RebuildSummary>>
    /** Phase 110: the bill a sales row opens, or `null` when it is gone. */
    openTarget(input: { billId: string }): Promise<Result<OpenTarget | null>>
    /** Phase 113: one owner decision (merge / reject / split / move / ignore) saved as Item rules; never touches a bill. */
    decide(input: DecisionInput): Promise<Result<DecisionResult>>
    /** Phase 113: reverts the newest decision (all rule steps of that one action). */
    undo(): Promise<Result<UndoOutcome>>
    /** Phase 113: what Undo would revert (null = nothing). */
    lastDecision(): Promise<Result<LastDecisionInfo>>
  }
  history: {
    /** Phase 41: bill dates with counts, newest first (`branch` omitted or `'all'` = every branch). */
    listDates(input?: { branch?: string; from?: string; to?: string; source?: HistorySource; batch?: string }): Promise<Result<HistoryDate[]>>
    /** Phase 41: bills newest first, one page at a time (`next` = cursor for the following page). */
    listBills(input?: { date?: string; branch?: string; from?: string; to?: string; source?: HistorySource; batch?: string; cursor?: string; limit?: number }): Promise<Result<{ items: BillListItem[]; next?: string }>>
    /** Phase 42: ranked search (party fuzzy, PO number, item text, amount); every word must match; optional date range. */
    search(input: { query: string; branch?: string; from?: string; to?: string; source?: HistorySource; batch?: string; limit?: number }): Promise<Result<{ items: SearchHit[]; truncated: boolean }>>
    /** Phase 41: branches for the (disabled until sync) filter, local first. */
    branches(): Promise<Result<HistoryBranch[]>>
  }
  trash: {
    /** Phase 43: Recently deleted, most recently deleted first. */
    list(): Promise<Result<TrashItem[]>>
    /** Phase 43: bring bills back (same PO number, revision + 1). */
    restore(input: { ids: string[] }): Promise<Result<{ restored: string[]; missing: string[] }>>
    /** Phase 43: delete trashed bills for good (audited). */
    purge(input: { ids: string[] }): Promise<Result<{ purged: string[]; missing: string[] }>>
    /** Phase 43: purge everything in the trash; `confirm` must be the literal 'EMPTY'. */
    emptyTrash(input: { confirm: 'EMPTY' }): Promise<Result<{ purged: number }>>
  }
  revisions: {
    /** Phase 44: stored revisions of a (live) bill, newest first. */
    list(input: { billId: string }): Promise<Result<RevisionSummary[]>>
    /** Phase 44: one revision as a full bill (for the diff). */
    get(input: { billId: string; revision: number }): Promise<Result<RevisionDetail>>
    /** Phase 44: the revision's content as an UNSAVED change (`billStore.loadDraft(draft, baseline)`); writes nothing. */
    restoreToDraft(input: { billId: string; revision: number }): Promise<Result<RestoreDraft>>
  }
  bills: {
    /** Phase 28: a saved bill, ready for `billStore.loadBill`. */
    getForEdit(id: string): Promise<Result<Bill>>
    /** Phase 42: soft-delete (to the trash). Ids that do not exist / are already deleted come back in `missing`. */
    delete(input: { ids: string[] }): Promise<Result<{ deleted: string[]; missing: string[] }>>
    /** Phase 27: defaults for a new bill (registry default format, the machine's local date, local branch id, next PO preview). */
    newDefaults(): Promise<Result<{ formatId: string; billDate: string; branchId: string; nextPoPreview: string }>>
    /** Phase 27: save (create or update) a bill in one transaction. Server owns PO number / revision / party link. */
    save(input: { bill: SaveBillPayload; expectedRevision?: number }): Promise<Result<SaveBillResponse>>
  }
  drafts: {
    /** Phase 29: create or update ONE draft row (`draftId` = the bill-session id). `payload` is `JSON.stringify(DraftPayload)`. */
    save(input: { draftId?: string; billId?: string; payload: string }): Promise<Result<{ draftId: string; updatedAt: string }>>
    /** Phase 29: recoverable drafts, newest first (unreadable ones are left out). */
    list(): Promise<Result<DraftSummary[]>>
    /** Phase 29: one draft with its bill ready for `billStore.loadDraft`. */
    get(id: string): Promise<Result<{ id: string; billId: string | null; updatedAt: string; bill: Bill }>>
    /** Phase 29: idempotent. */
    delete(id: string): Promise<Result<{ deleted: boolean }>>
  }
  clipboard: {
    /** Phase 16: read the OS clipboard as grid data. `tsv` = plain text; `quot3` = the Quot3 JSON flavour text, only when the OS clipboard still carries it. */
    readGrid(): Promise<Result<{ tsv?: string; quot3?: string }>>
    /** Phase 31: write the whole-bill TSV (`text/plain`) and an HTML table flavour to the OS clipboard. */
    writeTsv(input: { text: string; html?: string }): Promise<Result<Record<string, never>>>
  }
  print: {
    /** Phase 37: the paper decision for the bill (rules + the measured-overflow net) and the settings the preview needs. */
    decide(input: PrintDecideInput): Promise<Result<PrintDecideResponse>>
    /** Phase 73: the same answer WITHOUT the measurement (instant, `provisional: true`) so the dialog opens at once. */
    decideQuick?(input: PrintDecideInput): Promise<Result<PrintDecideResponse>>
    /** Phase 37: print (system dialog, or silent to the configured printer). `ack` is required when the decision `requiresAck`. */
    print(input: PrintDecideInput & { ack?: boolean }): Promise<Result<PrintResponse>>
    /** Phase 38: save the bill as a PDF identical to the print (Save dialog unless `savePath` is given). */
    pdf(input: PrintPdfInput): Promise<Result<PrintPdfResponse>>
    /** Phase 38: open a saved PDF in the OS default viewer. */
    openPdf(input: { filePath: string }): Promise<Result<Record<string, never>>>
  }
  image: {
    /** Phase 39: render the bill (same paper decision as print) and put a tightly cropped PNG on the clipboard. */
    copy(input: { bill: PrintDecideInput['bill']; mode: PrintMode }): Promise<Result<ImageCopyResponse>>
    /** Phase 71: render the PNG in the background into the cache (same input as `copy`); the next `copy` of an unchanged bill is then instant. */
    prerender(input: { bill: PrintDecideInput['bill']; mode: PrintMode }): Promise<Result<{ cached: boolean; skipped?: boolean }>>
  }
  on(channel: EventChannel, callback: (payload: unknown) => void): () => void
}
