import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { PUSH_BATCH_MAX_BYTES, PUSH_BATCH_ROWS, PUSH_KICK_DELAY_MS, PUSH_MAX_BATCHES_PER_RUN, pushDelayMs, type SharedBlock } from '../../shared/sync/push'
import type { BillRecord, BillRowRecord } from '../../shared/billModel'
import { reqToPromise, txDone, type PhoneDb } from '../data/db'
import { REVISION_CAP_PER_BILL, rowRange, type StoredBill, type StoredRevision, type StoredRow } from '../data/billsRepo'
import { ensureClockOffset } from './clock'
import { billRecordOf, billRowRecordOf, encodeLocal } from './encode'
import { classifyFailure, errText, Pause } from './failure'
import { listPending, markAttempt, outboxCounts, settleTx, type OutboxRow } from './outbox'
import { putStateTx } from './recordState'
import { PHONE_PAYLOAD_MAX_BYTES, PHONE_PUSH_MAX_ITEMS, type PhonePushItem, type PhoneSharedPort } from './transport'
import type { PhoneWorkerOptions } from './pull'

/**
 * Phase 179 - the phone's push worker (port of the desktop `pushWorkerV2`, spec section 6). Takes unsent outbox rows oldest first, builds each
 * record AT SEND TIME (`codecV2`), and sends one `sn_push` per batch with the `base_version` the phone last saw (`sync_record_state`). Outcomes of the
 * server's four-way rule:
 *  - `accepted` / `noop` / `won`: the server now holds the phone's content at the returned version -> `base_version` / `base_hash` are remembered and the
 *    outbox row is settled (only if it was not replaced by a newer change meanwhile);
 *  - `lost`: another branch's version is later; the phone's version is kept as a local revision and the row is settled. The winner arrives with the next
 *    pull (its `server_seq` is above the cursor) and replaces the local copy.
 * Failure rules are the desktop's: connection trouble / paused server / refused login / refused license pause the worker and never count against a row;
 * a request the server refuses itself is retried one row at a time and the culprit is blamed (10 attempts -> `failed`). All state is in IndexedDB,
 * so a reload resumes. The phone cannot push while another tab holds the writer lock. Nothing here logs record content.
 */
export interface PhonePushDeps {
  db: PhoneDb
  connect: () => Promise<{ port: PhoneSharedPort; creds: { license: string; branchId: string } }>
  appVer: string
  progress?: (p: SyncProgress) => void
  revisionCap?: number
}

export interface PushRunResult { sent: number; accepted: number; noop: number; won: number; lost: number; failedAttempts: number; poisoned: number; block: SharedBlock }
export interface PushStatus {
  running: boolean
  block: SharedBlock
  consecutiveFailures: number
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  sentTotal: number
}

export interface PhonePushWorker {
  start(): void
  stop(): void
  /** "A bill was just saved": run soon (coalesced; not while the backoff is running). */
  kick(): void
  notifyOnline(): void
  runOnce(): Promise<PushRunResult>
  status(): PushStatus
}

interface Prepared { row: OutboxRow; item: PhonePushItem }
const bytesOf = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length
const emptyRun = (block: SharedBlock): PushRunResult => ({ sent: 0, accepted: 0, noop: 0, won: 0, lost: 0, failedAttempts: 0, poisoned: 0, block })

