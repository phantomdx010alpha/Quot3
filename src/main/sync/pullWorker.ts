import type { SyncStateRepo } from '../db/syncStateRepo'
import type { RemoteApplyRepo } from '../db/remoteApplyRepo'
import type { Logger } from '../logger'
import { PUSH_CONNECTIVITY_KINDS, PUSH_LICENSE_KINDS } from '../../shared/sync/push'
import {
  PULL_KICK_DELAY_MS, PULL_MAX_PAGES_PER_RUN, PULL_PAGE_SIZE, PULL_SKIPPED_KEEP, PULL_SKIP_AFTER_ATTEMPTS, pullDelayMs, remoteSnapshotSchema,
  type PullBlock, type PullRunResult, type PullStatus, type RemoteChangedEvent
} from '../../shared/sync/pull'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { isItemRulePayload, itemRuleSnapshotSchema, type ItemRuleSnapshot } from '../../shared/sync/itemRule'
import { open, partsToSealed } from './crypto'
import type { ItemRuleApplier } from './itemRuleApplier'
import { UnknownBranchError, type RemoteApplier } from './remoteApplier'
import { ACK_MAX_IDS, TransportError, type BranchRef, type PulledItem, type SyncTransport } from './transport'

/**
 * Phase 56 - the pull worker (docs/SYNC_POSTBOX_SPEC.md section 6): every 30 s, on start and when the connection is back.
 *
 * Per row: decrypt (key check, then the GCM tag with bill id + revision as AAD) -> validate -> apply in ONE transaction that
 * also moves the cursor (`sync.lastPulledId`) and records the row as "applied, not yet acknowledged" (`sync.pendingAck`).
 * After each page the applied ids are acknowledged and removed from `sync.pendingAck`. A crash anywhere replays safely:
 * the cursor says where to resume, an unacknowledged id is acknowledged at the next run, and applying twice is a no-op.
 *
 * A row that cannot be decrypted or applied stops the run at that row (the cursor does not pass it, it is NOT acknowledged).
 * After 10 runs in a row on the same row it is skipped for good so it cannot block everything behind it; it stays unacknowledged
 * on the server and is listed in the status. Connectivity trouble, a refused license and a missing key pause the worker without blaming any row.
 */
export interface PullWorkerCredentials { url: string; anonKey: string; license: string; branchId: string }

export const PULL_KEYS = {
  cursor: 'sync.lastPulledId',
  pendingAck: 'sync.pendingAck',
  failing: 'sync.pullFailing',
  skipped: 'sync.pullSkipped'
} as const

