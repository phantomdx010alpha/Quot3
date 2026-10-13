import type { BillRepo } from '../db/billRepo'
import type { OutboxRepo } from '../db/outboxRepo'
import type { ItemRulesRepo } from '../db/itemRulesRepo'
import { ITEM_RULE_REVISION, itemRuleSnapshot } from '../../shared/sync/itemRule'
import type { Logger } from '../logger'
import type { OutboxItem } from '../../shared/sync/outbox'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import {
  PUSH_BATCH_MAX_BYTES, PUSH_BATCH_ROWS, PUSH_CONNECTIVITY_KINDS, PUSH_KICK_DELAY_MS, PUSH_LICENSE_KINDS, PUSH_MAX_BATCHES_PER_RUN,
  pushDelayMs, type PushBlock, type PushRunResult, type PushStatus
} from '../../shared/sync/push'
import { seal, sealedToParts, SyncCryptoError } from './crypto'
import { PUSH_MAX_ITEMS, POSTBOX_MAX_CIPHERTEXT, TransportError, type PushItem, type SyncTransport } from './transport'

/**
 * Phase 55 - the push worker (docs/SYNC_POSTBOX_SPEC.md section 6). It takes unsent outbox rows oldest first, builds each
 * bill snapshot AT PUSH TIME, seals it with the org key and sends one postbox row per OTHER branch (fan-out) in one
 * all-or-nothing `qt_push` call, then marks the outbox rows sent. Everything is async; the only synchronous work is a
 * bounded number of SQLite reads per batch, so the UI never waits for it.
 *
 * Failure rules (what counts against a row):
 *  - no connection / timeout / server trouble: NOTHING counts, the whole worker backs off (15 s -> doubles -> 10 min cap);
 *  - the server refuses the license or branch: the worker pauses (`block: 'license'`), no row is blamed;
 *  - a missing encryption key: the worker pauses (`block: 'no_key'`), no row is blamed;
 *  - a bad request (invalid / too large / too many) or a row that cannot be sealed: that row's attempt counter goes up;
 *    after 10 attempts the row becomes `failed` (poison) and the rest keep flowing. A multi-row batch that is refused for
 *    such a reason is retried one row at a time so one bad bill cannot hold up the others.
 * All state that matters is in SQLite, so a restart simply resumes with whatever is still pending.
 */
export interface PushWorkerCredentials { url: string; anonKey: string; license: string; branchId: string }

export interface PushWorkerDeps {
  outbox: OutboxRepo
  bills: Pick<BillRepo, 'getRecord' | 'getRows'>
  /** Phase 111: owner item rules. An outbox row whose id is not a bill but is a rule is sent as an `item_rule` snapshot. Optional (tests, older wiring). */
  itemRules?: Pick<ItemRulesRepo, 'get'>
  credentials: () => PushWorkerCredentials | null
  encryptionKey: () => Buffer | null
  /** The other registered branches as stored at activation. */
  recipients: () => string[]
  makeTransport: (cfg: { url: string; anonKey: string }) => SyncTransport
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** Phase 89: "Sending N of M" events (optional; tests and headless use leave it out). */
  progress?: (p: SyncProgress) => void
}

export interface PushWorkerOptions {
  now?: () => Date
  /** Timer seam for tests. Defaults to `setTimeout` / `clearTimeout` (the handle is `unref`ed). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** How long after the last run the list of other branches is asked from the server again. */
  branchRefreshMs?: number
}

export interface PushWorker {
  /** Starts the 15 s loop and does a first run soon. Safe to call twice. */
  start(): void
  stop(): void
  /** "A bill was just saved": run soon (coalesced). Cheap; does nothing while stopped or while backing off (see `notifyOnline`). */
  kick(): void
  /** "The connection is back" (or the owner pressed retry): forget the backoff and run soon. */
  notifyOnline(): void
  /** One pass over the outbox now. Never throws. Concurrent calls share the run that is already going. */
  runOnce(): Promise<PushRunResult>
  status(): PushStatus
}

interface Prepared { row: OutboxItem; billId: string; revision: number; op: 'upsert' | 'delete'; updatedAt: string; sealed: string }

class Pause extends Error { constructor(readonly block: PushBlock, msg: string) { super(msg) } }

const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error')

