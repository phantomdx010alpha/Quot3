import type { OutboxRepo } from '../db/outboxRepo'
import type { SyncRecordRepo } from '../db/syncRecordRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import type { BillRepo } from '../db/billRepo'
import type { RemoteApplyRepo } from '../db/remoteApplyRepo'
import type { BillRecord, BillRowRecord } from '../../shared/billModel'
import type { ItemRulesRepo } from '../db/itemRulesRepo'
import type { PartyRepo } from '../db/partyRepo'
import type { Logger } from '../logger'
import type { OutboxItem } from '../../shared/sync/outbox'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import {
  PUSH_BATCH_MAX_BYTES, PUSH_BATCH_ROWS, PUSH_KICK_DELAY_MS, PUSH_MAX_BATCHES_PER_RUN, classifySharedWorkerFailure, pushDelayMs, sharedBlockFor,
  type PushStatus, type SharedBlock
} from '../../shared/sync/push'
import { AppError } from '../ipc/envelope'
import { encodeLocalRecord } from './billRecordV2'
import { SHARED_PAYLOAD_MAX_BYTES, SHARED_PUSH_MAX_ITEMS, SharedTransportError, type PushItem, type SharedStoreTransport } from './sharedTransport'
import { ensureClockOffset } from './sharedState'
import type { SharedCredentials } from './activationV2'

/**
 * Phase 135 - the v2 push worker (docs/SYNC_SHARED_STORE_SPEC.md section 6). The outbox captures changes exactly as in v1; this worker
 * takes unsent rows oldest first, builds each record AT SEND TIME (`codecV2`), and sends one `sn_push` per batch with the `base_version`
 * this computer last saw (`sync_record_state`). Outcomes of the server's four-way rule:
 *  - `accepted` / `noop` / `won`: the server now holds this computer's content at the returned version -> the version is remembered
 *    (`base_version`, `base_hash`) and the outbox row is settled;
 *  - `lost`: another branch's version is later; this computer's version is kept as a local revision (History -> compare) and the row is
 *    settled. The winner arrives with the next pull (its `server_seq` is above the cursor), and the received version replaces the local one.
 * Failure rules are the v1 ones: connection trouble / paused server / refused login / refused license pause the worker and never count
 * against a row; a request the server refuses itself is retried one row at a time and the culprit is blamed (10 attempts -> `failed`).
 * All state is in SQLite, so a restart resumes. Nothing here logs record content.
 */
export interface PushWorkerV2Deps {
  outbox: OutboxRepo
  bills: Pick<BillRepo, 'getRecord' | 'getRows'>
  /** Keeps this computer's version as a revision when it loses a conflict. */
  revisions: Pick<RemoteApplyRepo, 'authorOf' | 'putRevision' | 'pruneRevisions'>
  itemRules?: Pick<ItemRulesRepo, 'get'>
  /** Phase 137: customers and merges (outbox rows whose id is a customer / merge record id). */
  parties?: Pick<PartyRepo, 'getAny' | 'getMerge'>
  records: SyncRecordRepo
  sync: Pick<SyncStateRepo, 'get' | 'set'>
  /** `activationV2.connect()` (a signed-in transport + the credentials). */
  connect: () => Promise<{ transport: SharedStoreTransport; creds: Pick<SharedCredentials, 'license' | 'branchId'> }>
  appVer: string
  newId: () => string
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  progress?: (p: SyncProgress) => void
}

