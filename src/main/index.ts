import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { arch, homedir, platform, release } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, shell } from 'electron'
import { registerIpc } from './ipc/register'
import { createLogger } from './logger'
import { createStartupMarks } from '../shared/perf/startupMarks'
import { createCrashState, installCrashHandlers } from './crash'
import { createAuditRepo } from './db/auditRepo'
import { createDiagnosticsRepo } from './db/diagnosticsRepo'
import { createAuditService } from './services/auditService'
import { createDiagnosticsService } from './services/diagnosticsService'
import { createUpdateService } from './services/updateService'
import { createElectronUpdaterPort } from './services/updaterPort'
import { openDatabase } from './db/connection'
import { getLocalBranch } from './db/seed'
import { peekNextPoNumber } from './db/poCounter'
import { createSettingsRepo } from './db/settingsRepo'
import { createPartyRepo } from './db/partyRepo'
import { seedHistoricalBills } from './services/seedHistory'
import { createPartyService } from './services/partyService'
import { createHistoryRepo } from './db/historyRepo'
import { createHistoryService } from './services/historyService'
import { createItemsRepo } from './db/itemsRepo'
import { createItemsService } from './services/itemsService'
import { createItemRulesRepo } from './db/itemRulesRepo'
import { ITEM_RULE_REVISION } from '../shared/sync/itemRule'
import { createItemRuleApplier } from './sync/itemRuleApplier'
import { createBillRepo } from './db/billRepo'
import { createBillService } from './services/billService'
import { readRoundOffSetting } from '../shared/calc/billOptions'
import { createDraftRepo } from './db/draftRepo'
import { createDraftService } from './services/draftService'
import { createTrashRepo } from './db/trashRepo'
import { createCustomerRepo } from './db/customerRepo'
import { createDashboardRepo } from './db/dashboardRepo'
import { createBranchRepo } from './db/branchRepo'
import { createAppSettingsService } from './services/appSettingsService'
import { createElectronSettingsPorts } from './import/electronSettingsPorts'
import { createDashboardService, latestBackupTime } from './services/dashboardService'
import { createDashboardLiveService } from './services/dashboardLiveService'
import { createFetchDashHttp } from './services/dashboardHttp'
import { createCustomerService } from './services/customerService'
import { createPartyImportService } from './services/partyImportService'
import { createPartyImportRepo } from './db/partyImportRepo'
import { createExcelSheetReader } from './import/excelSheetReader'
import { createElectronFilePicker } from './import/electronFilePicker'
import { createElectronLegacyPicker, writeReportFile } from './import/electronLegacyPicker'
import { createLegacyImportService } from './services/legacyImportService'
import { createLegacyImportRepo } from './db/legacyImportRepo'
import { createTrashService } from './services/trashService'
import { createRevisionService } from './services/revisionService'
import { createSettingsService } from './services/settingsService'
import { createPrintService } from './services/printService'
import { createElectronPrintPort } from './print/electronPrintPort'
import { createElectronPdfFiles } from './print/electronPdfFiles'
import { createElectronImagePort } from './print/electronImagePort'
import { createImageService } from './services/imageService'
import { readImageScale } from '../shared/print/imageFlow'
import { createThemeService } from './services/themeService'
import { createBackupService } from './services/backupService'
import { createGithubReleaseFeed } from './services/releaseFeed'
import { createLicenseService } from './sync/licenseService'
import { createBootstrapService } from './sync/bootstrapService'
import { createBootstrapRepo } from './db/bootstrapRepo'
import { createOutbox } from './sync/outbox'
import { createPushWorker } from './sync/pushWorker'
import { createPullWorker } from './sync/pullWorker'
import { createSyncManager } from './sync/syncManager'
import { createSharedActivation } from './sync/activationV2'
import { createSharedBranches } from './sync/sharedBranches'
import { createSharedSyncService, singleFlightCompare } from './sync/sharedSyncService'
import { createCutoverService } from './sync/cutoverService'
import { createCompareService } from './sync/compareService'
import { createLocalCompareSources } from './sync/billRecordV2'
import { createPushWorkerV2 } from './sync/pushWorkerV2'
import { createPullWorkerV2 } from './sync/pullWorkerV2'
import { createRecordApplierV2 } from './sync/recordApplierV2'
import { createAsideService } from './sync/asideService'
import { createAsideApply, createHeldService } from './sync/heldService'
import { createDoorbell } from './sync/doorbell'
import { createWorkerSwitch, type WorkerSwitch } from './sync/workerSwitch'
import { readClock } from './sync/sharedState'
import type { SharedBranch } from './sync/sharedTransport'
import type { RemoteApplier } from './sync/remoteApplier'
import { SHARED_POLL_MS, type PullStatus } from '../shared/sync/pull'
import type { PushStatus } from '../shared/sync/push'
import { partyRecordId } from '../shared/customers/duplicates'
import { createRemoteApplier } from './sync/remoteApplier'
import { createRemoteApplyRepo } from './db/remoteApplyRepo'
import { createOutboxRepo } from './db/outboxRepo'
import { createSyncStateRepo } from './db/syncStateRepo'
import { createSyncRecordRepo } from './db/syncRecordRepo'
import { createElectronSecretStore } from './sync/electronSecretStore'
import { SupabaseTransport } from './sync/transport'
import { SupabaseSharedTransport } from './sync/sharedTransport'
import { createBackupRepo } from './db/backupRepo'
import { applyPendingRestore } from './db/pendingRestore'
import { applyPendingWipeData } from './db/wipeApply'
import { createWipeService } from './services/wipeService'
import { createElectronBackupPorts } from './import/electronBackupPorts'
import { dataLayout, ensureDataDirs, resolveDataDir } from './paths'
import { isTrustedUrl } from './security'
import { createMainWindow, installSessionSecurity } from './window'
import { resolveAppIcon } from './appIcon'
import { resolveRuntimePaths } from './runtimePaths'
import { APP_ID, APP_NAME } from '../shared/appInfo'

