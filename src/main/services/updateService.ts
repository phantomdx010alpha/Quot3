import {
  buildUpdaterOptions, cleanVersion, clampPercent, friendlyUpdateError, initialUpdateState, installGate, isNewer, parseChannel, parseFeed,
  UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_MS, type FeedConfig, type UpdateChannel, type UpdaterOptions, type UpdateState
} from '../../shared/updater'
import {
  buildEntries, buildRollbackOptions, friendlyReleaseListError, parseReleaseList, rollbackDecision, ROLLBACK_LIST_TTL_MS,
  type RollbackOptions, type RollbackRelease, type VersionList
} from '../../shared/rollback'
import type { AuditInput } from '../../shared/audit'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'

/** What the service needs from `electron-updater`. The real adapter is `updaterPort.ts`; tests drive a fake feed through this. */
export interface UpdaterPort {
  configure(o: UpdaterOptions): Promise<void> | void
  /** Resolves with the newest version the feed offers ('' = none); rejects when the feed cannot be read. */
  check(): Promise<{ version: string }>
  /** Downloads the version found by the last `check`. */
  download(onProgress: (percent: number) => void): Promise<void>
  quitAndInstall(): void
  /** 0.1.5: points the updater at ONE release (generic feed) with downgrades allowed. The next `configure()` switches both off again. */
  configureRollback(o: RollbackOptions): Promise<void> | void
}

export interface UpdateService {
  state(): UpdateState
  check(manual: boolean): Promise<UpdateState>
  install(): UpdateState
  setBusy(busy: boolean): void
  setConfig(c: { auto?: boolean; channel?: UpdateChannel; feedUrl?: string }): UpdateState
  /** 0.1.5: releases that can really be installed, with whether each may be chosen (cached; `refresh` asks GitHub again). */
  listVersions(refresh?: boolean): Promise<VersionList>
  /** 0.1.5: checks the data-format rule, then downloads that release in the background. Nothing is installed or restarted. */
  chooseVersion(version: string): Promise<UpdateState>
  /** 0.1.5: backup, stay-on-this-version setting, then restart into the downloaded older / chosen version. Refused while a bill is unsaved. */
  installRollback(): Promise<UpdateState>
  /** 0.1.5: ends "stay on this version" and checks for the newest release. */
  backToLatest(): Promise<UpdateState>
  /** Starts the background schedule (first check 45 s after launch, then every 6 h). */
  start(): void
  stop(): void
}

