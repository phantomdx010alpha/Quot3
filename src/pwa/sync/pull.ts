import { asideEnvelopeJson, type DecodedRecord, type RawRecord } from '../../shared/sync/codecV2'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { PULL_KICK_DELAY_MS, PULL_MAX_PAGES_PER_RUN, SHARED_POLL_MS, SHARED_PULL_FAIL_CAP, SHARED_PULL_PAGE_SIZE, pollDelayMs } from '../../shared/sync/pull'
import { type SharedBlock } from '../../shared/sync/push'
import { getMetaValue } from '../data/metaRepo'
import { txDone, type PhoneDb } from '../data/db'
import { ensureClockOffset } from './clock'
import { APPLY_STORES, applyRecord, type ApplyOutcome } from './applier'
import { ingestTx, putAsideTx } from './aside'
import { classifyFailure, errText, Pause } from './failure'
import { getStateTx, putStateTx } from './recordState'
import { listPullFails, putPullFail, readCursor, readFloorSeq, removePullFail, writeCursor, type PullFail } from './syncMeta'
import { type PhonePulled, type PhoneSharedPort } from './transport'

/**
 * Phase 179 - the phone's pull worker (port of the desktop `pullWorkerV2`, docs/SYNC_SHARED_STORE_SPEC.md section 6). Asks `sn_pull` for records
 * above the cursor (`server_seq`), pages of 200. Nothing is acknowledged and nothing is deleted on the server. For every record, ONE IndexedDB transaction:
 *  1. the version check comes first (`aside.ingestTx`): a record this app is too old to read is kept whole in `sync_aside`, never applied; the cursor still moves;
 *  2. a record the phone already holds at that version and content is skipped (its own pushes come back this way);
 *  3. otherwise the applier writes it and `sync_record_state` remembers the version, in the same transaction (a crash replays safely);
 *  4. a record that cannot be applied NEVER blocks the cursor: it is kept with the record (`sync.pull_fail.*`) and retried at the start of every run;
 *     after `SHARED_PULL_FAIL_CAP` failed runs it is set aside. A bill held because the editor has it open is retried without counting.
 * The cursor (`meta.server_seq`) is saved after every page. Connection trouble pauses the worker and never counts against a record.
 * Pull runs: at start, when the page becomes visible, on network regain, after a Save and every 60 s while the app is open (the engine kicks it);
 * there is NO background sync.
 */
export interface PhonePullDeps {
  db: PhoneDb
  connect: () => Promise<{ port: PhoneSharedPort; creds: { license: string; branchId: string } }>
  appVer: string
  newId: () => string
  /** The bill the editor has open (never overwritten). */
  isOpen?: (billId: string) => boolean
  progress?: (p: SyncProgress) => void
  /** Told after a record was written, for the UI to refresh lists. */
  onChanged?: (kind: string, recId: string) => void
  revisionCap?: number
}

export interface PhoneWorkerOptions {
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Normal wait between runs (the shared store uses `SHARED_POLL_MS`, 60 s: the doorbell does the fast work). */
  pollMs?: number
}

export interface PullRunResult {
  pages: number
  applied: number
  skipped: number
  keptLocal: number
  aside: number
  unsupported: number
  /** Older bills left on the server by the first-sync "recent bills" choice. */
  deferred: number
  failed: number
  gaveUp: number
  held: number
  cursor: number
  block: SharedBlock
}

export interface PullStatus {
  running: boolean
  block: SharedBlock
  consecutiveFailures: number
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  cursor: number
  appliedTotal: number
}

export interface PhonePullWorker {
  start(): void
  stop(): void
  /** The doorbell rang, the page became visible, a bill was saved: run soon (coalesced). */
  kick(): void
  /** The connection is back: forget the backoff and run soon. */
  notifyOnline(): void
  runOnce(): Promise<PullRunResult>
  status(): PullStatus
}

const emptyRun = (cursor: number, block: SharedBlock): PullRunResult => ({ pages: 0, applied: 0, skipped: 0, keptLocal: 0, aside: 0, unsupported: 0, deferred: 0, failed: 0, gaveUp: 0, held: 0, cursor, block })