export interface PushWorkerV2Options {
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export interface PushRunResultV2 {
  /** Rows settled in this run (sent, or nothing left to send). */
  sent: number
  accepted: number
  noop: number
  won: number
  lost: number
  failedAttempts: number
  poisoned: number
  block: SharedBlock
}

export type PushStatusV2 = Omit<PushStatus, 'block'> & { block: SharedBlock }

export interface PushWorkerV2 {
  start(): void
  stop(): void
  /** "A bill was just saved": run soon (coalesced). */
  kick(): void
  /** "The connection is back": forget the backoff and run soon. */
  notifyOnline(): void
  runOnce(): Promise<PushRunResultV2>
  status(): PushStatusV2
}

class Pause extends Error { constructor(readonly block: SharedBlock, msg: string) { super(msg) } }
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error')

/** Turns a transport / connect failure into a pause, or returns `'row'` when the server refused the request itself. */
function classify(e: unknown): 'row' | Pause | null {
  if (e instanceof SharedTransportError) {
    const c = classifySharedWorkerFailure(e.kind)
    return c === 'row' ? 'row' : new Pause(sharedBlockFor(c), e.message)
  }
  if (e instanceof AppError) {
    const c = classifySharedWorkerFailure(e.code)
    return c === 'row' ? new Pause('license', e.message) : new Pause(sharedBlockFor(c), e.message)
  }
  return null
}

interface Prepared { row: OutboxItem; item: PushItem }

export function createPushWorkerV2(deps: PushWorkerV2Deps, opts: PushWorkerV2Options = {}): PushWorkerV2 {
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const { outbox, records, log } = deps

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PushRunResultV2> | null = null
  let failures = 0
  let block: SharedBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let sentTotal = 0

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pushDelayMs(failures))
  }

  function blame(row: OutboxItem, msg: string): boolean {
    const state = outbox.markAttempt(row.id, msg)
    if (state === 'failed') log.error('Sync gave up on a change after repeated failures', { billId: row.billId, outboxId: row.id, error: msg })
    return state === 'failed'
  }

  /** `null` = nothing to send any more (the bill / rule was purged). Throws for a row that cannot be encoded (it is blamed by the caller). */
  function prepare(row: OutboxItem, offsetMs: number | null): Prepared | null {
    const enc = encodeLocalRecord({ bills: deps.bills, itemRules: deps.itemRules, parties: deps.parties }, row.billId, { offsetMs, appVer: deps.appVer })
    if (!enc) return null
    const base = records.getState(enc.kind, enc.recId)?.baseVersion ?? 0
    return { row, item: { kind: enc.kind, recId: enc.recId, baseVersion: base, payload: enc.payload, payloadHash: enc.payloadHash, schemaVer: enc.schemaVer, minReaderVer: enc.minReaderVer, appVer: enc.appVer, editedAt: enc.editedAt, deleted: enc.deleted } }
  }

  /** This computer lost the conflict: its version must survive as a local revision (the bill row is replaced by the winner on the next pull). */
  function keepLoser(p: Prepared): void {
    if (p.item.kind !== 'bill') return // a rule, customer or merge has no revision list; the server keeps the loser in `sn_history`
    const rec = deps.bills.getRecord(p.item.recId) as BillRecord | undefined
    if (!rec) return
    if (deps.revisions.authorOf(rec.id, rec.revision) !== undefined) return // that revision is already in the list (every save writes one)
    const rows = deps.bills.getRows(rec.id) as BillRowRecord[]
    deps.revisions.putRevision({ id: deps.newId(), billId: rec.id, revision: rec.revision, snapshotJson: JSON.stringify({ bill: rec, rows }), savedAt: rec.updatedAt, savedByBranch: rec.branchId })
    deps.revisions.pruneRevisions(rec.id)
  }

  async function sendBatch(transport: SharedStoreTransport, c: { license: string; branchId: string }, batch: Prepared[], r: PushRunResultV2, tried: Set<number>): Promise<void> {
    let res
    try {
      res = await transport.push({ license: c.license, branchId: c.branchId, items: batch.map((p) => p.item) })
    } catch (e) {
      const k = classify(e)
      if (k instanceof Pause) throw k
      if (k === null) throw e
      if (batch.length > 1) {
        for (const p of batch) await sendBatch(transport, c, [p], r, tried)
        return
      }
      const p = batch[0] as Prepared
      tried.add(p.row.id)
      r.failedAttempts++
      if (blame(p.row, errText(e))) r.poisoned++
      return
    }
    const at = now().toISOString()
    batch.forEach((p, i) => {
      const out = res[i]
      if (!out || out.recId !== p.item.recId || out.kind !== p.item.kind) throw new Error('The server answered a different list than was sent.')
      records.transaction(() => {
        if (out.outcome === 'lost') {
          keepLoser(p)
          r.lost++
        } else {
          records.putState({ kind: p.item.kind, recId: p.item.recId, baseVersion: out.version, baseHash: p.item.payloadHash, serverSeq: out.serverSeq, syncedAt: at })
          if (out.outcome === 'accepted') r.accepted++
          else if (out.outcome === 'noop') r.noop++
          else r.won++
        }
        outbox.markSynced(p.row.id)
      })
      r.sent++
    })
  }

  async function run(): Promise<PushRunResultV2> {
    const r: PushRunResultV2 = { sent: 0, accepted: 0, noop: 0, won: 0, lost: 0, failedAttempts: 0, poisoned: 0, block: 'idle' }
    lastRunAt = now().toISOString()
    const tracker = createProgressTracker('send', deps.progress ?? (() => undefined))
    const tried = new Set<number>()
    try {
      if (outbox.counts().pending === 0) { block = 'idle'; r.block = block; return r }
      const { transport, creds } = await deps.connect().catch((e) => { const k = classify(e); throw k instanceof Pause ? k : e })
      const offsetMs = await ensureClockOffset(deps.sync, transport, () => now().getTime())
      tracker.begin(outbox.counts().pending)
      let counted = 0
      for (let batches = 0; batches < PUSH_MAX_BATCHES_PER_RUN; batches++) {
        const rows = outbox.pending(PUSH_BATCH_ROWS + tried.size).filter((x) => !tried.has(x.id)).slice(0, PUSH_BATCH_ROWS)
        if (rows.length === 0) break
        const batch: Prepared[] = []
        let bytes = 0
        let progressed = false
        for (const row of rows) {
          let p: Prepared | null
          try { p = prepare(row, offsetMs) } catch (e) {
            progressed = true; tried.add(row.id); r.failedAttempts++
            if (blame(row, `Could not prepare the change: ${errText(e)}`)) r.poisoned++
            continue
          }
          if (p === null) { outbox.markSynced(row.id); r.sent++; progressed = true; continue }
          const size = Buffer.byteLength(JSON.stringify(p.item.payload), 'utf8')
          if (size > SHARED_PAYLOAD_MAX_BYTES) {
            progressed = true; tried.add(row.id); r.failedAttempts++
            if (blame(row, 'This record is too large to send to the notebook.')) r.poisoned++
            continue
          }
          if (batch.length > 0 && (bytes + size > PUSH_BATCH_MAX_BYTES || batch.length + 1 > SHARED_PUSH_MAX_ITEMS)) break
          batch.push(p); bytes += size
        }
        if (batch.length > 0) { await sendBatch(transport, creds, batch, r, tried); progressed = true }
        tracker.advance(r.sent - counted); counted = r.sent
        if (!progressed) break
      }
      block = 'idle'; lastError = null; lastSuccessAt = now().toISOString(); failures = 0
    } catch (e) {
      const k = e instanceof Pause ? e : classify(e)
      if (k instanceof Pause) {
        block = k.block; lastError = k.message; failures++
        if (k.block === 'offline') log.info('Sync push is waiting for the connection', { failures })
        else log.warn('Sync push paused', { reason: k.block })
      } else {
        block = 'offline'; lastError = errText(e); failures++
        log.error('Sync push failed unexpectedly', { err: lastError })
      }
    } finally {
      tracker.end()
      sentTotal += r.sent
    }
    r.block = block
    return r
  }

  function runOnce(): Promise<PushRunResultV2> {
    if (current) return current
    current = run()
      .catch((e): PushRunResultV2 => { lastError = errText(e); return { sent: 0, accepted: 0, noop: 0, won: 0, lost: 0, failedAttempts: 0, poisoned: 0, block } })
      .finally(() => { current = null; schedule() })
    return current
  }

  return {
    start() {
      if (started) return
      started = true
      block = 'idle'
      kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS)
    },
    stop() {
      started = false
      block = 'stopped'
      if (timer !== null) clearTimer(timer)
      if (kickTimer !== null) clearTimer(kickTimer)
      timer = kickTimer = null
    },
    kick() {
      if (!started || kickTimer !== null || failures > 0) return
      kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS)
    },
    notifyOnline() {
      if (!started) return
      failures = 0
      if (kickTimer === null) kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS)
    },
    runOnce,
    status() {
      return { running: current !== null, block, consecutiveFailures: failures, nextDelayMs: pushDelayMs(failures), lastRunAt, lastSuccessAt, lastError, sentTotal }
    }
  }
}
