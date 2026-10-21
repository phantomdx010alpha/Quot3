import type { SyncProgress } from '../../shared/sync/progress'
import type { DeliveryMode } from '../../shared/sync/pull'
import type { PhoneDb } from '../data/db'
import { getMetaValue } from '../data/metaRepo'
import { countAside } from './aside'
import { retryAsideRecords, type RetryAsideResult } from './asideRetry'
import { clockWarning } from './clock'
import { createPhoneDoorbell, type DoorbellStatus } from './doorbell'
import { applyFirstSync, prepareFirstSync, requestOlderBills, type FirstSyncPreview, type FirstSyncResult, type FirstSyncScope, type StorageEstimate } from './firstSync'
import { outboxCounts, type OutboxCounts } from './outbox'
import { createPhonePullWorker, type PullRunResult, type PullStatus } from './pull'
import { createPhonePushWorker, type PushRunResult, type PushStatus } from './push'
import { SYNC_META, getRaw, isFirstSyncDone } from './syncMeta'
import type { PhoneSharedPort } from './transport'

/**
 * Phase 179 - the phone's sync engine: owns the push worker, the pull worker and the doorbell and decides WHEN they run. No UI (Phase 180 / 185 draw it).
 *
 * When sync runs (there is NO background sync; a phone browser freezes a hidden page, and nothing here promises otherwise):
 *   - at `start()` (pull + push once);
 *   - when the page becomes visible again;
 *   - when the network comes back (`online`);
 *   - after a Save (`notifySaved()`);
 *   - every 60 s while the page is open (the pull worker's own timer, the doorbell's backup);
 *   - when the Realtime doorbell rings (page open only).
 * Only the tab that holds the single-writer lock syncs (`db.canWrite()`); a second tab shows `read_only`.
 * The first sync is NOT automatic: until `completeFirstSync` has run, the workers do not start (pushing before the compare would collide with records
 * that already exist on the server), and `state` is `first_sync_needed`.
 */
export type EngineState = 'stopped' | 'not_linked' | 'read_only' | 'first_sync_needed' | 'running'

export interface EngineEnv {
  /** Called when the page becomes visible. Returns an unsubscribe. */
  onVisible(cb: () => void): () => void
  /** Called when the browser says the network is back. Returns an unsubscribe. */
  onOnline(cb: () => void): () => void
}

/** `document` / `window` events when they exist; a no-op elsewhere (tests pass their own). */
export const browserEnv: EngineEnv = {
  onVisible(cb) {
    if (typeof document === 'undefined') return () => undefined
    const h = (): void => { if (document.visibilityState === 'visible') cb() }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  },
  onOnline(cb) {
    if (typeof window === 'undefined') return () => undefined
    window.addEventListener('online', cb)
    return () => window.removeEventListener('online', cb)
  }
}

export interface PhoneSyncEngineDeps {
  db: PhoneDb
  connect: () => Promise<{ port: PhoneSharedPort; creds: { license: string; branchId: string } }>
  appVer: string
  newId?: () => string
  now?: () => Date
  /** The bill the editor has open (a received change to it is held, never applied under the editor). */
  isOpen?: (billId: string) => boolean
  env?: EngineEnv
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Overrides the pull poll (default 60 s). */
  pollMs?: number
  storage?: () => Promise<StorageEstimate>
  progress?: (p: SyncProgress) => void
  onChanged?: (kind: string, recId: string) => void
  onMode?: (mode: DeliveryMode) => void
  revisionCap?: number
}

export interface EngineStatus {
  state: EngineState
  push: PushStatus
  pull: PullStatus
  doorbell: DoorbellStatus
  outbox: OutboxCounts
  /** Records kept aside because a newer app wrote them ("Update the app to see N bills"). */
  aside: { total: number; bills: number }
  /** Older bills the first-sync "recent" choice left on the server. */
  deferredBills: number
  clockOffsetMs: number
  clockWarning: string | null
}