export interface PullWorkerDeps {
  sync: SyncStateRepo
  repo: Pick<RemoteApplyRepo, 'transaction'>
  applier: RemoteApplier
  /**
   * Phase 111: applies `item_rule` rows. Left out = this branch does not know the kind: such a row is acknowledged and ignored (cursor moves on,
   * nothing is stored), never blamed, so it cannot hold up the bills behind it.
   */
  itemRules?: ItemRuleApplier
  credentials: () => PullWorkerCredentials | null
  encryptionKey: () => Buffer | null
  makeTransport: (cfg: { url: string; anonKey: string }) => SyncTransport
  emit: (channel: 'bills:remoteChanged', payload: RemoteChangedEvent) => void
  /** Phase 89: "Receiving N of M" events (optional). */
  progress?: (p: SyncProgress) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface PullWorkerOptions {
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export interface PullWorker {
  start(): void
  stop(): void
  /** The connection is back / the owner pressed retry: forget the backoff and run soon. */
  notifyOnline(): void
  runOnce(): Promise<PullRunResult>
  status(): PullStatus
}

class Pause extends Error { constructor(readonly block: PullBlock, msg: string) { super(msg) } }
class RowFailure extends Error {}

const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error')
const readJson = <T>(raw: string | undefined, fallback: T): T => { if (raw === undefined) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }

export function createPullWorker(deps: PullWorkerDeps, opts: PullWorkerOptions = {}): PullWorker {
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const { sync, log } = deps

  let started = false
  let timer: unknown = null
  let kickTimer: unknown = null
  let current: Promise<PullRunResult> | null = null
  let failures = 0
  let block: PullBlock = 'stopped'
  let lastRunAt: string | null = null, lastSuccessAt: string | null = null, lastError: string | null = null
  let appliedTotal = 0

  const cursor = (): number => { const n = Number(sync.get(PULL_KEYS.cursor) ?? '0'); return Number.isSafeInteger(n) && n >= 0 ? n : 0 }
  const pendingAck = (): number[] => readJson<number[]>(sync.get(PULL_KEYS.pendingAck), []).filter((n) => Number.isSafeInteger(n))
  const skipped = (): { id: number; billId: string | null; error: string }[] => readJson(sync.get(PULL_KEYS.skipped), [])

  function schedule(): void {
    if (!started) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => { timer = null; void runOnce() }, pullDelayMs(failures))
  }

  /** Acknowledges what was applied. Connectivity / license trouble pauses the run; the ids stay recorded and go out at the next run. */
  async function flushAcks(transport: SyncTransport, c: PullWorkerCredentials): Promise<void> {
    for (;;) {
      const ids = pendingAck().slice(0, ACK_MAX_IDS)
      if (ids.length === 0) return
      try {
        await transport.ack({ license: c.license, branchId: c.branchId, ids })
      } catch (e) { throw asPause(e) }
      const gone = new Set(ids)
      sync.set(PULL_KEYS.pendingAck, JSON.stringify(pendingAck().filter((n) => !gone.has(n))))
    }
  }

  function asPause(e: unknown): unknown {
    if (e instanceof TransportError) {
      if ((PUSH_CONNECTIVITY_KINDS as readonly string[]).includes(e.kind)) return new Pause('offline', e.message)
      if ((PUSH_LICENSE_KINDS as readonly string[]).includes(e.kind)) return new Pause('license', e.message)
    }
    return e
  }

  /** Decrypts and validates one row (a bill or, Phase 111, an item rule). Throws `RowFailure` with a plain message. */
  function decrypt(item: PulledItem, key: Buffer): { kind: 'bill'; snap: ReturnType<typeof remoteSnapshotSchema.parse> } | { kind: 'rule'; snap: ItemRuleSnapshot } {
    let plain: unknown
    try { plain = open(key, partsToSealed(item.nonce, item.ciphertext), item.billId, item.revision) } catch (e) { throw new RowFailure(errText(e)) }
    if (isItemRulePayload(plain)) {
      const rr = itemRuleSnapshotSchema.safeParse(plain) // unknown extra fields are stripped, a malformed rule is a failed row like any other
      if (!rr.success) throw new RowFailure('The item rule has an unexpected shape (made by a newer version of the app?).')
      return { kind: 'rule', snap: rr.data }
    }
    const r = remoteSnapshotSchema.safeParse(plain)
    if (!r.success) throw new RowFailure('The change has an unexpected shape (made by a newer version of the app?).')
    return { kind: 'bill', snap: r.data }
  }

  /** A row failed: count it; after enough runs in a row it is skipped (kept unacknowledged) so the rest can flow. Returns true when skipped. */
  function noteFailure(item: PulledItem, message: string): boolean {
    const prev = readJson<{ id: number; n: number } | null>(sync.get(PULL_KEYS.failing), null)
    const n = prev && prev.id === item.id ? prev.n + 1 : 1
    if (n < PULL_SKIP_AFTER_ATTEMPTS) { sync.set(PULL_KEYS.failing, JSON.stringify({ id: item.id, n })); return false }
    deps.repo.transaction(() => {
      sync.set(PULL_KEYS.skipped, JSON.stringify([...skipped(), { id: item.id, billId: item.billId, error: message.slice(0, 300) }].slice(-PULL_SKIPPED_KEEP)))
      sync.set(PULL_KEYS.cursor, String(item.id))
      sync.remove([PULL_KEYS.failing])
    })
    log.error('Sync gave up on an incoming change (left unacknowledged on the server)', { postboxId: item.id, billId: item.billId, error: message })
    return true
  }

  async function run(): Promise<PullRunResult> {
    const r: PullRunResult = { received: 0, applied: 0, ignored: 0, held: 0, skipped: 0, conflicts: 0, block: 'idle' }
    lastRunAt = now().toISOString()
    const c = deps.credentials()
    if (!c) { block = 'not_activated'; r.block = block; return r }
    const key = deps.encryptionKey()
    if (!key) { block = 'no_key'; r.block = block; lastError = 'The encryption key is missing. Activate sync again.'; return r }
    const transport = deps.makeTransport({ url: c.url, anonKey: c.anonKey })
    let branches: BranchRef[] | null = null
    const branchList = async (refresh = false): Promise<BranchRef[]> => {
      if (branches === null || refresh) {
        try { branches = await transport.listBranches({ license: c.license, branchId: c.branchId }) } catch (e) { throw asPause(e) }
      }
      return branches
    }
    const tracker = createProgressTracker('receive', deps.progress ?? (() => undefined))
    try {
      await flushAcks(transport, c)
      // The "of M": rows waiting on the server. If the count call fails the bar simply grows with what arrives.
      let known = 0
      try { known = (await transport.pendingCount({ license: c.license, branchId: c.branchId })).pending } catch (e) { const p = asPause(e); if (p instanceof Pause) throw p }
      tracker.begin(known)
      let stop = false
      for (let page = 0; page < PULL_MAX_PAGES_PER_RUN && !stop; page++) {
        let res
        try { res = await transport.pull({ license: c.license, branchId: c.branchId, afterId: cursor(), limit: PULL_PAGE_SIZE }) } catch (e) { throw asPause(e) }
        for (const item of res.items) {
          r.received++
          try {
            const dec = decrypt(item, key)
            const meta = { fromBranch: item.fromBranch, billId: item.billId, op: item.op, revision: item.revision, updatedAt: item.updatedAt }
            const attempt = (list: readonly BranchRef[]) => deps.repo.transaction(() => {
              const outcome = dec.kind === 'bill' ? deps.applier.apply(meta, dec.snap, list) : deps.itemRules ? deps.itemRules.apply(meta, dec.snap) : 'ignored'
              sync.setMany({ [PULL_KEYS.cursor]: String(item.id), [PULL_KEYS.pendingAck]: JSON.stringify([...pendingAck(), item.id]) })
              sync.remove([PULL_KEYS.failing])
              return outcome
            })
            let outcome
            try { outcome = attempt(branches ?? []) } catch (e) {
              if (!(e instanceof UnknownBranchError)) throw e
              outcome = attempt(await branchList(true)) // a branch we have not met yet: ask the server once
            }
            tracker.advance(1)
            if (outcome === 'ignored') r.ignored++
            else if (dec.kind === 'rule') { r.applied++; appliedTotal++ } // a rule never opens the editor: no bills:remoteChanged
            else if (outcome === 'held') { r.held++; deps.emit('bills:remoteChanged', { id: item.billId, held: true }) }
            else { r.applied++; appliedTotal++; if (outcome === 'conflicted') r.conflicts++; deps.emit('bills:remoteChanged', { id: item.billId, held: false, ...(outcome === 'conflicted' ? { conflict: true as const } : {}) }) }
          } catch (e) {
            if (e instanceof Pause) throw e
            const msg = e instanceof RowFailure ? e.message : e instanceof UnknownBranchError ? 'The change comes from a branch this license does not list.' : `Could not apply the change: ${errText(e)}`
            lastError = msg
            if (noteFailure(item, msg)) { r.skipped++; continue }
            throw new Pause('decrypt', msg)
          }
        }
        await flushAcks(transport, c)
        if (!res.hasMore) stop = true
      }
      block = 'idle'; lastError = null; lastSuccessAt = now().toISOString(); failures = 0
    } catch (e) {
      const p = e instanceof Pause ? e : null
      block = p ? p.block : 'offline'
      lastError = errText(e)
      failures++
      if (!p) log.error('Sync pull failed unexpectedly', { err: lastError })
      else if (p.block !== 'offline') log.warn('Sync pull paused', { reason: p.block })
    }
    tracker.end()
    r.block = block
    return r
  }

  function runOnce(): Promise<PullRunResult> {
    if (current) return current
    current = run()
      .catch((e): PullRunResult => { lastError = errText(e); return { received: 0, applied: 0, ignored: 0, held: 0, skipped: 0, conflicts: 0, block } })
      .finally(() => { current = null; schedule() })
    return current
  }

  const soon = (): void => { if (kickTimer === null) kickTimer = setTimer(() => { kickTimer = null; void runOnce() }, PULL_KICK_DELAY_MS) }

  return {
    start() { if (started) return; started = true; block = 'idle'; soon() },
    stop() {
      started = false; block = 'stopped'
      if (timer !== null) clearTimer(timer)
      if (kickTimer !== null) clearTimer(kickTimer)
      timer = kickTimer = null
    },
    notifyOnline() { if (!started) return; failures = 0; soon() },
    runOnce,
    status() {
      return {
        running: current !== null, block, consecutiveFailures: failures, nextDelayMs: pullDelayMs(failures), lastRunAt, lastSuccessAt, lastError,
        appliedTotal, cursor: cursor(), unacked: pendingAck().length, skipped: skipped(), held: deps.applier.held()
      }
    }
  }
}
