import { SharedTransportError, type ActivateArgs, type ActivateResult, type BranchScope, type ManifestArgs, type ManifestRow, type NameFreeArgs, type PullArgs as SharedPullArgs, type PullResult as SharedPullResult, type PushArgs as SharedPushArgs, type PushResultItem, type RenameArgs, type SharedBranchInfo, type SharedSession, type SharedStoreTransport, type SignInArgs } from './sharedTransport'
import { TransportError, type BranchArgs, type PullArgs, type PullResult, type PushArgs, type RegisterArgs, type RegisterResult, type SyncTransport, type BranchRef } from './transport'

/**
 * Phase 60 - a hostile network around any `SyncTransport` (normally the `InMemoryTransport`), for the two-branch
 * simulation and the soak test. Seeded, so a failing run replays exactly. No real timers: delays are VIRTUAL
 * (summed into the metrics, optionally handed to `sleep`), so a thousand operations run in milliseconds.
 *
 * Two kinds of loss, because they break different things:
 *  - `dropBefore`: the request never arrives (the server did nothing) - a plain retry fixes it.
 *  - `dropAfter`: the server DID the work, but the answer is lost - the client retries what already happened.
 *    That is the case that creates duplicates (a push sent twice, an ack that has to be repeated), so it is the one the
 *    idempotent apply and the cursor / pending-ack logic exist for.
 * Connection-class errors only (`offline` / `timeout`): a lost message must never look like a license or content problem.
 */
export interface FlakyOptions {
  /** Returns a number in [0, 1). Use a seeded generator. */
  rand: () => number
  /** Chance the request is lost before the server sees it. */
  dropBefore?: number
  /** Chance the server processes the request but the answer is lost. */
  dropAfter?: number
  /** Virtual delay per call is uniform in [0, maxDelayMs]. */
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Hard switch for "no network at all" phases. */
  down?: () => boolean
  /** Limit the loss to these calls (`push`, `pull`, `ack`, `list`, `touch`, `register`); default all. */
  only?: string[]
}

export interface TransportMetrics {
  calls: number
  dropsBefore: number
  dropsAfter: number
  /** Calls refused because the harness switched the network off. */
  downRefusals: number
  /** Sum of the simulated delays (what the owner would have waited). */
  virtualDelayMs: number
  /** Items / ids that went through the call that the server really processed. */
  pushedItems: number
  pulledItems: number
  ackedIds: number
  /** Bytes of base64 ciphertext handed to `push` and received by `pull`. */
  pushedBytes: number
  pulledBytes: number
  byFn: Record<string, number>
}

export const emptyMetrics = (): TransportMetrics => ({
  calls: 0, dropsBefore: 0, dropsAfter: 0, downRefusals: 0, virtualDelayMs: 0,
  pushedItems: 0, pulledItems: 0, ackedIds: 0, pushedBytes: 0, pulledBytes: 0, byFn: {}
})

/** One-line, content-free summary for the log (counts and sizes only - never a bill). */
export function formatMetrics(m: TransportMetrics): string {
  const fns = Object.entries(m.byFn).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(' ')
  return `calls=${m.calls} (${fns}) lostBefore=${m.dropsBefore} lostAfter=${m.dropsAfter} down=${m.downRefusals} ` +
    `pushed=${m.pushedItems} items/${m.pushedBytes}B pulled=${m.pulledItems} items/${m.pulledBytes}B acked=${m.ackedIds} simulatedWait=${m.virtualDelayMs}ms`
}

export class FlakyTransport implements SyncTransport {
  readonly metrics: TransportMetrics = emptyMetrics()
  /** Probabilities may be changed mid-run (e.g. set to 0 for the final settle). */
  dropBefore: number
  dropAfter: number
  maxDelayMs: number

  constructor(private readonly inner: SyncTransport, private readonly o: FlakyOptions) {
    this.dropBefore = o.dropBefore ?? 0
    this.dropAfter = o.dropAfter ?? 0
    this.maxDelayMs = o.maxDelayMs ?? 0
  }

  private async around<T>(fn: string, run: () => Promise<T>, count?: (r: T) => void): Promise<T> {
    const m = this.metrics
    m.calls++
    m.byFn[fn] = (m.byFn[fn] ?? 0) + 1
    if (this.o.down?.()) { m.downRefusals++; throw new TransportError('offline') }
    const wait = Math.floor(this.o.rand() * (this.maxDelayMs + 1))
    m.virtualDelayMs += wait
    if (wait > 0 && this.o.sleep) await this.o.sleep(wait)
    const hit = !this.o.only || this.o.only.includes(fn)
    if (hit && this.o.rand() < this.dropBefore) { m.dropsBefore++; throw new TransportError(this.o.rand() < 0.5 ? 'offline' : 'timeout') }
    const r = await run()
    count?.(r)
    if (hit && this.o.rand() < this.dropAfter) { m.dropsAfter++; throw new TransportError(this.o.rand() < 0.5 ? 'offline' : 'timeout') }
    return r
  }

