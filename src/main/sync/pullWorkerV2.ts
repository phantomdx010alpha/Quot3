import type { SyncRecordRepo } from '../db/syncRecordRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import type { Logger } from '../logger'
import { asideEnvelopeJson, type DecodedRecord, type RawRecord } from '../../shared/sync/codecV2'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { PULL_INTERVAL_MS, PULL_KICK_DELAY_MS, PULL_MAX_PAGES_PER_RUN, SHARED_PULL_FAIL_CAP, SHARED_PULL_PAGE_SIZE, pollDelayMs } from '../../shared/sync/pull'
import { classifySharedWorkerFailure, sharedBlockFor, type SharedBlock } from '../../shared/sync/push'
import { AppError } from '../ipc/envelope'
import type { AsideService } from './asideService'
import type { SharedCredentials } from './activationV2'
import type { RecordApplierV2 } from './recordApplierV2'
import { UnknownBranchError } from './remoteApplier'
import { SharedTransportError, type PulledRecord, type SharedBranch, type SharedStoreTransport } from './sharedTransport'
import { SHARED_STATE_KEYS, ensureClockOffset, readClock, readCursor, writeCursor } from './sharedState'

/**
 * Phase 135 - the v2 pull worker (docs/SYNC_SHARED_STORE_SPEC.md section 6). Asks `sn_pull` for records above the cursor (`server_seq`),
 * pages of 200. Nothing is acknowledged and nothing is deleted on the server. For every record:
 *  1. the version check comes first (`asideService.ingest`): a record this app is too old to read is kept whole in `sync_aside`, never
 *     applied, and the cursor still moves on;
 *  2. a record this computer already holds at that version and content is skipped (our own pushes come back this way);
 *  3. otherwise the applier writes it and `sync_record_state` remembers the version, in ONE transaction (a crash replays safely);
 *  4. a record that cannot be applied NEVER blocks the cursor: it is kept (`shared.pullFail.*`, with the record itself) and retried at the
 *     start of every run; after `SHARED_PULL_FAIL_CAP` failed runs it is set aside (`sync_aside`) and remembered, so it stops costing time.
 *     A bill held because the editor has it open is retried without counting.
 * The cursor is saved after every page. Connection trouble pauses the worker and never counts against a record.
 */
export interface PullWorkerV2Deps {
  records: SyncRecordRepo
  sync: Pick<SyncStateRepo, 'get' | 'set' | 'remove' | 'keys'>
  aside: Pick<AsideService, 'ingest'>
  applier: RecordApplierV2
  connect: () => Promise<{ transport: SharedStoreTransport; creds: Pick<SharedCredentials, 'license' | 'branchId'> }>
  /** Called when the applier needs the branch list (a bill from a branch not seen yet). Defaults to the transport's `listBranches`. */
  setBranches?: (list: readonly SharedBranch[]) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  progress?: (p: SyncProgress) => void
}

export interface PullWorkerV2Options {
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Normal wait between runs (default 30 s; the shared store uses `SHARED_POLL_MS`, 60 s, because the doorbell does the fast work). */
  pollMs?: number
}

export interface PullRunResultV2 {
  pages: number
  /** Records written (new or replaced). */
  applied: number
  /** Already here at that version / same content / not applicable. */
  skipped: number
  /** A local unsent change was later and stays queued. */
  keptLocal: number
  /** Set aside because this app is too old to read them (`sync_aside`). */
  aside: number
  /** Kinds this build cannot apply yet (parties: Phase 136-137); remembered nowhere, the first-sync compare picks them up later. */
  unsupported: number
  /** Failed this run (kept for a retry). */
  failed: number
  /** Gave up after the cap and set aside. */
  gaveUp: number
  /** Held because the editor has the bill open. */
  held: number
  cursor: number
  block: SharedBlock
}

export interface PullStatusV2 {
  running: boolean
  block: SharedBlock
  consecutiveFailures: number
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  cursor: number
  /** Records waiting for a retry. */
  waiting: number
  appliedTotal: number
  /** Measured clock offset (ms) or null; the caller shows the quiet warning with `isClockSkewLarge`. */
  clockOffsetMs: number | null
}

export interface PullWorkerV2 {
  start(): void
  stop(): void
  /** The doorbell rang (Phase 138) or something else says "pull now": run soon (coalesced). */
  kick(): void
  notifyOnline(): void
  runOnce(): Promise<PullRunResultV2>
  status(): PullStatusV2
}

interface FailRecord { attempts: number; held: boolean; error: string; payloadHash: string; raw: RawRecord & { fromBranch?: string | null } }

class Pause extends Error { constructor(readonly block: SharedBlock, msg: string) { super(msg) } }
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error')
const failKey = (kind: string, recId: string): string => `${SHARED_STATE_KEYS.pullFail}${kind}.${recId}`