export function createPhonePushWorker(deps: PhonePushDeps, opts: PhoneWorkerOptions = {}): PhonePushWorker {
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const { db } = deps
  const cap = Math.max(1, deps.revisionCap ?? REVISION_CAP_PER_BILL)

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PushRunResult> | null = null
  let failures = 0
  let block: SharedBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let sentTotal = 0

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pushDelayMs(failures))
  }

  const blame = async (row: OutboxRow, msg: string): Promise<boolean> => (await markAttempt(db, row, msg)) === 'failed'

  /** `null` = nothing to send any more (the record was purged). Throws for a row that cannot be encoded (the caller blames it). */
  async function prepare(row: OutboxRow, offsetMs: number | null): Promise<Prepared | null> {
    if (row.kind !== 'bill' && row.kind !== 'party') return null // the phone makes no merges or rules [A]
    const enc = await encodeLocal(db, row.kind, row.recId, { offsetMs, appVer: deps.appVer })
    if (!enc) return null
    const st = (await reqToPromise(db.idb.transaction('sync_record_state', 'readonly').objectStore('sync_record_state').get([enc.kind, enc.recId]))) as { base_version: number } | undefined
    return {
      row,
      item: { kind: enc.kind, recId: enc.recId, baseVersion: st?.base_version ?? 0, payload: enc.payload, payloadHash: enc.payloadHash, schemaVer: enc.schemaVer, minReaderVer: enc.minReaderVer, appVer: enc.appVer, editedAt: enc.editedAt, deleted: enc.deleted }
    }
  }

  /** The phone lost the conflict: its version must survive as a local revision (the bill is replaced by the winner on the next pull). */
  async function keepLoserTx(tx: IDBTransaction, p: Prepared): Promise<void> {
    if (p.item.kind !== 'bill') return // a customer has no revision list; the server keeps the loser in its history
    const head = (await reqToPromise(tx.objectStore('bills').get(p.item.recId))) as StoredBill | undefined
    if (!head) return
    const revs = tx.objectStore('bill_revisions')
    if ((await reqToPromise(revs.get([head.id, head.revision]))) !== undefined) return // every save writes its revision already
    const rows = (await reqToPromise(tx.objectStore('bill_rows').index('bill_id_idx').getAll(rowRange(head.id)))) as StoredRow[]
    const rec = billRecordOf(head) as unknown as BillRecord
    revs.put({ bill_id: head.id, revision: head.revision, saved_at: head.updatedAt, saved_by_branch: head.branchId, snapshot_json: JSON.stringify({ bill: { ...rec, syncState: head.syncState }, rows: rows.map(billRowRecordOf) as unknown as BillRowRecord[] }) } satisfies StoredRevision)
    const all = (await reqToPromise(revs.getAll(IDBKeyRange.bound([head.id, 0], [head.id, Number.MAX_SAFE_INTEGER])))) as StoredRevision[]
    all.sort((x, y) => y.revision - x.revision)
    for (const old of all.slice(cap)) revs.delete([old.bill_id, old.revision])
  }

  async function sendBatch(port: PhoneSharedPort, c: { license: string; branchId: string }, batch: Prepared[], r: PushRunResult, tried: Set<string>): Promise<void> {
    let res
    try {
      res = await port.push({ license: c.license, branchId: c.branchId, items: batch.map((p) => p.item) })
    } catch (e) {
      const k = classifyFailure(e)
      if (k instanceof Pause) throw k
      if (k === null) throw e
      if (batch.length > 1) { for (const p of batch) await sendBatch(port, c, [p], r, tried); return }
      const p = batch[0] as Prepared
      tried.add(p.row.id)
      r.failedAttempts++
      if (await blame(p.row, errText(e))) r.poisoned++
      return
    }
    const at = now().toISOString()
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i] as Prepared
      const out = res[i]
      if (!out || out.recId !== p.item.recId || out.kind !== p.item.kind) throw new Error('The server answered a different list than was sent.')
      db.assertWritable()
      const tx = db.idb.transaction(['bills', 'bill_rows', 'bill_revisions', 'sync_record_state', 'sync_outbox'], 'readwrite')
      const done = txDone(tx)
      done.catch(() => undefined)
      try {
        if (out.outcome === 'lost') { await keepLoserTx(tx, p); r.lost++ }
        else {
          putStateTx(tx, { kind: p.item.kind, recId: p.item.recId, baseVersion: out.version, baseHash: p.item.payloadHash, serverSeq: out.serverSeq, syncedAt: at })
          if (out.outcome === 'accepted') r.accepted++
          else if (out.outcome === 'noop') r.noop++
          else r.won++
        }
        await settleTx(tx, p.row)
      } catch (e) {
        try { tx.abort() } catch { /* already finished */ }
        await done.catch(() => undefined)
        throw e
      }
      await done
      r.sent++
    }
  }

  async function run(): Promise<PushRunResult> {
    const r = emptyRun('idle')
    lastRunAt = now().toISOString()
    const tracker = createProgressTracker('send', deps.progress ?? (() => undefined))
    const tried = new Set<string>()
    try {
      if (!db.canWrite()) { block = 'idle'; r.block = block; return r } // another tab is the writer
      if ((await outboxCounts(db)).pending === 0) { block = 'idle'; r.block = block; return r }
      const { port, creds } = await deps.connect().catch((e) => { const k = classifyFailure(e); throw k instanceof Pause ? k : e })
      const offsetMs = await ensureClockOffset(db, port, () => now().getTime())
      tracker.begin((await outboxCounts(db)).pending)
      let counted = 0
      for (let batches = 0; batches < PUSH_MAX_BATCHES_PER_RUN; batches++) {
        const rows = (await listPending(db, PUSH_BATCH_ROWS + tried.size)).filter((x) => !tried.has(x.id)).slice(0, PUSH_BATCH_ROWS)
        if (rows.length === 0) break
        const batch: Prepared[] = []
        let bytes = 0
        let progressed = false
        for (const row of rows) {
          let p: Prepared | null
          try { p = await prepare(row, offsetMs) } catch (e) {
            progressed = true; tried.add(row.id); r.failedAttempts++
            if (await blame(row, `Could not prepare the change: ${errText(e)}`)) r.poisoned++
            continue
          }
          if (p === null) { await settleRow(row); r.sent++; progressed = true; continue }
          const size = bytesOf(p.item.payload)
          if (size > PHONE_PAYLOAD_MAX_BYTES) {
            progressed = true; tried.add(row.id); r.failedAttempts++
            if (await blame(row, 'This record is too large to send to the notebook.')) r.poisoned++
            continue
          }
          if (batch.length > 0 && (bytes + size > PUSH_BATCH_MAX_BYTES || batch.length + 1 > PHONE_PUSH_MAX_ITEMS)) break
          batch.push(p); bytes += size
        }
        if (batch.length > 0) { await sendBatch(port, creds, batch, r, tried); progressed = true }
        tracker.advance(r.sent - counted); counted = r.sent
        if (!progressed) break
      }
      block = 'idle'; lastError = null; lastSuccessAt = now().toISOString(); failures = 0
    } catch (e) {
      const k = classifyFailure(e)
      if (k instanceof Pause) { block = k.block; lastError = k.message; failures++ }
      else { block = 'offline'; lastError = errText(e); failures++ }
    } finally {
      tracker.end()
      sentTotal += r.sent
    }
    r.block = block
    return r
  }

  async function settleRow(row: OutboxRow): Promise<void> {
    db.assertWritable()
    const tx = db.idb.transaction('sync_outbox', 'readwrite')
    await settleTx(tx, row)
    await txDone(tx)
  }

  function runOnce(): Promise<PushRunResult> {
    if (current) return current
    current = run()
      .catch((e): PushRunResult => { lastError = errText(e); return emptyRun(block) })
      .finally(() => { current = null; schedule() })
    return current
  }

  return {
    start() { if (started) return; started = true; block = 'idle'; kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS) },
    stop() {
      started = false
      block = 'stopped'
      if (timer !== null) clearTimer(timer)
      if (kickTimer !== null) clearTimer(kickTimer)
      timer = kickTimer = null
    },
    kick() { if (!started || kickTimer !== null || failures > 0) return; kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS) },
    notifyOnline() { if (!started) return; failures = 0; if (kickTimer === null) kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PUSH_KICK_DELAY_MS) },
    runOnce,
    status: () => ({ running: current !== null, block, consecutiveFailures: failures, nextDelayMs: pushDelayMs(failures), lastRunAt, lastSuccessAt, lastError, sentTotal })
  }
}