  registerBranch(a: RegisterArgs): Promise<RegisterResult> { return this.around('register', () => this.inner.registerBranch(a)) }
  listBranches(a: BranchArgs): Promise<(BranchRef & { lastSeenAt: string | null })[]> { return this.around('list', () => this.inner.listBranches(a)) }
  pendingCount(a: BranchArgs): Promise<{ pending: number }> { return this.around('count', () => this.inner.pendingCount(a)) }
  touch(a: BranchArgs): Promise<{ serverTime: string }> { return this.around('touch', () => this.inner.touch(a)) }
  push(a: PushArgs): Promise<{ ids: number[] }> {
    return this.around('push', () => this.inner.push(a), () => { this.metrics.pushedItems += a.items.length; this.metrics.pushedBytes += a.items.reduce((n, i) => n + i.ciphertext.length, 0) })
  }
  pull(a: PullArgs): Promise<PullResult> {
    return this.around('pull', () => this.inner.pull(a), (r) => { this.metrics.pulledItems += r.items.length; this.metrics.pulledBytes += r.items.reduce((n, i) => n + i.ciphertext.length, 0) })
  }
  ack(a: BranchArgs & { ids: number[] }): Promise<{ deleted: number }> {
    return this.around('ack', () => this.inner.ack(a), () => { this.metrics.ackedIds += a.ids.length })
  }
}

/**
 * Phase 141 - the same hostile network around the v2 `SharedStoreTransport` (normally `InMemorySharedTransport`). Seeded, virtual delays only.
 *  - `dropBefore`: the request never arrives. `dropAfter`: the server DID the work but the answer is lost (the case that creates duplicates).
 *  - `duplicate`: the request is delivered TWICE (a retried / replayed request); the caller gets the first answer. Push and pull only: a repeated
 *    push is the server's `noop` rule, a repeated pull is a plain re-read.
 *  - `down()`: no network at all. Sign-in, session and doorbell calls are never lost (they are not part of the data path being proved).
 * Connection-class errors only (`offline` / `timeout`), so a lost message never looks like a license or content problem.
 */
export interface FlakySharedOptions {
  rand: () => number
  dropBefore?: number
  dropAfter?: number
  duplicate?: number
  maxDelayMs?: number
  down?: () => boolean
  /** Limit the loss to these calls (`push`, `pull`, `manifest`, `now`, `touch`, `list`); default all of them. */
  only?: string[]
}
export interface SharedMetrics { calls: number; dropsBefore: number; dropsAfter: number; duplicates: number; downRefusals: number; virtualDelayMs: number; byFn: Record<string, number> }

export class FlakySharedTransport implements SharedStoreTransport {
  readonly metrics: SharedMetrics = { calls: 0, dropsBefore: 0, dropsAfter: 0, duplicates: 0, downRefusals: 0, virtualDelayMs: 0, byFn: {} }
  dropBefore: number
  dropAfter: number
  duplicate: number
  maxDelayMs: number

  constructor(private readonly inner: SharedStoreTransport, private readonly o: FlakySharedOptions) {
    this.dropBefore = o.dropBefore ?? 0; this.dropAfter = o.dropAfter ?? 0; this.duplicate = o.duplicate ?? 0; this.maxDelayMs = o.maxDelayMs ?? 0
  }
  /** Stops all loss (the final settle of a test). */
  heal(): void { this.dropBefore = 0; this.dropAfter = 0; this.duplicate = 0 }

  private async around<T>(fn: string, run: () => Promise<T>, canDuplicate = false): Promise<T> {
    const m = this.metrics
    m.calls++; m.byFn[fn] = (m.byFn[fn] ?? 0) + 1
    if (this.o.down?.()) { m.downRefusals++; throw new SharedTransportError('offline') }
    m.virtualDelayMs += Math.floor(this.o.rand() * (this.maxDelayMs + 1))
    const hit = !this.o.only || this.o.only.includes(fn)
    if (hit && this.o.rand() < this.dropBefore) { m.dropsBefore++; throw new SharedTransportError(this.o.rand() < 0.5 ? 'offline' : 'timeout') }
    const r = await run()
    if (hit && canDuplicate && this.o.rand() < this.duplicate) { m.duplicates++; try { await run() } catch { /* the replay's own failure is invisible to the caller */ } }
    if (hit && this.o.rand() < this.dropAfter) { m.dropsAfter++; throw new SharedTransportError(this.o.rand() < 0.5 ? 'offline' : 'timeout') }
    return r
  }

  signIn(a: SignInArgs): Promise<SharedSession> { return this.inner.signIn(a) }
  restoreSession(s: SharedSession): Promise<SharedSession> { return this.inner.restoreSession(s) }
  onSessionChange(cb: (s: SharedSession) => void): () => void { return this.inner.onSessionChange(cb) }
  signOut(): Promise<void> { return this.inner.signOut() }
  activate(a: ActivateArgs): Promise<ActivateResult> { return this.inner.activate(a) }
  branchNameFree(a: NameFreeArgs): Promise<boolean> { return this.inner.branchNameFree(a) }
  renameBranch(a: RenameArgs): Promise<{ branchId: string; name: string }> { return this.inner.renameBranch(a) }
  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void { return this.inner.subscribeDoorbell(a, onRing, onLive) }
  listBranches(a: BranchScope): Promise<SharedBranchInfo[]> { return this.around('list', () => this.inner.listBranches(a)) }
  now(): Promise<{ serverTime: string }> { return this.around('now', () => this.inner.now()) }
  touch(a: BranchScope): Promise<{ serverTime: string }> { return this.around('touch', () => this.inner.touch(a)) }
  manifest(a: ManifestArgs): Promise<ManifestRow[]> { return this.around('manifest', () => this.inner.manifest(a)) }
  push(a: SharedPushArgs): Promise<PushResultItem[]> { return this.around('push', () => this.inner.push(a), true) }
  pull(a: SharedPullArgs): Promise<SharedPullResult> { return this.around('pull', () => this.inner.pull(a), true) }
}