const isDev = !app.isPackaged
// Phase 64: shipped files (migrations, fonts, icons) - beside the asar when installed, in the source tree in dev.
const runtimePaths = resolveRuntimePaths({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() })
const devUrl = isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined

// Phase 2: data lives under %LOCALAPPDATA%\Quot3 (not Roaming). MUST run before app is ready.
const layout = dataLayout(
  resolveDataDir({ platform: process.platform, env: process.env, homedir: homedir() })
)
ensureDataDirs(layout)
app.setName(APP_NAME)
// Phase 63: a stable Windows AppUserModelID so the taskbar icon, pins and notifications belong to Quot3 (matches the installer appId, Phase 64).
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)
app.setPath('userData', layout.root)

const log = createLogger({ dir: layout.logs, echo: isDev })
// Phase 61: crash bookkeeping + global error handlers (main process). Scrubbed log lines only; never any bill content.
const crashState = createCrashState({ dir: layout.logs, version: app.getVersion() })
installCrashHandlers({ proc: process, app, log, state: crashState, home: homedir() })

// Phase 68: start-up timing (ms since the process started); one log line is written when the page has loaded.
const startup = createStartupMarks(() => process.uptime() * 1000)
// Phase 154: several windows (instances) share this ONE main process, one database handle and one PO counter, so two windows can never
// be given the same PO number (the number is allocated inside the save transaction, `allocatePoNumber`). Events go to every window.
const windows = new Set<BrowserWindow>()
const broadcast = (channel: string, payload: unknown): void => {
  for (const w of windows) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload)
}
/** The window that asked to close and is waiting for its unsaved-changes answer (`app:confirmQuit`). */
let askingToClose: BrowserWindow | null = null
const confirmedClose = new WeakSet<BrowserWindow>()
let openWindowRef: ((first: boolean) => BrowserWindow) | null = null
const openWindow = (first: boolean): void => { openWindowRef?.(first) }
/** Phase 28: the window close button is held until the renderer's unsaved-changes guard answers (`app:confirmQuit`). */
let quitConfirmed = false

