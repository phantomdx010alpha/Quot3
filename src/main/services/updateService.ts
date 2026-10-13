import {
  buildUpdaterOptions, cleanVersion, clampPercent, friendlyUpdateError, initialUpdateState, installGate, isNewer, parseChannel, parseFeed,
  UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_MS, type FeedConfig, type UpdateChannel, type UpdaterOptions, type UpdateState
} from '../../shared/updater'
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
}

export interface UpdateService {
  state(): UpdateState
  check(manual: boolean): Promise<UpdateState>
  install(): UpdateState
  setBusy(busy: boolean): void
  setConfig(c: { auto?: boolean; channel?: UpdateChannel; feedUrl?: string }): UpdateState
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

  const publish = (patch: Partial<UpdateState>): UpdateState => {
    const before = JSON.stringify(st)
    st = { ...st, ...patch }
    if (JSON.stringify(st) !== before) {
      try { deps.emit('updates:state', st) } catch (err) { deps.log.warn('Update state not delivered', { err }) }
    }
    return st
  }
  const read = (): { auto: boolean; channel: UpdateChannel; feed: ReturnType<typeof parseFeed> } => ({
    auto: deps.settings.get('updates.auto') !== false,
    channel: parseChannel(deps.settings.get('updates.channel')),
    feed: parseFeed(deps.settings.get('updates.feedUrl'))
  })
  const feedName = (f: FeedConfig): UpdateState['feed'] => f.kind
  const syncConfig = (): ReturnType<typeof read> => {
    const c = read()
    publish({ auto: c.auto, channel: c.channel, ...(c.feed.ok ? { feed: feedName(c.feed.feed) } : {}) })
    return c
  }
  if (!deps.packaged) st = { ...st, phase: 'unavailable', message: 'This copy of Quot3 is running from source. Updates are checked by the installed app.' }
  syncConfig()

  async function check(manual: boolean): Promise<UpdateState> {
    const cfg = syncConfig()
    if (!deps.packaged) return st
    if (running || st.phase === 'ready') return st // one flow at a time; a downloaded update stays until installed
    if (!manual && !cfg.auto) return st
    if (!cfg.feed.ok) return publish({ phase: 'error', message: cfg.feed.message })
    running = true
    publish({ phase: 'checking', message: '', percent: 0, version: '' })
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
      if (gate === 'busy') throw new AppError('VALIDATION', 'Save or close the open bill first. Nothing was restarted.')
      deps.audit?.({ entity: 'app', action: 'update_install', detail: { from: deps.version, to: st.version } })
      deps.log.info('Restarting to install an update', { from: deps.version, to: st.version })
      deps.prepareInstall()
      deps.port.quitAndInstall()
      return st
    },
    setBusy(busy) { publish({ busy }) },
    setConfig(c) {
      if (c.feedUrl !== undefined) {
        const p = parseFeed(c.feedUrl)
        if (!p.ok) throw new AppError('VALIDATION', p.message)
        deps.settings.set('updates.feedUrl', c.feedUrl.trim())
      }
      if (c.auto !== undefined) deps.settings.set('updates.auto', c.auto)
      if (c.channel !== undefined) deps.settings.set('updates.channel', parseChannel(c.channel))
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