export function createPushWorker(deps: PushWorkerDeps, opts: PushWorkerOptions = {}): PushWorker {
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const branchRefreshMs = opts.branchRefreshMs ?? 600_000
  const { outbox, log } = deps

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PushRunResult> | null = null
  let failures = 0
  let block: PushBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let sentTotal = 0
  let others: { ids: string[]; at: number } | null = null

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pushDelayMs(failures))
  }

  /** The other branches: the stored list, refreshed from the server now and then so a branch that joined later is included. */
  async function recipientsFor(transport: SyncTransport, c: PushWorkerCredentials): Promise<string[]> {
    const t = now().getTime()
    if (others === null || t - others.at >= branchRefreshMs) {
      try {
        const list = await transport.listBranches({ license: c.license, branchId: c.branchId })
        others = { ids: list.map((b) => b.branchId).filter((id) => id !== c.branchId), at: t }
      } catch (e) {
        if (e instanceof TransportError && (PUSH_LICENSE_KINDS as readonly string[]).includes(e.kind)) throw e
        if (e instanceof TransportError && (PUSH_CONNECTIVITY_KINDS as readonly string[]).includes(e.kind)) throw e
        // Anything else: fall back to the list stored at activation.
        log.warn('Could not refresh the branch list; using the stored one', { err: errText(e) })
        others = { ids: deps.recipients(), at: t - branchRefreshMs + 60_000 }
      }
    }
    return others.ids
  }

  /** Builds and seals one row. Returns null when there is nothing to send (the bill was purged). Throws for a row that cannot be sent. */
  function prepare(row: OutboxItem, key: Buffer): Prepared | null {
    const record = deps.bills.getRecord(row.billId) as (Record<string, unknown> & { revision: number; updatedAt: string; deletedAt: string | null }) | undefined
    if (!record) {
      // Phase 111: ids of bills and rules never collide (different uuid sources), so the row's id says which it is. Neither = purged.
      const rule = deps.itemRules?.get(row.billId)
      if (!rule) return null
      const sealedRule = seal(key, itemRuleSnapshot(rule), row.billId, ITEM_RULE_REVISION)
      return { row, billId: row.billId, revision: ITEM_RULE_REVISION, op: rule.deletedAt ? 'delete' : 'upsert', updatedAt: rule.updatedAt, sealed: sealedRule }
    }
    const { syncState: _local, ...bill } = record
    void _local
    const rows = deps.bills.getRows(row.billId)
    const op = record.deletedAt ? 'delete' : 'upsert'
    const snapshot = { v: 1, bill, rows, deleted: record.deletedAt !== null }
    const sealed = seal(key, snapshot, row.billId, record.revision)
    return { row, billId: row.billId, revision: record.revision, op, updatedAt: record.updatedAt, sealed }
  }

  function itemsFor(p: Prepared, to: string[]): PushItem[] {
    const { nonce, ciphertext } = sealedToParts(p.sealed)
    return to.map((toBranch) => ({ toBranch, billId: p.billId, op: p.op, revision: p.revision, updatedAt: p.updatedAt, nonce, ciphertext }))
  }

  /** Counts one failed attempt for a row. Returns true when the row just became `failed`. */
  function blame(row: OutboxItem, msg: string): boolean {
    const state = outbox.markAttempt(row.id, msg)
    if (state === 'failed') log.error('Sync gave up on a change after repeated failures', { billId: row.billId, outboxId: row.id, error: msg })
    return state === 'failed'
  }

  async function sendBatch(transport: SyncTransport, c: PushWorkerCredentials, prepared: Prepared[], to: string[], r: PushRunResult, tried: Set<number>): Promise<void> {
    const items = prepared.flatMap((p) => itemsFor(p, to))
    try {
      await transport.push({ license: c.license, branchId: c.branchId, items })
    } catch (e) {
      if (!(e instanceof TransportError)) throw e
      if ((PUSH_CONNECTIVITY_KINDS as readonly string[]).includes(e.kind)) throw new Pause('offline', e.message)
      if ((PUSH_LICENSE_KINDS as readonly string[]).includes(e.kind)) throw new Pause('license', e.message)
      // The server refused the request itself. Isolate the culprit: one row at a time (a single row is blamed).
      if (prepared.length > 1) {
        for (const p of prepared) await sendBatch(transport, c, [p], to, r, tried)
        return
      }
      const p = prepared[0] as Prepared
      tried.add(p.row.id)
      r.failedAttempts++
      if (blame(p.row, e.message)) r.poisoned++
      return
    }
    for (const p of prepared) { outbox.markSynced(p.row.id); r.sent++ }
  }

  async function run(): Promise<PushRunResult> {
    const r: PushRunResult = { sent: 0, failedAttempts: 0, poisoned: 0, block: 'idle' }
    lastRunAt = now().toISOString()
    const c = deps.credentials()
    if (!c) { block = 'not_activated'; r.block = block; return r }
    const key = deps.encryptionKey()
    if (!key) { block = 'no_key'; r.block = block; lastError = 'The encryption key is missing. Activate sync again.'; return r }
    let transport: SyncTransport | null = null
    /** Rows already blamed in THIS run: they wait for the next run instead of being retried in a tight loop. */
    const tried = new Set<number>()
    const tracker = createProgressTracker('send', deps.progress ?? (() => undefined))
    tracker.begin(outbox.counts().pending)
    let counted = 0
    try {
      for (let batches = 0; batches < PUSH_MAX_BATCHES_PER_RUN; batches++) {
        const rows = outbox.pending(PUSH_BATCH_ROWS + tried.size).filter((x) => !tried.has(x.id)).slice(0, PUSH_BATCH_ROWS)
        if (rows.length === 0) break
        transport ??= deps.makeTransport({ url: c.url, anonKey: c.anonKey })
        const to = await recipientsFor(transport, c)
        const prepared: Prepared[] = []
        let bytes = 0
        let progressed = false
        for (const row of rows) {
          // Bad rows are blamed here and skipped, so they cannot block the ones behind them.
          let p: Prepared | null
          try { p = prepare(row, key) } catch (e) {
            progressed = true; tried.add(row.id)
            r.failedAttempts++
            if (blame(row, e instanceof SyncCryptoError ? e.message : `Could not prepare the change: ${errText(e)}`)) r.poisoned++
            continue
          }
          if (p === null) { outbox.markSynced(row.id); r.sent++; progressed = true; continue } // bill purged: nothing left to send
          if (to.length === 0) { outbox.markSynced(row.id); r.sent++; progressed = true; continue } // no other branch yet
          const perRow = p.sealed.length // base64 text, about 4/3 of the bytes the server counts
          const size = perRow * to.length
          if (perRow * 3 / 4 > POSTBOX_MAX_CIPHERTEXT) {
            progressed = true; tried.add(row.id)
            r.failedAttempts++
            if (blame(row, 'This bill is too large to send to other branches.')) r.poisoned++
            continue
          }
          if (prepared.length > 0 && (bytes + size > PUSH_BATCH_MAX_BYTES || (prepared.length + 1) * to.length > PUSH_MAX_ITEMS)) break
          prepared.push(p); bytes += size
        }
        if (prepared.length > 0) { await sendBatch(transport, c, prepared, to, r, tried); progressed = true }
        tracker.advance(r.sent - counted); counted = r.sent
        if (!progressed) break
      }
      block = 'idle'
      lastError = null
      lastSuccessAt = now().toISOString()
      failures = 0
    } catch (e) {
      if (e instanceof Pause) {
        block = e.block
        lastError = e.message
        failures++
        if (e.block === 'offline') log.info('Sync push is waiting for the connection', { failures })
        else log.warn('Sync push paused', { reason: e.block })
      } else if (e instanceof TransportError) {
        const license = (PUSH_LICENSE_KINDS as readonly string[]).includes(e.kind)
        block = license ? 'license' : 'offline'
        lastError = e.message
        failures++
      } else {
        block = 'offline'
        lastError = errText(e)
        failures++
        log.error('Sync push failed unexpectedly', { err: lastError })
      }
      r.block = block
      return r
    } finally {
      tracker.end()
      sentTotal += r.sent
    }
    r.block = block
    return r
  }

  function runOnce(): Promise<PushRunResult> {
    if (current) return current
    current = run()
      .catch((e): PushRunResult => { lastError = errText(e); return { sent: 0, failedAttempts: 0, poisoned: 0, block } })
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