// Single-instance lock: a second launch just focuses the first window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Phase 154: launching Quot3 again opens one more window in this process (no second process, so one database writer).
  app.on('second-instance', () => {
    if (windows.size === 0) return
    openWindow(false)
  })

  void app.whenReady().then(() => {
    startup.mark('app_ready')
    const trust = { devUrl, rendererDir: join(__dirname, '../renderer') }
    log.info('Quot3 starting', { version: app.getVersion(), dataDir: layout.root, isDev })
    // Phase 61: was the last run closed properly? (the notice is shown on the Dashboard until dismissed)
    const started = crashState.begin()
    if (started.fresh) log.warn('The previous run did not close properly', { kind: started.notice?.kind })
    app.on('will-quit', () => crashState.end())
    // Phase 5: open the real database (migrations + pre-migration backup + local branch seed).
    // Migrations: source tree in dev, `resources/migrations` when installed (Phase 64 extraResources).
    // Phase 50: a Restore / Reset staged by the previous run is applied BEFORE the database is opened.
    const pending = applyPendingRestore(layout.root, join(layout.root, 'quot3.db'))
    if (pending.applied) log.warn('Applied a staged change to the database file', { action: pending.applied })
    if (pending.error) log.error('Could not apply the staged restore / reset', { error: pending.error })
    const wipeStaged = pending.applied === 'wipe'
    const dbh = openDatabase({
      file: join(layout.root, 'quot3.db'),
      migrationsDir: runtimePaths.migrationsDir,
      backupsDir: layout.backups,
      log
    })
    startup.mark('db_open')
    const settings = createSettingsService(createSettingsRepo(dbh.sqlite), { writable: dbh.writable })
    // Phase 61: the audit log service (bill create / edit / delete / restore, backup restore / reset / import, crash recovery; older writers keep their own inserts).
    const audit = createAuditService(
      { repo: createAuditRepo(dbh.sqlite), branchId: () => (dbh.writable ? getLocalBranch(dbh.sqlite).id : null), retention: () => settings.get('audit.retentionDays'), log },
      { writable: dbh.writable }
    )
    if (pending.applied && pending.applied !== 'wipe') audit.record({ entity: 'backup', action: pending.applied, detail: { staged: true } })
    // Phase 90: a staged Start fresh finishes here (data clear for Level 1, PO restart number for both). Never queued for sync.
    if (wipeStaged && dbh.writable) {
      const w = applyPendingWipeData(dbh.sqlite, layout.root)
      if (w.applied) { log.warn('Start fresh applied', { level: w.applied.level, poStart: w.applied.poStart }); audit.record({ entity: 'backup', action: 'wipe', detail: { level: w.applied.level, poStart: w.applied.poStart, cleared: w.applied.cleared } }) }
      if (w.error) log.error('Could not finish the staged Start fresh', { error: w.error })
    }
    if (started.fresh && started.notice) audit.record({ entity: 'app', action: 'crash_recovered', detail: { kind: started.notice.kind, at: started.notice.at } })
    const appSettings = createAppSettingsService({ settings, branches: createBranchRepo(dbh.sqlite), assetsDir: layout.assets, ports: createElectronSettingsPorts() }, { writable: dbh.writable })
    const partyRepo = createPartyRepo(dbh.sqlite)
    const parties = createPartyService(partyRepo, { writable: dbh.writable })
    // Phase 140b: set below, once both engines exist (everything that queues a change calls it only after start-up).
    let pushSwitch: WorkerSwitch<PushStatus>
    // Phase 140b: while the shared notebook is activated a customer's id is the same on every computer (derived from the organisation + name) and every
    // customer change is queued for sending; otherwise (no sync, or the old sync) ids are random and nothing extra is queued, exactly as before.
    const newPartyId = (nameNorm: string): string => { const org = sharedActivation.credentials()?.orgId; return org ? partyRecordId(org, nameNorm) : randomUUID() }
    const emitPartyRecords = (ids: readonly string[]): void => {
      if (!sharedActivation.isActivated()) return
      for (const id of ids) outbox.capture({ billId: id, revision: 0, op: 'upsert' })
      pushSwitch.kick()
    }
    const customers = createCustomerService(
      { parties: partyRepo, customers: createCustomerRepo(dbh.sqlite), branchId: () => (dbh.writable ? getLocalBranch(dbh.sqlite).id : null), newPartyId, emit: emitPartyRecords },
      { writable: dbh.writable }
    )
    const partyImport = createPartyImportService(
      { parties: partyRepo, imports: createPartyImportRepo(dbh.sqlite), reader: createExcelSheetReader(), branchId: () => (dbh.writable ? getLocalBranch(dbh.sqlite).id : null) },
      { writable: dbh.writable }
    )
    const dashboard = createDashboardService({ repo: createDashboardRepo(dbh.sqlite), customers, lastBackup: () => latestBackupTime(layout.backups) })
    const dashboardLive = createDashboardLiveService({ http: createFetchDashHttp(), settings, log })
    const backup = createBackupService(
      { sqlite: dbh.sqlite, repo: createBackupRepo(dbh.sqlite), root: layout.root, backupsDir: layout.backups, schemaVersion: dbh.schemaVersion, ports: createElectronBackupPorts(), log },
      { writable: dbh.writable, audit: audit.record }
    )
    // Phase 50: first launch of the day makes an automatic backup (kept: the newest 14); never blocks start-up.
    void backup.autoIfDue().catch((err) => log.warn('Automatic backup failed', { err }))
    // Phase 52: license activation + branch registration (sync itself stays off; nothing here contacts Supabase at start-up).
    const license = createLicenseService(
      { sync: createSyncStateRepo(dbh.sqlite), branches: createBranchRepo(dbh.sqlite), secrets: createElectronSecretStore(), makeTransport: (c) => new SupabaseTransport(c), log },
      { writable: dbh.writable }
    )
    // Phase 140b: the shared notebook (v2). Its keys are `shared.*`, so it can sit beside the old sync until the cutover is done.
    const syncState = createSyncStateRepo(dbh.sqlite)
    const makeSharedTransport = (c: { url: string; anonKey: string }): SupabaseSharedTransport => new SupabaseSharedTransport(c)
    const sharedActivation = createSharedActivation(
      { sync: syncState, branches: createBranchRepo(dbh.sqlite), secrets: createElectronSecretStore(), makeTransport: makeSharedTransport, log },
      { writable: dbh.writable }
    )
    // Phase 58: new-branch bootstrap = merge a backup from another branch (never a restore; the license and keys here are untouched).
    const bootstrap = createBootstrapService(
      {
        repo: createBootstrapRepo(dbh.sqlite), branches: createBranchRepo(dbh.sqlite), backupsDir: layout.backups, schemaVersion: dbh.schemaVersion,
        safetyBackup: async () => (await backup.create('manual')).file, isActivated: () => license.isActivated() || sharedActivation.isActivated(), log
      },
      { writable: dbh.writable }
    )
    // Phase 54: every bill save / delete / restore records one outbox row inside its own transaction (only while a license is activated).
    const outbox = createOutbox({ repo: createOutboxRepo(dbh.sqlite), capturing: () => license.isActivated() || sharedActivation.isActivated() })
    const capture = (i: { billId: string; revision: number; op?: 'upsert' | 'delete' }): void => { outbox.capture({ billId: i.billId, revision: i.revision, op: i.op ?? 'upsert' }); pushSwitch.kick() }
    const billRepo = createBillRepo(dbh.sqlite)
    // Phase 111: owner item rules. Every local rule change (save / remove / undo) records one outbox row inside its own transaction, like a bill
    // (id = the rule's id, revision 0); the push worker sends it as an `item_rule` snapshot. Rules received from other branches never come back out.
    const itemRules = createItemRulesRepo(dbh.sqlite, { onChange: (r) => { outbox.capture({ billId: r.id, revision: ITEM_RULE_REVISION, op: r.deletedAt ? 'delete' : 'upsert' }); pushSwitch.kick() } })
    // Phase 55: the push worker sends captured changes (encrypted, one copy per other branch) every 15 s and shortly after a save. Idle while sync is not activated.
    const pushWorker = createPushWorker(
      { outbox: outbox.repo, bills: billRepo, itemRules, credentials: () => license.credentials(), encryptionKey: () => license.encryptionKey(), recipients: () => license.recipients(), makeTransport: (c) => new SupabaseTransport(c), log, progress: (p) => { broadcast('sync:progress', p) } }
    )
    app.on('will-quit', () => pushWorker.stop())
    // Phase 56: the pull worker brings in changes from other branches (every 30 s). It never touches the bill open in the editor.
    const remoteRepo = createRemoteApplyRepo(dbh.sqlite)
    const remote = createRemoteApplier({
      repo: remoteRepo, sync: syncState, localBranchId: () => getLocalBranch(dbh.sqlite).id, log,
      emit: (channel, payload) => { broadcast(channel, payload) }
    })
    // Phase 87: one-time repair - bills received before parties were created on receive get linked by exact normalised name.
    try {
      if (dbh.writable && syncState.get('sync.partiesRelinked') === undefined) {
        const r = remote.relinkParties()
        syncState.set('sync.partiesRelinked', '1')
        if (r.linked > 0) log.info('Linked received bills to parties', r)
      }
    } catch (e) { log.warn('Could not relink received bills to parties', { err: e instanceof Error ? e.message : String(e) }) }
    const pullWorker = createPullWorker({
      sync: syncState, repo: remoteRepo, applier: remote, itemRules: createItemRuleApplier({ rules: itemRules, localBranchId: () => getLocalBranch(dbh.sqlite).id, log }), credentials: () => license.credentials(), encryptionKey: () => license.encryptionKey(),
      makeTransport: (c) => new SupabaseTransport(c), emit: (channel, payload) => { broadcast(channel, payload) }, log,
      progress: (p) => { broadcast('sync:progress', p) }
    })
    app.on('will-quit', () => pullWorker.stop())
    // Phase 133: set-aside records (needs a newer app) cannot be edited or deleted locally.
    const syncRecords = createSyncRecordRepo(dbh.sqlite)
    const send = (channel: string, payload: unknown): void => { broadcast(channel, payload) }
    const sharedOn = (): boolean => sharedActivation.isActivated()
    const sharedClockOffset = (): number | null => readClock(syncState).offsetMs

    // Phase 140b: the shared-notebook engine (Phases 132-138), built once and left idle until this computer signs in. Same assembly as the Phase 135 test harness.
    let knownBranches: readonly SharedBranch[] = []
    let heldRef: ReturnType<typeof createHeldService> | null = null
    const sharedApplier = createRecordApplierV2(
      {
        repo: remoteRepo, bills: billRepo, outbox: outbox.repo, itemRules, localBranchId: () => getLocalBranch(dbh.sqlite).id, branches: () => knownBranches,
        isAside: (k, r) => syncRecords.isAside(k, r), isOpen: (b) => heldRef?.isOpen(b) ?? false,
        onBillChanged: (id) => send('bills:remoteChanged', { id, held: false }),
        rememberBase: (kind, recId, version, hash, serverSeq) => syncRecords.putState({ kind, recId, baseVersion: version, baseHash: hash, serverSeq, syncedAt: new Date().toISOString() }),
        log
      },
      { newId: () => randomUUID() }
    )
    const sharedHeld = createHeldService({ records: syncRecords, sync: syncState, applier: sharedApplier, offsetMs: sharedClockOffset, onLoaded: (id) => send('bills:remoteChanged', { id, held: false }) })
    heldRef = sharedHeld
    const sharedAside = createAsideService({ repo: syncRecords, apply: createAsideApply({ applier: sharedApplier, records: syncRecords, offsetMs: sharedClockOffset }) })
    const connectShared = (): ReturnType<typeof sharedActivation.connect> => sharedActivation.connect()
    const pushV2 = createPushWorkerV2({
      outbox: outbox.repo, bills: billRepo, revisions: remoteRepo, itemRules, parties: partyRepo, records: syncRecords, sync: syncState, connect: connectShared,
      appVer: app.getVersion(), newId: () => randomUUID(), log, progress: (p) => { send('sync:progress', p) }
    })
    const pullV2 = createPullWorkerV2(
      { records: syncRecords, sync: syncState, aside: sharedAside, applier: sharedApplier, connect: connectShared, setBranches: (l) => { knownBranches = l }, log, progress: (p) => { send('sync:progress', p) } },
      { pollMs: SHARED_POLL_MS }
    )
    const compareV2 = singleFlightCompare(createCompareService({
      records: syncRecords, sync: syncState, connect: connectShared, log, progress: (p) => { send('sync:progress', p) },
      sources: createLocalCompareSources({ bills: billRepo, heads: () => remoteRepo.heads(), outbox: outbox.repo, itemRules, parties: partyRepo, appVer: app.getVersion() })
    }))
    const doorbell = createDoorbell({ connect: async () => ({ transport: (await sharedActivation.connect()).transport }), orgId: () => sharedActivation.credentials()?.orgId ?? null, kick: () => pullV2.kick(), log })
    app.on('will-quit', () => { pushV2.stop(); pullV2.stop(); doorbell.stop() })
    // One push and one pull as far as the manager is concerned: v1 until the shared notebook is activated, v2 afterwards.
    pushSwitch = createWorkerSwitch<PushStatus>({
      v1: pushWorker, v2: pushV2, useV2: sharedOn,
      status: (v2) => { if (!v2) return pushWorker.status(); const st = pushV2.status(); return { ...st, block: st.block as PushStatus['block'] } }
    })
    const pullSwitch = createWorkerSwitch<PullStatus>({
      v1: pullWorker, v2: pullV2, useV2: sharedOn, onV2Start: () => doorbell.start(), onV2Stop: () => doorbell.stop(),
      status: (v2) => {
        if (!v2) return pullWorker.status()
        const st = pullV2.status()
        return {
          running: st.running, block: st.block as PullStatus['block'], consecutiveFailures: st.consecutiveFailures, nextDelayMs: st.nextDelayMs, lastRunAt: st.lastRunAt,
          lastSuccessAt: st.lastSuccessAt, lastError: st.lastError, appliedTotal: st.appliedTotal, cursor: st.cursor, unacked: 0, skipped: [], held: sharedHeld.list()
        }
      }
    })
    // The editor's open bill, held changes and conflicts: the shared notebook's own services once it is activated, the old ones before.
    const remoteFacade: RemoteApplier = {
      ...remote,
      setOpenBill: (id) => { remote.setOpenBill(id); sharedHeld.setOpenBill(id) },
      openBill: () => (sharedOn() ? sharedHeld.openBill() : remote.openBill()),
      held: () => (sharedOn() ? sharedHeld.list() : remote.held()),
      conflicts: () => (sharedOn() ? [] : remote.conflicts()),
      resolve: (id, choice) => (sharedOn() ? sharedHeld.resolve(id, choice) : remote.resolve(id, choice))
    }
    // Phase 59: the manager owns start / stop of both workers (the owner's on / off switch), the status the UI shows and Retry.
    const syncManager = createSyncManager(
      {
        license, sync: syncState, push: pushSwitch, pull: pullSwitch, outbox, remote: remoteFacade, asideCounts: () => sharedAside.countsByKind(),
        shared: {
          isActivated: sharedOn,
          compareNeeded: () => compareV2.needed(),
          extra: () => {
            const blocks: string[] = [pushV2.status().block, pullV2.status().block]
            const clock = sharedClockOffset()
            return { live: doorbell.status().mode === 'live', serverPaused: blocks.includes('paused'), signedOut: blocks.includes('auth'), ...(clock !== null ? { clockOffsetMs: clock } : {}) }
          }
        },
        emit: send, log
      },
      { writable: dbh.writable }
    )
    syncManager.start()
    const stopSyncWatch = syncManager.watch()
    app.on('will-quit', () => { stopSyncWatch(); syncManager.stop() })
    const sharedEngine = {
      start: () => syncManager.start(),
      stop: () => syncManager.stop(),
      afterCompare: () => { syncManager.start(); pushSwitch.kick(); pullSwitch.kick() }
    }
    // Phase 140: the move from the old sync. Step 1 stops the v1 workers (after a forced backup), step 3 is the first compare, step 4 the customer unify.
    const branchRepo = createBranchRepo(dbh.sqlite)
    const cutover = createCutoverService(
      {
        sync: syncState, backup: { create: (k) => backup.create(k) }, stopV1: () => syncManager.suspend(), v2: sharedActivation, compare: compareV2,
        customers: { unify: () => customers.unify() }, afterCompare: sharedEngine.afterCompare,
        audit: (a) => branchRepo.audit({ at: new Date().toISOString(), branchId: dbh.writable ? getLocalBranch(dbh.sqlite).id : null, entity: a.entity, entityId: a.entityId, action: a.action, detailJson: a.detailJson }),
        log
      },
      { writable: dbh.writable }
    )
    const sharedSync = createSharedSyncService({
      activation: sharedActivation,
      branches: createSharedBranches({ activation: sharedActivation, sync: syncState, makeTransport: makeSharedTransport, log }),
      compare: compareV2, engine: sharedEngine, cutoverNeeded: () => cutover.status().needed, log
    })
    if (dbh.writable && sharedOn()) {
      // After an app update a set-aside record may be readable now; a compare that was cut short (the app closed) carries on by itself (outside the cutover wizard).
      try { sharedAside.retryAside() } catch (e) { log.warn('Could not retry the set-aside records', { error: e instanceof Error ? e.message : String(e) }) }
      if (compareV2.needed() && !cutover.status().needed) void sharedSync.compare().catch((e) => log.warn('The first compare did not finish', { error: e instanceof Error ? e.message : String(e) }))
    }
    const bills = createBillService({ sqlite: dbh.sqlite, bills: billRepo, parties: partyRepo }, { writable: dbh.writable, outbox: capture, audit: audit.record, roundOff: () => readRoundOffSetting(settings.getAll()), isAside: (id) => syncRecords.isAside('bill', id), newPartyId, partyCreated: (id) => emitPartyRecords([id]) })
    const revisions = createRevisionService({ bills: billRepo })
    const history = createHistoryService(createHistoryRepo(dbh.sqlite))
    // Phase 110: the Items read model (read-only over bills; owner rules from Phase 109).
    const items = createItemsService({
      repo: createItemsRepo(dbh.sqlite),
      rules: () => itemRules.list(),
      // Phase 113: owner decisions are Item rules (synced like any rule); a read-only database refuses them.
      ruleOps: dbh.writable
        ? {
            save: (i, at) => ({ changed: itemRules.save(i, { at, branchId: getLocalBranch(dbh.sqlite).id }).changed }),
            undoLast: (at) => itemRules.undoLast({ at, branchId: getLocalBranch(dbh.sqlite).id }) !== null,
            hasUndo: () => itemRules.lastDecision() !== null
          }
        : undefined
    })
    // Phase 86: the legacy-bill import (Phase 85 service). Deletes made by `undo` reach the outbox like any delete; the bulk enqueue on import is Phase 88.
    const legacyImport = createLegacyImportService(
      { sqlite: dbh.sqlite, repo: createLegacyImportRepo(dbh.sqlite), bills: billRepo, backup: { create: (k) => backup.create(k) }, logsDir: layout.logs, log },
      { writable: dbh.writable, audit: audit.record, outbox: capture, outboxMany: (l) => { outbox.captureMany(l); pushSwitch.kick() } }
    )
    const drafts = createDraftService(createDraftRepo(dbh.sqlite), {
      writable: dbh.writable,
      branchId: () => (dbh.writable ? getLocalBranch(dbh.sqlite).id : null)
    })
    const trash = createTrashService(
      { repo: createTrashRepo(dbh.sqlite), branchId: () => (dbh.writable ? getLocalBranch(dbh.sqlite).id : null) },
      { writable: dbh.writable, retention: () => settings.get('trash.retentionDays'), outbox: capture, audit: audit.record }
    )
    if (dbh.writable) {
      // Phase 43: bills in Recently deleted for longer than the retention (30 days) are purged, with ONE audit row.
      try {
        const purged = trash.autoPurge()
        if (purged > 0) log.info('Purged old deleted bills', { purged })
      } catch (err) {
        log.warn('Trash auto-purge failed', { err })
      }
      // Phase 61: activity-log rows older than the retention (default 365 days) go, with ONE audit row.
      try {
        const removed = audit.purgeOld()
        if (removed > 0) log.info('Removed old activity log entries', { removed })
      } catch (err) {
        log.warn('Activity log sweep failed', { err })
      }
      // Phase 29: drafts untouched for more than 14 days go (with an audit row) before the rest are offered for recovery.
      try {
        const removed = drafts.cleanupStale()
        if (removed > 0) log.info('Removed stale drafts', { removed })
      } catch (err) {
        log.warn('Draft cleanup failed', { err })
      }
    }
    if (isDev && dbh.writable) {
      const seeded = parties.seedSamples()
      if (seeded > 0) log.info('Seeded sample parties (dev, empty table)', { seeded })
      // Phase 32: opt-in only (QUOT3_SEED_HISTORY=1), and only into a database with no bills at all.
      if (process.env['QUOT3_SEED_HISTORY'] === '1') {
        try {
          const n = seedHistoricalBills(bills, dbh.sqlite)
          if (n > 0) log.info('Seeded historical bills (dev, no bills yet)', { n })
        } catch (err) {
          log.warn('Historical bill seed failed', { err })
        }
      }
    }
    app.on('will-quit', () => dbh.close())
    const diagnostics = createDiagnosticsService({
      logsDir: layout.logs, home: homedir(), log, state: crashState,
      versions: { version: app.getVersion(), electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node, dev: isDev },
      os: { platform: platform(), release: release(), arch: arch() },
      db: () => ({ schemaVersion: dbh.schemaVersion, writable: dbh.writable, counts: createDiagnosticsRepo(dbh.sqlite).counts() }),
      sync: () => ({ activated: license.isActivated() || sharedActivation.isActivated(), mode: syncManager.overview().mode }),
      writeClipboard: (t) => clipboard.writeText(t)
    })
    // Phase 71: the image service owns the warm hidden window and the content-hash PNG cache; it is warmed once the app is up and disposed on quit.
    const imageService = createImageService({
      print: { resolveOutput: (r) => printService.resolveOutput(r) },
      port: createElectronImagePort(log),
      getScale: () => readImageScale(settings.getAll()), // Phase 72: Settings > Image quality
      log,
      // Dev flag: QUOT3_IMAGE_DEBUG=1 also writes every copied PNG to the temp folder for inspection.
      debugWrite: process.env.QUOT3_IMAGE_DEBUG === '1' ? (png) => { const f = join(app.getPath('temp'), `quot3-image-${Date.now()}.png`); writeFileSync(f, png); return f } : undefined
    })
    app.on('will-quit', () => imageService.dispose())
    setTimeout(() => imageService.warm(), 1500) // after first paint, so start-up is not slowed
    const printService = createPrintService({ port: createElectronPrintPort(), files: createElectronPdfFiles(), settings, logoDataUrl: appSettings.logoDataUrl, resourcesRoot: runtimePaths.resourcesRoot, log })
    // Phase 62: updates. Checks run in the background; the install only ever starts from the owner's click (and is refused while a bill is unsaved).
    const updates = createUpdateService({
      port: createElectronUpdaterPort(), settings, version: app.getVersion(), packaged: app.isPackaged, log,
      emit: (channel, payload) => { broadcast(channel, payload) },
      prepareInstall: () => { quitConfirmed = true },
      // 0.1.5 choose app version: GitHub release list, a 'pre-rollback' backup before the install, and the database's own format number.
      releases: createGithubReleaseFeed(), backup: { create: () => backup.create('pre-rollback') }, dbSchema: () => Math.max(dbh.openedVersion, dbh.schemaVersion),
      audit: audit.record
    })
    updates.start()
    app.on('will-quit', () => updates.stop())
    installSessionSecurity(isDev)
    registerIpc({
      info: {
        version: app.getVersion(),
        dataDir: layout.root,
        platform: process.platform,
        devMode: isDev
      },
      log,
      themes: createThemeService({ dir: layout.themes, log, settings, openPath: (d) => shell.openPath(d), applyTitleBar: (o) => { if (process.platform === 'win32') for (const w of windows) if (!w.isDestroyed()) w.setTitleBarOverlay(o) } }),
      settings,
      appSettings,
      backup,
      wipe: createWipeService({ root: layout.root, backup: { create: (k) => backup.create(k) }, restart: () => createElectronBackupPorts().restart(), log, audit: audit.record }, { writable: dbh.writable }),
      publisher: { writeText: (t) => clipboard.writeText(t), openExternal: (u) => shell.openExternal(u) },
      bootstrap,
      license,
      audit,
      diagnostics,
      updates,
      outbox,
      syncManager,
      sharedSync,
      cutover,
      remote: remoteFacade,
      parties,
      customers,
      partyImport,
      legacyImport,
      legacyDeps: { picker: createElectronLegacyPicker(), writeText: writeReportFile, emit: (channel, payload) => { broadcast(channel, payload) } },
      filePicker: createElectronFilePicker(),
      dashboard,
      dashboardLive,
      history,
      items,
      itemsEmit: (channel, payload) => { broadcast(channel, payload) },
      trash,
      revisions,
      bills,
      drafts,
      print: printService,
      image: imageService,
      confirmQuit: () => {
        // Phase 154: with several windows open, only the window that asked is closed; the last one quits the app.
        const w = askingToClose
        askingToClose = null
        if (w && !w.isDestroyed() && windows.size > 1) {
          confirmedClose.add(w)
          w.close()
          return
        }
        quitConfirmed = true
        app.quit()
      },
      dbInfo: () => {
        const branch = getLocalBranch(dbh.sqlite)
        return {
          userVersion: dbh.sqlite.pragma('user_version', { simple: true }) as number,
          schemaVersion: dbh.schemaVersion,
          writable: dbh.writable,
          localBranchPrefix: branch.poPrefix,
          nextPoPreview: peekNextPoNumber(dbh.sqlite, branch.id)
        }
      },
      isTrustedSender: (url) => isTrustedUrl(url, trust)
    })
    const openWindow = (first: boolean): BrowserWindow => {
      const win = createMainWindow({
        preloadPath: join(__dirname, '../preload/index.js'),
        indexHtml: join(__dirname, '../renderer/index.html'),
        trust,
        isDev,
        log,
        iconPath: resolveAppIcon({ resourcesPath: process.resourcesPath, appPath: app.getAppPath(), platform: process.platform })
      })
      // A further window opens slightly offset from the one in front, so it is visibly a new window.
      if (!first) {
        const front = BrowserWindow.getFocusedWindow() ?? [...windows].find((w) => !w.isDestroyed())
        if (front && !front.isMaximized() && !front.isFullScreen()) {
          const bounds = front.getBounds()
          win.setPosition(bounds.x + 32, bounds.y + 32)
        }
      }
      windows.add(win)
      if (first) {
        win.once('ready-to-show', () => startup.mark('window_shown'))
        win.webContents.once('did-finish-load', () => {
          startup.mark('page_loaded')
          log.info('Start-up timing (ms since the process started)', startup.report())
        })
        // Phase 29: once the page has loaded, tell it which unsaved bills survived the last run (it also pulls `drafts:list` on mount,
        // so whichever side is ready first wins). Phase 154: ONLY the first window is offered them; a later window would offer the
        // live drafts of the windows that are open right now.
        win.webContents.once('did-finish-load', () => {
          try {
            const recoverable = drafts.list()
            if (recoverable.length > 0) win.webContents.send('drafts:recoverable', { drafts: recoverable })
          } catch (err) {
            log.warn('Could not list recoverable drafts', { err })
          }
        })
      }
      win.on('close', (e) => {
        const wc = win.webContents
        if (quitConfirmed || confirmedClose.has(win) || wc.isDestroyed() || wc.isCrashed()) return
        e.preventDefault()
        askingToClose = win
        wc.send('app:before-quit', {})
      })
      win.on('unresponsive', () => log.warn('The window is not responding'))
      win.on('responsive', () => log.info('The window responds again'))
      win.on('closed', () => {
        windows.delete(win)
        if (askingToClose === win) askingToClose = null
      })
      return win
    }
    openWindowRef = openWindow
    openWindow(true)
    if (process.env['QUOT3_SMOKE_EXIT'] === '1') setTimeout(() => { quitConfirmed = true; app.quit() }, 2500)
  })

  app.on('window-all-closed', () => app.quit())
}