export interface UpdateDeps {
  port: UpdaterPort
  settings: { get(key: string): unknown; set(key: string, value: unknown): void }
  version: string
  /** False in `npm run dev` / unpackaged runs: nothing to update. */
  packaged: boolean
  emit: (channel: 'updates:state', payload: UpdateState) => void
  /** Called right before `quitAndInstall` (lets the window close without the unsaved-changes round trip; the editor is already clean). */
  prepareInstall: () => void
  /** 0.1.5: the GitHub "list releases" answer (raw JSON); rejects when GitHub cannot be reached. */
  releases: { fetch(): Promise<unknown> }
  /** 0.1.5: a safety copy of the database right before a version change (the same mechanism as the other pre-* backups). */
  backup: { create(): Promise<{ file: string }> }
  /** 0.1.5: the data-format number of the database in use (never lower than this build's own). */
  dbSchema: () => number
  audit?: (i: AuditInput) => void
  log: Logger
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

/**
 * Phase 62 - the update flow: check (manual or scheduled) -> download in the background -> `ready` -> the owner restarts.
 * Nothing here ever restarts the app by itself, and `install()` refuses while the editor reports an unsaved bill.
 */
export function createUpdateService(deps: UpdateDeps): UpdateService {
  const now = deps.now ?? (() => new Date())
  const setTimer = deps.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let st: UpdateState = initialUpdateState(deps.version)
  let timer: unknown = null
  let running = false
  let list: { at: number; channel: UpdateChannel; releases: RollbackRelease[] } | null = null

  const publish = (patch: Partial<UpdateState>): UpdateState => {
    const before = JSON.stringify(st)
    st = { ...st, ...patch }
    if (JSON.stringify(st) !== before) {
      try { deps.emit('updates:state', st) } catch (err) { deps.log.warn('Update state not delivered', { err }) }
    }
    return st
  }
  const read = (): { auto: boolean; channel: UpdateChannel; feed: ReturnType<typeof parseFeed>; pinned: string } => ({
    auto: deps.settings.get('updates.auto') !== false,
    channel: parseChannel(deps.settings.get('updates.channel')),
    feed: parseFeed(deps.settings.get('updates.feedUrl')),
    pinned: typeof deps.settings.get('updates.pinnedVersion') === 'string' ? (deps.settings.get('updates.pinnedVersion') as string) : ''
  })
  const feedName = (f: FeedConfig): UpdateState['feed'] => f.kind
  /** "Stay on this version" ends by itself when the running version is not the pinned one (the owner updated by hand, or an older build ran meanwhile). */
  const clearPin = (restoreAuto: boolean): void => {
    deps.settings.set('updates.pinnedVersion', '')
    if (restoreAuto) deps.settings.set('updates.auto', deps.settings.get('updates.autoBeforePin') !== false)
  }
  const syncConfig = (): ReturnType<typeof read> => {
    let c = read()
    if (c.pinned !== '' && c.pinned !== deps.version) {
      try { clearPin(true); c = read() } catch (err) { deps.log.warn('Could not clear the pinned version', { err: err instanceof Error ? err.message : 'unknown' }) }
    }
    publish({ auto: c.auto, channel: c.channel, pinned: c.pinned, ...(c.feed.ok ? { feed: feedName(c.feed.feed) } : {}) })
    return c
  }
  if (!deps.packaged) st = { ...st, phase: 'unavailable', message: 'This copy of Quot3 is running from source. Updates are checked by the installed app.' }
  syncConfig()

  async function check(manual: boolean): Promise<UpdateState> {
    const cfg = syncConfig()
    if (!deps.packaged) return st
    if (running || st.phase === 'ready') return st // one flow at a time; a downloaded update stays until installed
    if (!manual && (!cfg.auto || cfg.pinned !== '')) return st
    if (!cfg.feed.ok) return publish({ phase: 'error', message: cfg.feed.message })
    running = true
    publish({ phase: 'checking', message: '', percent: 0, version: '', mode: 'update' })
    try {
      await deps.port.configure(buildUpdaterOptions(cfg.feed.feed, cfg.channel))
      const found = await deps.port.check()
      const version = cleanVersion(found.version)
      if (version === '' || !isNewer(version, deps.version)) {
        return publish({ phase: 'none', version: '', message: '', checkedAt: now().toISOString() })
      }
      publish({ phase: 'downloading', version, percent: 0 })
      await deps.port.download((p) => { publish({ percent: clampPercent(p) }) })
      deps.audit?.({ entity: 'app', action: 'update_downloaded', detail: { from: deps.version, to: version } })
      deps.log.info('Update downloaded', { from: deps.version, to: version })
      return publish({ phase: 'ready', version, percent: 100, message: '', checkedAt: now().toISOString() })
    } catch (err) {
      const message = friendlyUpdateError(err)
      deps.log.warn('Update check failed', { err: err instanceof Error ? err.message : 'unknown' })
      return publish({ phase: 'error', message, percent: 0, checkedAt: now().toISOString() })
    } finally {
      running = false
    }
  }

  const dbSchema = (): number => Math.max(0, Math.floor(deps.dbSchema()))
  const need = (cond: boolean, msg: string): void => { if (!cond) throw new AppError('VALIDATION', msg) }

  async function listVersions(refresh = false): Promise<VersionList> {
    if (!deps.packaged) throw new AppError('VALIDATION', 'Choosing a version works in the installed app.')
    const channel = syncConfig().channel
    const fresh = list !== null && list.channel === channel && now().getTime() - list.at < ROLLBACK_LIST_TTL_MS
    if (!refresh && !fresh) refresh = true
    if (refresh || list === null) {
      let raw: unknown
      try { raw = await deps.releases.fetch() } catch (err) {
        deps.log.warn('Version list failed', { err: err instanceof Error ? err.message : 'unknown' })
        throw new AppError('IO_ERROR', friendlyReleaseListError(err))
      }
      list = { at: now().getTime(), channel, releases: parseReleaseList(raw, channel) }
    }
    return {
      entries: buildEntries(list.releases, deps.version, dbSchema()),
      currentVersion: deps.version, pinned: st.pinned, fetchedAt: new Date(list.at).toISOString()
    }
  }

  async function chooseVersion(version: string): Promise<UpdateState> {
    need(deps.packaged, 'Choosing a version works in the installed app.')
    need(!running, 'Another update step is still running. Wait a moment and try again.')
    need(list !== null, 'Open the version list first.')
    const target = list!.releases.find((r) => r.version === version) // the string must be one we listed; no raw text reaches the address
    const verdict = rollbackDecision({ target, currentVersion: deps.version, dbSchema: dbSchema() })
    if (!verdict.ok) throw new AppError('VALIDATION', verdict.message)
    const v = target!.version
    running = true
    publish({ phase: 'checking', mode: 'rollback', version: v, message: '', percent: 0 })
    try {
      await deps.port.configureRollback(buildRollbackOptions(v))
      const found = await deps.port.check()
      if (cleanVersion(found.version) !== v) throw new AppError('NOT_FOUND', 'That version is no longer available to download.')
      publish({ phase: 'downloading', version: v, percent: 0 })
      await deps.port.download((p) => { publish({ percent: clampPercent(p) }) })
      deps.audit?.({ entity: 'app', action: 'rollback_downloaded', detail: { from: deps.version, to: v } })
      deps.log.info('Chosen version downloaded', { from: deps.version, to: v })
      return publish({ phase: 'ready', mode: 'rollback', version: v, percent: 100, message: '', checkedAt: now().toISOString() })
    } catch (err) {
      const message = err instanceof AppError ? err.message : friendlyUpdateError(err)
      deps.log.warn('Choosing a version failed', { err: err instanceof Error ? err.message : 'unknown' })
      return publish({ phase: 'error', mode: 'update', version: '', message, percent: 0, checkedAt: now().toISOString() })
    } finally {
      running = false
    }
  }

  async function installRollback(): Promise<UpdateState> {
    need(st.phase === 'ready' && st.mode === 'rollback', 'No other version has been downloaded yet.')
    const refuseBusy = (): void => need(!st.busy, 'Save or close the open bill first. Nothing was restarted.')
    refuseBusy()
    const to = st.version
    const target = list?.releases.find((r) => r.version === to)
    const verdict = rollbackDecision({ target, currentVersion: deps.version, dbSchema: dbSchema() })
    if (!verdict.ok) throw new AppError('VALIDATION', verdict.message)
    const backup = await deps.backup.create() // throws a plain sentence when the copy cannot be written; then nothing restarts
    refuseBusy() // a bill may have been opened while the backup was written
    // Stay on the chosen version: older builds only know `updates.auto`, so it is switched off too (and remembered for "Back to latest").
    const newest = list!.releases[0]?.version
    if (to !== newest) {
      if (st.pinned === '') deps.settings.set('updates.autoBeforePin', deps.settings.get('updates.auto') !== false)
      deps.settings.set('updates.pinnedVersion', to)
      deps.settings.set('updates.auto', false)
    } else if (st.pinned !== '') {
      clearPin(true)
    }
    deps.audit?.({ entity: 'app', action: 'rollback_install', detail: { from: deps.version, to, backup: backup.file } })
    deps.log.info('Restarting to change version', { from: deps.version, to, backup: backup.file })
    deps.prepareInstall()
    deps.port.quitAndInstall()
    return st
  }

  async function backToLatest(): Promise<UpdateState> {
    need(deps.packaged, 'Updates are checked by the installed app.')
    need(!running, 'Another update step is still running. Wait a moment and try again.')
    if (st.pinned !== '' || read().pinned !== '') clearPin(true)
    if (st.phase === 'ready' && st.mode === 'rollback') publish({ phase: 'idle', mode: 'update', version: '', percent: 0, message: '' })
    syncConfig()
    return check(true)
  }

  const schedule = (ms: number): void => {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { void check(false).finally(() => schedule(UPDATE_CHECK_INTERVAL_MS)) }, ms)
  }

