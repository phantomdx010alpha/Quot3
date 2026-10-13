import type { SyncStateRepo } from '../db/syncStateRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import { asideCountsFrom, deriveOverview, SYNC_ENABLED_KEY, type OverviewInput, type SyncOverview } from '../../shared/sync/manager'
import type { ConflictInfo } from '../../shared/sync/conflict'
import type { PullStatus } from '../../shared/sync/pull'
import type { PushStatus } from '../../shared/sync/push'
import { CUTOVER_KEYS } from '../../shared/sync/cutover'
import type { Outbox } from './outbox'

/** The slices of the workers, license service and applier the manager needs (real objects satisfy them; tests pass fakes). */
export interface ManagedWorker<S> { start(): void; stop(): void; notifyOnline(): void; runOnce(): Promise<unknown>; status(): S }

export interface SyncManagerDeps {
  license: { isActivated(): boolean }
  sync: Pick<SyncStateRepo, 'get' | 'set'>
  push: ManagedWorker<PushStatus>
  pull: ManagedWorker<PullStatus>
  outbox: Pick<Outbox, 'status'> & { repo: Pick<Outbox['repo'], 'retryFailed' | 'counts' | 'oldestPendingAt'> }
  remote: { conflicts(): ConflictInfo[] }
  /** Phase 136: set-aside records per kind (`asideService.countsByKind`); absent = none. Cheap (one grouped count). */
  asideCounts?: () => Record<string, number>
  /**
   * Phase 140b: the shared notebook (v2). When it is activated it replaces v1 for everything below: the workers handed in above are switches that
   * run the v2 workers, and the overview is derived from them. Absent = v1 only (the pre-140b behaviour, which the older tests still cover).
   */
  shared?: {
    isActivated(): boolean
    /** True until the first compare ran to the end: the workers do not start before it. */
    compareNeeded(): boolean
    /** Doorbell / paused / signed-out / clock facts for `deriveOverview`. */
    extra(): Partial<Pick<OverviewInput, 'live' | 'serverPaused' | 'signedOut' | 'clockOffsetMs'>>
  }
  /** Sends `sync:status` to the window. */
  emit: (channel: string, payload: unknown) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface SyncManagerOptions {
  /** False when the database is read-only (a newer version made it): nothing can be started, switched or retried. */
  writable?: boolean
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export interface SyncManager {
  /** The owner's switch. True while not set (so activating a license turns sync on). */
  enabled(): boolean
  /** Starts both workers when the database is writable and the switch is on. Called once at start-up. Never starts them while the v1 sync is paused by the cutover. */
  start(): void
  stop(): void
  /** Phase 140: true once the cutover paused the old (v1) sync on this computer: its settings stay readable, its workers never run. */
  inert(): boolean
  /** Phase 140: stops the v1 workers now (the cutover calls this right after its safety backup). Idempotent. */
  suspend(): void
  /** Everything the Sync status page and the Dashboard chip show. Cheap and synchronous (a few counts, no network). */
  overview(): SyncOverview
  /** Owner's switch. Refused while no license is activated. Off = both workers stop and changes stay queued; on = they start and run soon. */
  setEnabled(on: boolean): SyncOverview
  /** Gives failed changes a fresh start (all, or the given outbox ids) and sends soon. */
  retry(ids?: number[]): { retried: number; overview: SyncOverview }
  /** Runs one push and one pull now (the Sync now button). Refused while off or paused. */
  syncNow(): Promise<SyncOverview>
  /** Sends `sync:status` whenever what the UI shows has changed, every `ms`. Returns a stop function. */
  watch(ms?: number): () => void
}

export const SYNC_WATCH_MS = 5_000

export function createSyncManager(deps: SyncManagerDeps, opts: SyncManagerOptions = {}): SyncManager {
  const writable = opts.writable !== false
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let running = false

  const enabled = (): boolean => deps.sync.get(SYNC_ENABLED_KEY) !== '0'
  const inert = (): boolean => deps.sync.get(CUTOVER_KEYS.v1Inert) === '1'
  const sharedOn = (): boolean => deps.shared?.isActivated() === true
  /** The v1 activation as far as this manager is concerned: a paused (cutover) v1 license counts as not activated, and so does v1 once the shared notebook took over. */
  const v1Activated = (): boolean => deps.license.isActivated() && !inert() && !sharedOn()
  /** Sync is activated on this computer, by either engine. */
  const activated = (): boolean => v1Activated() || sharedOn()
  /** Nothing may start: v1 was paused by the cutover and no shared notebook is there yet, or the first compare has not run. */
  const blocked = (): boolean => (inert() && !sharedOn()) || (sharedOn() && deps.shared?.compareNeeded() === true)
  const guard = (): void => { if (!writable) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }

  function overview(): SyncOverview {
    const on = activated()
    const shared = sharedOn()
    const o = deriveOverview({
      activated: on, enabled: enabled(), readOnly: !writable,
      // A worker that is not running (paused / read-only) reports `stopped`; the derivation ignores it unless sync is on.
      push: deps.push.status(), pull: deps.pull.status(),
      counts: deps.outbox.repo.counts(), oldestPendingAt: deps.outbox.repo.oldestPendingAt(),
      conflicts: on ? deps.remote.conflicts().length : 0,
      aside: on ? asideCountsFrom(deps.asideCounts?.() ?? {}) : undefined,
      ...(shared ? deps.shared!.extra() : {})
    })
    // Signed in, but the first compare has not run: nothing is shared yet (the workers wait for it). Say so instead of "up to date".
    if (shared && deps.shared!.compareNeeded() && enabled()) {
      return { ...o, mode: 'working', chip: 'Sync: not started', headline: 'Signed in. Press Compare and sync to start sharing bills with the other branches.' }
    }
    return o
  }
  const push = (): void => { try { deps.emit('sync:status', overview()) } catch (e) { deps.log.warn('Could not send the sync status', { error: e instanceof Error ? e.message : String(e) }) } }

  function startWorkers(): void { if (running || !writable || blocked()) return; running = true; deps.push.start(); deps.pull.start() }
  function stopWorkers(): void { if (!running) return; running = false; deps.push.stop(); deps.pull.stop() }

  return {
    enabled,
    inert,
    start() { if (enabled()) startWorkers() },
    stop() { stopWorkers() },
    suspend() { stopWorkers(); deps.log.info('The old sync was paused by the cutover'); push() },
    overview,

    setEnabled(on) {
      guard()
      if (!activated()) throw new AppError('VALIDATION', 'Activate a license first. Sync is off until then.')
      deps.sync.set(SYNC_ENABLED_KEY, on ? '1' : '0')
      if (on) { startWorkers(); deps.push.notifyOnline(); deps.pull.notifyOnline() } else stopWorkers()
      deps.log.info(on ? 'Sync switched on' : 'Sync switched off')
      push()
      return overview()
    },

    retry(ids) {
      guard()
      const retried = deps.outbox.repo.retryFailed(ids)
      if (retried > 0 && enabled() && running) deps.push.notifyOnline()
      if (retried > 0) deps.log.info('Failed sync changes sent back to the queue', { retried })
      push()
      return { retried, overview: overview() }
    },

    async syncNow() {
      guard()
      if (!activated()) throw new AppError('VALIDATION', 'Activate a license first. Sync is off until then.')
      if (!enabled()) throw new AppError('VALIDATION', 'Sync is switched off. Switch it on first.')
      startWorkers()
      deps.push.notifyOnline(); deps.pull.notifyOnline()
      await Promise.all([deps.push.runOnce(), deps.pull.runOnce()])
      push()
      return overview()
    },

    watch(ms = SYNC_WATCH_MS) {
      let last = ''
      let timer: unknown = null
      let stopped = false
      // What the UI shows (not the run clocks, which change every 15 s without meaning anything).
      const sig = (o: SyncOverview): string => JSON.stringify([o.mode, o.enabled, o.pending, o.failed, o.conflicts, o.held, o.skipped, o.asideLine, o.lastPushAt, o.lastPullAt, o.errors, o.delivery, o.chip])
      const tick = (): void => {
        if (stopped) return
        try {
          const o = overview(), s = sig(o)
          if (s !== last) { last = s; deps.emit('sync:status', o) }
        } catch (e) { deps.log.warn('Sync status check failed', { error: e instanceof Error ? e.message : String(e) }) }
        timer = setTimer(tick, ms)
      }
      timer = setTimer(tick, ms)
      return () => { stopped = true; if (timer !== null) clearTimer(timer); timer = null }
    }
  }
}