function pauseFor(e: unknown): Pause | null {
  if (e instanceof SharedTransportError) { const c = classifySharedWorkerFailure(e.kind); return new Pause(c === 'row' ? 'license' : sharedBlockFor(c), e.message) }
  if (e instanceof AppError) { const c = classifySharedWorkerFailure(e.code); return new Pause(c === 'row' ? 'license' : sharedBlockFor(c), e.message) }
  return null
}

export function createPullWorkerV2(deps: PullWorkerV2Deps, opts: PullWorkerV2Options = {}): PullWorkerV2 {
  const now = opts.now ?? (() => new Date())
  const pollMs = opts.pollMs ?? PULL_INTERVAL_MS
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const { records, sync, log } = deps

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PullRunResultV2> | null = null
  let failures = 0
  let block: SharedBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let appliedTotal = 0

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pollDelayMs(failures, pollMs))
  }

  const toRaw = (p: PulledRecord): RawRecord & { fromBranch: string | null } => ({
    kind: p.kind, recId: p.recId, version: p.version, serverSeq: p.serverSeq, payload: p.payload, schemaVer: p.schemaVer, minReaderVer: p.minReaderVer,
    appVer: p.appVer, editedAt: p.editedAt, deleted: p.deleted, fromBranch: p.fromBranch
  })

  const readFail = (key: string): FailRecord | null => {
    const raw = sync.get(key)
    if (raw === undefined) return null
    try { return JSON.parse(raw) as FailRecord } catch { return null }
  }

  async function run(): Promise<PullRunResultV2> {
    const r: PullRunResultV2 = { pages: 0, applied: 0, skipped: 0, keptLocal: 0, aside: 0, unsupported: 0, failed: 0, gaveUp: 0, held: 0, cursor: readCursor(sync), block: 'idle' }
    lastRunAt = now().toISOString()
    const tracker = createProgressTracker('receive', deps.progress ?? (() => undefined))
    try {
      const { transport, creds } = await deps.connect()
      const offsetMs = await ensureClockOffset(sync, transport, () => now().getTime())
      let branches: readonly SharedBranch[] = []
      let branchesLoaded = false
      const loadBranches = async (): Promise<void> => {
        if (branchesLoaded) return
        branchesLoaded = true
        branches = await transport.listBranches({ license: creds.license, branchId: creds.branchId })
        deps.setBranches?.(branches)
      }
      let seen = 0

      /** One record, one transaction. Returns the outcome; throws only for a pause-worthy problem (never for a bad record). */
      const handle = async (raw: RawRecord & { fromBranch?: string | null }, payloadHash: string, tries: { attempts: number }): Promise<'done' | 'failed' | 'held'> => {
        const key = failKey(raw.kind, raw.recId)
        const attempt = async (): Promise<'done' | 'held'> => {
          const dec = deps.aside.ingest(raw)
          if (dec.outcome === 'aside') {
            records.putState({ kind: dec.kind, recId: dec.recId, baseVersion: dec.version, baseHash: payloadHash, serverSeq: raw.serverSeq ?? 0, syncedAt: now().toISOString() })
            r.aside++
            return 'done'
          }
          if (dec.outcome === 'invalid') throw new Error(`Record is not valid: ${dec.reason}`)
          const rec: DecodedRecord = dec.record
          const st = records.getState(rec.kind, rec.recId)
          if (st && st.baseVersion === rec.version && st.baseHash === rec.payloadHash) { r.skipped++; return 'done' }
          if (st && st.baseVersion > rec.version) { r.skipped++; return 'done' } // an older copy of something already seen
          const apply = (): string => {
            let out = ''
            records.transaction(() => {
              out = deps.applier.apply(rec, { fromBranch: raw.fromBranch ?? null, offsetMs })
              if (out === 'held' || out === 'unsupported') return
              if (out !== 'kept_local') records.putState({ kind: rec.kind, recId: rec.recId, baseVersion: rec.version, baseHash: rec.payloadHash, serverSeq: rec.serverSeq, syncedAt: now().toISOString() })
            })
            return out
          }
          let out: string
          try { out = apply() } catch (e) {
            if (!(e instanceof UnknownBranchError)) throw e
            await loadBranches() // a branch that joined after the last list: ask once, then try again
            out = apply()
          }
          if (out === 'held') { r.held++; return 'held' }
          if (out === 'unsupported') r.unsupported++
          else if (out === 'kept_local') r.keptLocal++
          else if (out === 'ignored') r.skipped++
          else r.applied++
          return 'done'
        }
        try {
          const res = await attempt()
          if (res === 'held') { sync.set(key, JSON.stringify({ attempts: tries.attempts, held: true, error: 'The bill is open in the editor.', payloadHash, raw } satisfies FailRecord)); return 'held' }
          sync.remove([key])
          return 'done'
        } catch (e) {
          if (pauseFor(e)) throw e
          const attempts = tries.attempts + 1
          if (attempts >= SHARED_PULL_FAIL_CAP) {
            // Give up: keep the record whole in the set-aside list (so nothing is lost), remember its version so it is not pulled again.
            records.transaction(() => {
              records.putAside({ kind: raw.kind, recId: raw.recId, version: raw.version, minReaderVer: raw.minReaderVer, payloadJson: asideEnvelopeJson(raw), seenAt: now().toISOString() })
              records.putState({ kind: raw.kind, recId: raw.recId, baseVersion: raw.version, baseHash: payloadHash, serverSeq: raw.serverSeq ?? 0, syncedAt: now().toISOString() })
            })
            sync.remove([key])
            r.gaveUp++
            log.error('Sync set a received record aside after repeated failures', { kind: raw.kind, recId: raw.recId, error: errText(e) })
            return 'failed'
          }
          sync.set(key, JSON.stringify({ attempts, held: false, error: errText(e).slice(0, 300), payloadHash, raw } satisfies FailRecord))
          r.failed++
          log.warn('Sync could not apply a received record; it will be retried', { kind: raw.kind, recId: raw.recId, attempts, error: errText(e) })
          return 'failed'
        }
      }

      // 1. records that failed (or were held) in earlier runs
      const waiting = sync.keys(SHARED_STATE_KEYS.pullFail)
      for (const key of waiting) {
        const f = readFail(key)
        if (!f) { sync.remove([key]); continue }
        await handle(f.raw, typeof f.payloadHash === 'string' ? f.payloadHash : '', { attempts: f.held ? 0 : f.attempts })
      }

      // 2. new records above the cursor
      for (let page = 0; page < PULL_MAX_PAGES_PER_RUN; page++) {
        const res = await transport.pull({ license: creds.license, branchId: creds.branchId, afterSeq: readCursor(sync), limit: SHARED_PULL_PAGE_SIZE })
        r.pages++
        if (res.items.length === 0) break
        if (page === 0) tracker.begin(res.items.length + (res.hasMore ? SHARED_PULL_PAGE_SIZE : 0))
        let top = readCursor(sync)
        for (const item of res.items) {
          await handle(toRaw(item), item.payloadHash, { attempts: 0 })
          if (item.serverSeq > top) top = item.serverSeq
        }
        // The cursor moves past every record of the page, failed ones included: a failing row never blocks the others.
        writeCursor(sync, top)
        r.cursor = top
        seen += res.items.length
        tracker.advance(res.items.length, seen + (res.hasMore ? SHARED_PULL_PAGE_SIZE : 0))
        if (!res.hasMore) break
      }
      r.cursor = readCursor(sync)
      block = 'idle'; lastError = null; lastSuccessAt = now().toISOString(); failures = 0
    } catch (e) {
      const p = pauseFor(e)
      if (p) {
        block = p.block; lastError = p.message; failures++
        if (p.block === 'offline') log.info('Sync pull is waiting for the connection', { failures })
        else log.warn('Sync pull paused', { reason: p.block })
      } else {
        block = 'offline'; lastError = errText(e); failures++
        log.error('Sync pull failed unexpectedly', { err: lastError })
      }
    } finally {
      tracker.end()
      appliedTotal += r.applied
    }
    r.block = block
    return r
  }

  function runOnce(): Promise<PullRunResultV2> {
    if (current) return current
    current = run()
      .catch((e): PullRunResultV2 => { lastError = errText(e); return { pages: 0, applied: 0, skipped: 0, keptLocal: 0, aside: 0, unsupported: 0, failed: 0, gaveUp: 0, held: 0, cursor: readCursor(sync), block } })
      .finally(() => { current = null; schedule() })
    return current
  }

  return {
    start() {
      if (started) return
      started = true
      block = 'idle'
      kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PULL_KICK_DELAY_MS)
    },
    stop() {
      started = false
      block = 'stopped'
      if (timer !== null) clearTimer(timer)
      if (kickTimer !== null) clearTimer(kickTimer)
      timer = kickTimer = null
    },
    kick() {
      if (!started || kickTimer !== null) return
      kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PULL_KICK_DELAY_MS)
    },
    notifyOnline() {
      if (!started) return
      failures = 0
      if (kickTimer === null) kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PULL_KICK_DELAY_MS)
    },
    runOnce,
    status() {
      return {
        running: current !== null, block, consecutiveFailures: failures, nextDelayMs: pollDelayMs(failures, pollMs), lastRunAt, lastSuccessAt, lastError,
        cursor: readCursor(sync), waiting: sync.keys(SHARED_STATE_KEYS.pullFail).length, appliedTotal, clockOffsetMs: readClock(sync).offsetMs
      }
    }
  }
}