  return {
    state: () => st,
    check,
    install() {
      const gate = installGate(st)
      if (gate === 'not-ready') throw new AppError('VALIDATION', 'No update has been downloaded yet.')
      if (st.mode === 'rollback') throw new AppError('VALIDATION', 'Use "Go back to this version" so a backup is made first.')
      if (gate === 'busy') throw new AppError('VALIDATION', 'Save or close the open bill first. Nothing was restarted.')
      deps.audit?.({ entity: 'app', action: 'update_install', detail: { from: deps.version, to: st.version } })
      deps.log.info('Restarting to install an update', { from: deps.version, to: st.version })
      deps.prepareInstall()
      deps.port.quitAndInstall()
      return st
    },
    listVersions, chooseVersion, installRollback, backToLatest,
    setBusy(busy) { publish({ busy }) },
    setConfig(c) {
      if (c.feedUrl !== undefined) {
        const p = parseFeed(c.feedUrl)
        if (!p.ok) throw new AppError('VALIDATION', p.message)
        deps.settings.set('updates.feedUrl', c.feedUrl.trim())
      }
      if (c.auto !== undefined) deps.settings.set('updates.auto', c.auto)
      if (c.auto === true && read().pinned !== '') clearPin(false) // switching background checks back on ends "stay on this version"
      if (c.channel !== undefined) { deps.settings.set('updates.channel', parseChannel(c.channel)); list = null }
      if (c.feedUrl !== undefined || c.channel !== undefined) {
        // A different feed / channel makes an earlier "none / error" result stale; a downloaded update stays.
        if (st.phase !== 'ready' && st.phase !== 'checking' && st.phase !== 'downloading' && deps.packaged) publish({ phase: 'idle', message: '', version: '' })
      }
      syncConfig()
      return st
    },
    start() { if (deps.packaged) schedule(UPDATE_FIRST_CHECK_MS) },
    stop() { if (timer !== null) clearTimer(timer); timer = null }
  }
}