export interface PhoneSyncEngine {
  /** Reads what the phone knows and starts the workers when the first sync is done. Safe to call again. */
  start(): Promise<EngineState>
  stop(): void
  state(): EngineState
  /** First sync step 1: read-only compare + size check. */
  prepareFirstSync(): Promise<FirstSyncPreview>
  /** First sync step 2: apply the person's choice, then start the workers. */
  completeFirstSync(preview: FirstSyncPreview, scope: FirstSyncScope): Promise<FirstSyncResult>
  /** "Load older bills" after a "recent" first sync. */
  loadOlderBills(): Promise<void>
  /** A bill or customer was saved / deleted / restored: send and fetch soon. */
  notifySaved(): void
  /** After an app update: decode the records kept aside again and apply the ones this build can now read (one transaction each). */
  retryAside(readerVer?: number): Promise<RetryAsideResult>
  /** Push, then pull, now. Returns both results. */
  syncNow(): Promise<{ push: PushRunResult; pull: PullRunResult }>
  status(): Promise<EngineStatus>
}

export function createPhoneSyncEngine(deps: PhoneSyncEngineDeps): PhoneSyncEngine {
  const { db } = deps
  const env = deps.env ?? browserEnv
  const newId = deps.newId ?? ((): string => globalThis.crypto.randomUUID())
  let state: EngineState = 'stopped'
  let orgId: string | null = null
  let unsub: (() => void)[] = []

  const timers = { setTimer: deps.setTimer, clearTimer: deps.clearTimer, now: deps.now }
  const push = createPhonePushWorker({ db, connect: deps.connect, appVer: deps.appVer, progress: deps.progress, revisionCap: deps.revisionCap }, timers)
  const pull = createPhonePullWorker({ db, connect: deps.connect, appVer: deps.appVer, newId, isOpen: deps.isOpen, progress: deps.progress, onChanged: deps.onChanged, revisionCap: deps.revisionCap }, { ...timers, pollMs: deps.pollMs })
  const doorbell = createPhoneDoorbell(
    { connect: async () => { const c = await deps.connect(); return { port: c.port } }, orgId: () => orgId, kick: () => pull.kick(), onMode: deps.onMode },
    timers
  )

  function begin(): void {
    pull.start()
    push.start()
    doorbell.start()
    unsub.push(env.onVisible(() => { pull.kick(); push.kick() }))
    unsub.push(env.onOnline(() => { pull.notifyOnline(); push.notifyOnline() }))
    state = 'running'
  }

  function halt(): void {
    for (const u of unsub) { try { u() } catch { /* already gone */ } }
    unsub = []
    doorbell.stop()
    pull.stop()
    push.stop()
  }

  return {
    async start() {
      halt()
      if (!db.canWrite()) return (state = 'read_only')
      orgId = await getMetaValue(db, 'org_id')
      const branchId = await getMetaValue(db, 'branch_id')
      if (!orgId || !branchId) return (state = 'not_linked')
      if (!(await isFirstSyncDone(db))) return (state = 'first_sync_needed')
      begin()
      return state
    },
    stop() { halt(); state = 'stopped' },
    state: () => state,
    prepareFirstSync: () => prepareFirstSync({ db, connect: deps.connect, appVer: deps.appVer, now: deps.now, progress: deps.progress, storage: deps.storage }),
    async completeFirstSync(preview, scope) {
      const r = await applyFirstSync({ db, now: deps.now }, preview, scope)
      halt()
      orgId = await getMetaValue(db, 'org_id')
      begin()
      return r
    },
    async loadOlderBills() {
      await requestOlderBills(db)
      pull.kick()
    },
    notifySaved() {
      if (state !== 'running') return
      push.kick()
      pull.kick()
    },
    async retryAside(readerVer) {
      const r = await retryAsideRecords({ db, now: deps.now ?? (() => new Date()), newId, isOpen: deps.isOpen, offsetMs: await getMetaValue(db, 'clock_offset_ms'), readerVer, revisionCap: deps.revisionCap })
      if (r.applied > 0) pull.kick()
      return r
    },
    async syncNow() {
      const p = await push.runOnce()
      const q = await pull.runOnce()
      return { push: p, pull: q }
    },
    async status() {
      const offset = await getMetaValue(db, 'clock_offset_ms')
      return {
        state, push: push.status(), pull: pull.status(), doorbell: doorbell.status(), outbox: await outboxCounts(db), aside: await countAside(db),
        deferredBills: await getRaw<number>(db, SYNC_META.deferredBills, 0), clockOffsetMs: offset, clockWarning: clockWarning(offset)
      }
    }
  }
}