export function createPhonePullWorker(deps: PhonePullDeps, opts: PhoneWorkerOptions = {}): PhonePullWorker {
  const now = opts.now ?? (() => new Date())
  const pollMs = opts.pollMs ?? SHARED_POLL_MS
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const { db } = deps

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PullRunResult> | null = null
  let failures = 0
  let block: SharedBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let appliedTotal = 0
  let lastCursor = 0

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pollDelayMs(failures, pollMs))
  }

  const toRaw = (p: PhonePulled): RawRecord & { fromBranch: string | null } => ({
    kind: p.kind, recId: p.recId, version: p.version, serverSeq: p.serverSeq, payload: p.payload, schemaVer: p.schemaVer, minReaderVer: p.minReaderVer,
    appVer: p.appVer, editedAt: p.editedAt, deleted: p.deleted, fromBranch: p.fromBranch
  })

  async function run(): Promise<PullRunResult> {
    lastCursor = await readCursor(db)
    const r = emptyRun(lastCursor, 'idle')
    lastRunAt = now().toISOString()
    const tracker = createProgressTracker('receive', deps.progress ?? (() => undefined))
    try {
      if (!db.canWrite()) { block = 'idle'; r.block = block; return r } // another tab is the writer
      const { port, creds } = await deps.connect().catch((e) => { const k = classifyFailure(e); throw k instanceof Pause ? k : e })
      const offsetMs = await ensureClockOffset(db, port, () => now().getTime())
      const branchId = (await getMetaValue(db, 'branch_id')) ?? creds.branchId
      const orgId = await getMetaValue(db, 'org_id')
      const floorSeq = await readFloorSeq(db)
      let seen = 0

      /** One record, one transaction. Throws only for a pause-worthy problem (never for a bad record). */
      const handle = async (raw: RawRecord & { fromBranch?: string | null }, payloadHash: string, tries: { attempts: number }): Promise<'done' | 'failed' | 'held'> => {
        const attempt = async (): Promise<'done' | 'held'> => {
          db.assertWritable()
          const tx = db.idb.transaction([...APPLY_STORES], 'readwrite')
          const done = txDone(tx)
          done.catch(() => undefined)
          try {
            const dec = await ingestTx(tx, raw, now())
            if (dec.outcome === 'aside') {
              putStateTx(tx, { kind: dec.kind, recId: dec.recId, baseVersion: dec.version, baseHash: payloadHash, serverSeq: raw.serverSeq ?? 0, syncedAt: now().toISOString() })
              r.aside++
            } else if (dec.outcome === 'invalid') {
              throw new Error(`Record is not valid: ${dec.reason}`)
            } else {
              const rec: DecodedRecord = dec.record
              const st = await getStateTx(tx, rec.kind, rec.recId)
              if (st && st.baseVersion === rec.version && st.baseHash === rec.payloadHash) r.skipped++
              else if (st && st.baseVersion > rec.version) r.skipped++ // an older copy of something already seen
              else {
                const out: ApplyOutcome = await applyRecord(tx, rec, { fromBranch: raw.fromBranch ?? null, offsetMs }, {
                  localBranchId: branchId, orgId, now, newId: deps.newId, isOpen: deps.isOpen, floorSeq, revisionCap: deps.revisionCap
                })
                if (out !== 'held' && out !== 'unsupported' && out !== 'deferred' && out !== 'kept_local') {
                  putStateTx(tx, { kind: rec.kind, recId: rec.recId, baseVersion: rec.version, baseHash: rec.payloadHash, serverSeq: rec.serverSeq, syncedAt: now().toISOString() })
                }
                if (out === 'held') r.held++
                else if (out === 'unsupported') r.unsupported++
                else if (out === 'deferred') r.deferred++
                else if (out === 'kept_local') r.keptLocal++
                else if (out === 'ignored') r.skipped++
                else r.applied++
                if (out === 'held') { tx.abort(); await done.catch(() => undefined); return 'held' }
                if (out === 'inserted' || out === 'updated') queueMicrotask(() => { try { deps.onChanged?.(rec.kind, rec.recId) } catch { /* a listener never breaks the worker */ } })
              }
            }
          } catch (e) {
            try { tx.abort() } catch { /* already finished */ }
            await done.catch(() => undefined)
            throw e
          }
          await done
          return 'done'
        }
        try {
          const res = await attempt()
          if (res === 'held') { await putPullFail(db, raw.kind, raw.recId, { attempts: tries.attempts, held: true, error: 'The bill is open in the editor.', payloadHash, raw } satisfies PullFail); return 'held' }
          await removePullFail(db, raw.kind, raw.recId)
          return 'done'
        } catch (e) {
          const attempts = tries.attempts + 1
          if (attempts >= SHARED_PULL_FAIL_CAP) {
            // Give up: keep the record whole in the set-aside list (nothing is lost) and remember its version so it is not pulled again.
            db.assertWritable()
            const tx = db.idb.transaction(['sync_aside', 'sync_record_state'], 'readwrite')
            await putAsideTx(tx, { kind: raw.kind, recId: raw.recId, version: raw.version, minReaderVer: raw.minReaderVer, payloadJson: asideEnvelopeJson(raw), seenAt: now().toISOString() })
            putStateTx(tx, { kind: raw.kind, recId: raw.recId, baseVersion: raw.version, baseHash: payloadHash, serverSeq: raw.serverSeq ?? 0, syncedAt: now().toISOString() })
            await txDone(tx)
            await removePullFail(db, raw.kind, raw.recId)
            r.gaveUp++
            return 'failed'
          }
          await putPullFail(db, raw.kind, raw.recId, { attempts, held: false, error: errText(e).slice(0, 300), payloadHash, raw } satisfies PullFail)
          r.failed++
          return 'failed'
        }
      }

      // 1. records that failed (or were held) in earlier runs
      for (const w of await listPullFails(db)) {
        const f = w.fail
        if (!f || typeof f !== 'object' || !f.raw) { await removePullFail(db, w.kind, w.recId); continue }
        await handle(f.raw as RawRecord & { fromBranch?: string | null }, typeof f.payloadHash === 'string' ? f.payloadHash : '', { attempts: f.held ? 0 : f.attempts })
      }

      // 2. new records above the cursor
      for (let page = 0; page < PULL_MAX_PAGES_PER_RUN; page++) {
        const res = await port.pull({ license: creds.license, branchId: creds.branchId, afterSeq: await readCursor(db), limit: SHARED_PULL_PAGE_SIZE })
        r.pages++
        if (res.items.length === 0) break
        if (page === 0) tracker.begin(res.items.length + (res.hasMore ? SHARED_PULL_PAGE_SIZE : 0))
        let top = await readCursor(db)
        for (const item of res.items) {
          await handle(toRaw(item), item.payloadHash, { attempts: 0 })
          if (item.serverSeq > top) top = item.serverSeq
        }
        // The cursor moves past every record of the page, failed ones included: a failing row never blocks the others.
        await writeCursor(db, top)
        r.cursor = top
        seen += res.items.length
        tracker.advance(res.items.length, seen + (res.hasMore ? SHARED_PULL_PAGE_SIZE : 0))
        if (!res.hasMore) break
      }
      r.cursor = await readCursor(db)
      lastCursor = r.cursor
      block = 'idle'; lastError = null; lastSuccessAt = now().toISOString(); failures = 0
    } catch (e) {
      const k = classifyFailure(e)
      if (k instanceof Pause) { block = k.block; lastError = k.message; failures++ }
      else { block = 'offline'; lastError = errText(e); failures++ }
    } finally {
      tracker.end()
      appliedTotal += r.applied
    }
    r.block = block
    return r
  }

  function runOnce(): Promise<PullRunResult> {
    if (current) return current
    current = run()
      .catch((e): PullRunResult => { lastError = errText(e); return emptyRun(lastCursor, block) })
      .finally(() => { current = null; schedule() })
    return current
  }

  const arm = (): void => { if (kickTimer === null) kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PULL_KICK_DELAY_MS) }

  return {
    start() { if (started) return; started = true; block = 'idle'; arm() },
    stop() {
      started = false
      block = 'stopped'
      if (timer !== null) clearTimer(timer)
      if (kickTimer !== null) clearTimer(kickTimer)
      timer = kickTimer = null
    },
    kick() { if (started) arm() },
    notifyOnline() { if (!started) return; failures = 0; arm() },
    runOnce,
    status: () => ({ running: current !== null, block, consecutiveFailures: failures, nextDelayMs: pollDelayMs(failures, pollMs), lastRunAt, lastSuccessAt, lastError, cursor: lastCursor, appliedTotal })
  }
}

