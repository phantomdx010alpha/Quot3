import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { LICENSE_KEY_RE, SERVER_PREFIX_RE, TRANSPORT_MESSAGES, normalizeLicenseKey, type TransportErrorKind } from '../../shared/sync/license'

/**
 * Phase 52 - the one door to the postbox (SYNC_POSTBOX_SPEC §9). `SupabaseTransport` talks to the RPCs in supabase/sql;
 * `InMemoryTransport` is the same behaviour in memory for tests and the two-virtual-branches dev harness (Phase 60).
 * Phase 54 adds push / pull / ack (the workers that call them are Phases 55-56). `nonce` and `ciphertext` are base64, split from a sealed bill by `crypto.sealedToParts`.
 */
export interface BranchRef { branchId: string; name: string; poPrefix: string }
export interface RegisterArgs { license: string; branchId: string; name: string; poPrefix: string; device: string }
export interface RegisterResult { orgId: string; /** base64 */ kdfSalt: string; branches: BranchRef[] }
export interface BranchArgs { license: string; branchId: string }
export type PostboxOp = 'upsert' | 'delete'
/** One encrypted change addressed to ONE other branch (fan-out = one item per recipient). */
export interface PushItem { toBranch: string; billId: string; op: PostboxOp; revision: number; updatedAt: string; nonce: string; ciphertext: string }
export interface PushArgs extends BranchArgs { items: PushItem[] }
export interface PullArgs extends BranchArgs { afterId: number; limit?: number }
export interface PulledItem { id: number; fromBranch: string; billId: string; op: PostboxOp; revision: number; updatedAt: string; nonce: string; ciphertext: string }
export interface PullResult { items: PulledItem[]; hasMore: boolean }
export const PUSH_MAX_ITEMS = 200
export const PULL_MAX_ITEMS = 200
export const ACK_MAX_IDS = 1000
export const POSTBOX_MAX_CIPHERTEXT = 1_048_576

export interface SyncTransport {
  registerBranch(a: RegisterArgs): Promise<RegisterResult>
  listBranches(a: BranchArgs): Promise<(BranchRef & { lastSeenAt: string | null })[]>
  touch(a: BranchArgs): Promise<{ serverTime: string }>
  /** All or nothing. Returns the server ids in input order. */
  push(a: PushArgs): Promise<{ ids: number[] }>
  /** Rows addressed to this branch with id > afterId, oldest first. Deletes nothing: call `ack` after applying. */
  pull(a: PullArgs): Promise<PullResult>
  /** Phase 89: how many rows wait for this branch (the "of N" of the receive progress). */
  pendingCount(a: BranchArgs): Promise<{ pending: number }>
  /** Deletes acknowledged rows addressed to this branch (others are ignored). */
  ack(a: BranchArgs & { ids: number[] }): Promise<{ deleted: number }>
}

export class TransportError extends Error {
  constructor(readonly kind: TransportErrorKind, readonly sqlstate?: string) {
    super(TRANSPORT_MESSAGES[kind])
    this.name = 'TransportError'
  }
}

/** SQLSTATE codes raised by supabase/sql/04_rpcs.sql. */
const SQLSTATE_KIND: Record<string, TransportErrorKind> = {
  Q3L01: 'license', Q3M01: 'unknown_branch', Q3B01: 'branch_limit', Q3B02: 'prefix_taken', Q3B03: 'branch_conflict',
  Q3I01: 'invalid_input', Q3I02: 'too_large', Q3I03: 'too_many'
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase over PostgREST (`POST {url}/rest/v1/rpc/{fn}`), anon key only.
// ---------------------------------------------------------------------------------------------------------------------

export interface HttpResponse { status: number; text(): Promise<string> }
export type FetchLike = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<HttpResponse>

export interface SupabaseTransportOptions {
  url: string
  anonKey: string
  fetch?: FetchLike
  /** Per attempt. */
  timeoutMs?: number
  /** Total tries for a network error / timeout / 5xx / 408 / 429 (never for a server answer about the license). */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
}

const branchRow = z.object({ branch_id: z.string().uuid(), name: z.string(), po_prefix: z.string() })
const registerRes = z.object({ org_id: z.string().uuid(), kdf_salt: z.string().min(1), branches: z.array(branchRow) })
const listRes = z.array(branchRow.extend({ last_seen_at: z.string().nullable().optional() }))
const touchRes = z.object({ ok: z.literal(true), server_time: z.string() })
const pushRes = z.object({ ids: z.array(z.number().int().nonnegative()) })
const pulledRow = z.object({
  id: z.number().int().nonnegative(), from_branch: z.string().uuid(), bill_id: z.string().uuid(), op: z.enum(['upsert', 'delete']),
  revision: z.number().int().nonnegative(), updated_at: z.string(), nonce: z.string(), ciphertext: z.string()
})
const pullRes = z.object({ items: z.array(pulledRow), has_more: z.boolean() })
const countRes = z.object({ pending: z.number().int().nonnegative() })
const ackRes = z.object({ deleted: z.number().int().nonnegative() })

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_ATTEMPTS = 3

export class SupabaseTransport implements SyncTransport {
  private readonly base: string
  private readonly doFetch: FetchLike
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly o: SupabaseTransportOptions) {
    this.base = `${o.url.replace(/\/+$/, '')}/rest/v1/rpc/`
    this.doFetch = o.fetch ?? ((url, init) => fetch(url, init) as Promise<HttpResponse>)
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.attempts = Math.max(1, o.attempts ?? DEFAULT_ATTEMPTS)
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** One RPC call with a timeout and bounded retries. Throws only `TransportError`. */
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    let last: TransportError = new TransportError('offline')
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (attempt > 1) await this.sleep(400 * 2 ** (attempt - 2))
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
      let failure: { err: TransportError; retry: boolean }
      try {
        const res = await this.doFetch(this.base + fn, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: this.o.anonKey, authorization: `Bearer ${this.o.anonKey}`, accept: 'application/json' },
          body: JSON.stringify(args),
          signal: ctl.signal
        })
        const body = await res.text()
        if (res.status >= 200 && res.status < 300) {
          try { return body === '' ? null : JSON.parse(body) as unknown } catch { throw new TransportError('server') }
        }
        failure = { err: classifyHttp(res.status, body), retry: res.status >= 500 || res.status === 408 || res.status === 429 }
      } catch (e) {
        if (e instanceof TransportError) failure = { err: e, retry: false }
        else failure = { err: new TransportError(ctl.signal.aborted ? 'timeout' : 'offline'), retry: true }
      } finally {
        clearTimeout(timer)
      }
      last = failure.err
      if (!failure.retry) throw last
    }
    throw last
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data)
    if (!r.success) throw new TransportError('server')
    return r.data
  }

  async registerBranch(a: RegisterArgs): Promise<RegisterResult> {
    const d = this.parse(registerRes, await this.rpc('qt_register_branch', { p_license: a.license, p_branch_id: a.branchId, p_name: a.name, p_po_prefix: a.poPrefix, p_device: a.device }))
    return { orgId: d.org_id, kdfSalt: d.kdf_salt, branches: d.branches.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix })) }
  }

  async listBranches(a: BranchArgs): Promise<(BranchRef & { lastSeenAt: string | null })[]> {
    const d = this.parse(listRes, await this.rpc('qt_list_branches', { p_license: a.license, p_branch_id: a.branchId }))
    return d.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix, lastSeenAt: b.last_seen_at ?? null }))
  }

  async touch(a: BranchArgs): Promise<{ serverTime: string }> {
    const d = this.parse(touchRes, await this.rpc('qt_touch', { p_license: a.license, p_branch_id: a.branchId }))
    return { serverTime: d.server_time }
  }

  async push(a: PushArgs): Promise<{ ids: number[] }> {
    const items = a.items.map((i) => ({ to_branch: i.toBranch, bill_id: i.billId, op: i.op, revision: i.revision, updated_at: i.updatedAt, nonce: i.nonce, ciphertext: i.ciphertext }))
    const d = this.parse(pushRes, await this.rpc('qt_push', { p_license: a.license, p_branch_id: a.branchId, p_items: items }))
    if (d.ids.length !== a.items.length) throw new TransportError('server')
    return { ids: d.ids }
  }

  async pull(a: PullArgs): Promise<PullResult> {
    const d = this.parse(pullRes, await this.rpc('qt_pull', { p_license: a.license, p_branch_id: a.branchId, p_after_id: a.afterId, p_limit: a.limit ?? 100 }))
    return {
      items: d.items.map((r) => ({ id: r.id, fromBranch: r.from_branch, billId: r.bill_id, op: r.op, revision: r.revision, updatedAt: r.updated_at, nonce: r.nonce, ciphertext: r.ciphertext })),
      hasMore: d.has_more
    }
  }

  async pendingCount(a: BranchArgs): Promise<{ pending: number }> {
    return this.parse(countRes, await this.rpc('qt_pending_count', { p_license: a.license, p_branch_id: a.branchId }))
  }

  async ack(a: BranchArgs & { ids: number[] }): Promise<{ deleted: number }> {
    return this.parse(ackRes, await this.rpc('qt_ack', { p_license: a.license, p_branch_id: a.branchId, p_ids: a.ids }))
  }
}

/** Maps a non-2xx PostgREST answer to a failure kind. Our own errors carry the Q3xxx SQLSTATE in `code`. */
export function classifyHttp(status: number, body: string): TransportError {
  let code = '', message = ''
  try {
    const j = JSON.parse(body) as { code?: unknown; message?: unknown }
    code = typeof j.code === 'string' ? j.code : ''
    message = typeof j.message === 'string' ? j.message : ''
  } catch { /* not JSON */ }
  const kind = SQLSTATE_KIND[code]
  if (kind) return new TransportError(kind, code)
  if (status === 401 || status === 403 || /invalid api key/i.test(message)) return new TransportError('anon_key', code)
  if (status === 404 || code === 'PGRST202' || code === '42883') return new TransportError('not_installed', code)
  return new TransportError('server', code)
}

// ---------------------------------------------------------------------------------------------------------------------
// In memory: the server's rules for the three calls above, for tests and the two-virtual-branches harness.
// ---------------------------------------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PULL_MAX_BYTES = 4 * 1024 * 1024
interface MemLicense { orgId: string; salt: string; status: 'active' | 'suspended'; maxBranches: number }
interface MemPost { id: number; orgId: string; from: string; to: string; billId: string; op: PostboxOp; revision: number; updatedAt: string; nonce: string; ciphertext: string }
interface MemBranch { branchId: string; orgId: string; name: string; poPrefix: string; device: string; lastSeenAt: string }

export class InMemoryTransport implements SyncTransport {
  private readonly licenses = new Map<string, MemLicense>()
  private readonly branches = new Map<string, MemBranch>()
  private readonly postbox: MemPost[] = []
  private nextPostId = 1
  /** Simulates no network: every call fails with `offline`. */
  offline = false
  /** Every call, in order (`fn` + the license key as the server received it). */
  readonly calls: { fn: string; license: string }[] = []

  constructor(private readonly now: () => Date = () => new Date()) {}

  addLicense(key: string, o: { maxBranches?: number; status?: 'active' | 'suspended'; orgId?: string } = {}): string {
    const k = normalizeLicenseKey(key)
    const orgId = o.orgId ?? randomUUID()
    this.licenses.set(k, { orgId, salt: randomBytes(16).toString('base64'), status: o.status ?? 'active', maxBranches: o.maxBranches ?? 5 })
    return orgId
  }
  suspend(key: string): void { const l = this.licenses.get(normalizeLicenseKey(key)); if (l) l.status = 'suspended' }

  private auth(license: string, branchId: string | null, fn: string): MemLicense {
    this.calls.push({ fn, license })
    if (this.offline) throw new TransportError('offline')
    const k = normalizeLicenseKey(license)
    const l = LICENSE_KEY_RE.test(k) ? this.licenses.get(k) : undefined
    if (!l || l.status !== 'active') throw new TransportError('license', 'Q3L01')
    if (branchId !== null && this.branches.get(branchId)?.orgId !== l.orgId) throw new TransportError('unknown_branch', 'Q3M01')
    return l
  }

  private list(orgId: string): MemBranch[] {
    return [...this.branches.values()].filter((b) => b.orgId === orgId).sort((a, b) => (a.poPrefix < b.poPrefix ? -1 : a.poPrefix > b.poPrefix ? 1 : 0))
  }

  async registerBranch(a: RegisterArgs): Promise<RegisterResult> {
    const l = this.auth(a.license, null, 'qt_register_branch')
    const name = a.name.trim(), prefix = a.poPrefix.trim().toUpperCase(), device = a.device.trim()
    if (!/^[0-9a-f-]{36}$/i.test(a.branchId) || name.length < 1 || name.length > 80 || device.length > 80 || !SERVER_PREFIX_RE.test(prefix)) throw new TransportError('invalid_input', 'Q3I01')
    const existing = this.branches.get(a.branchId)
    if (existing && existing.orgId !== l.orgId) throw new TransportError('branch_conflict', 'Q3B03')
    if (this.list(l.orgId).some((b) => b.poPrefix === prefix && b.branchId !== a.branchId)) throw new TransportError('prefix_taken', 'Q3B02')
    if (!existing && this.list(l.orgId).length >= l.maxBranches) throw new TransportError('branch_limit', 'Q3B01')
    this.branches.set(a.branchId, { branchId: a.branchId, orgId: l.orgId, name, poPrefix: prefix, device, lastSeenAt: this.now().toISOString() })
    return { orgId: l.orgId, kdfSalt: l.salt, branches: this.list(l.orgId).map(({ branchId, name: n, poPrefix }) => ({ branchId, name: n, poPrefix })) }
  }

  async listBranches(a: BranchArgs): Promise<(BranchRef & { lastSeenAt: string | null })[]> {
    const l = this.auth(a.license, a.branchId, 'qt_list_branches')
    return this.list(l.orgId).map((b) => ({ branchId: b.branchId, name: b.name, poPrefix: b.poPrefix, lastSeenAt: b.lastSeenAt }))
  }

  async touch(a: BranchArgs): Promise<{ serverTime: string }> {
    this.auth(a.license, a.branchId, 'qt_touch')
    const b = this.branches.get(a.branchId)!
    b.lastSeenAt = this.now().toISOString()
    return { serverTime: b.lastSeenAt }
  }

  /** Test inspection: rows currently waiting for `branchId`. */
  postboxFor(branchId: string): readonly MemPost[] { return this.postbox.filter((p) => p.to === branchId) }
  /** Test inspection: how many rows the server holds in total. */
  get postboxSize(): number { return this.postbox.length }

  async push(a: PushArgs): Promise<{ ids: number[] }> {
    const l = this.auth(a.license, a.branchId, 'qt_push')
    const items = a.items
    if (!Array.isArray(items) || items.length === 0) throw new TransportError('invalid_input', 'Q3I01')
    if (items.length > PUSH_MAX_ITEMS) throw new TransportError('too_many', 'Q3I03')
    const b64 = /^[A-Za-z0-9+/]+={0,2}$/
    // Validate everything first so a bad item rejects the whole call (the server's transaction rolls back).
    for (const i of items) {
      if (!UUID_RE.test(i.toBranch) || !UUID_RE.test(i.billId) || (i.op !== 'upsert' && i.op !== 'delete')) throw new TransportError('invalid_input', 'Q3I01')
      if (!Number.isInteger(i.revision) || i.revision < 0 || i.revision > 999_999_999 || Number.isNaN(Date.parse(i.updatedAt))) throw new TransportError('invalid_input', 'Q3I01')
      if (!b64.test(i.nonce) || !b64.test(i.ciphertext)) throw new TransportError('invalid_input', 'Q3I01')
      const nonceLen = Buffer.from(i.nonce, 'base64').length, ctLen = Buffer.from(i.ciphertext, 'base64').length
      if (nonceLen !== 12 || ctLen < 16) throw new TransportError('invalid_input', 'Q3I01')
      if (ctLen > POSTBOX_MAX_CIPHERTEXT) throw new TransportError('too_large', 'Q3I02')
      if (i.toBranch === a.branchId || this.branches.get(i.toBranch)?.orgId !== l.orgId) throw new TransportError('unknown_branch', 'Q3M01')
    }
    const ids = items.map((i) => {
      const id = this.nextPostId++
      this.postbox.push({ id, orgId: l.orgId, from: a.branchId, to: i.toBranch, billId: i.billId, op: i.op, revision: i.revision, updatedAt: i.updatedAt, nonce: i.nonce, ciphertext: i.ciphertext })
      return id
    })
    return { ids }
  }

  async pull(a: PullArgs): Promise<PullResult> {
    const l = this.auth(a.license, a.branchId, 'qt_pull')
    const limit = Math.min(Math.max(a.limit ?? 100, 1), PULL_MAX_ITEMS)
    const after = Math.max(a.afterId, 0)
    const mine = this.postbox.filter((p) => p.orgId === l.orgId && p.to === a.branchId && p.id > after).sort((x, y) => x.id - y.id)
    const out: MemPost[] = []
    let bytes = 0
    for (const p of mine.slice(0, limit)) {
      const n = Buffer.from(p.ciphertext, 'base64').length
      if (out.length > 0 && bytes + n > PULL_MAX_BYTES) break // about 4 MB per call, always at least one row
      bytes += n
      out.push(p)
    }
    return {
      items: out.map((p) => ({ id: p.id, fromBranch: p.from, billId: p.billId, op: p.op, revision: p.revision, updatedAt: p.updatedAt, nonce: p.nonce, ciphertext: p.ciphertext })),
      hasMore: mine.length > out.length
    }
  }

  async pendingCount(a: BranchArgs): Promise<{ pending: number }> {
    this.auth(a.license, a.branchId, 'qt_pending_count')
    return { pending: this.postbox.filter((p) => p.to === a.branchId).length }
  }

  async ack(a: BranchArgs & { ids: number[] }): Promise<{ deleted: number }> {
    const l = this.auth(a.license, a.branchId, 'qt_ack')
    if (a.ids.length === 0) return { deleted: 0 }
    if (a.ids.length > ACK_MAX_IDS) throw new TransportError('too_many', 'Q3I03')
    const want = new Set(a.ids)
    let deleted = 0
    for (let k = this.postbox.length - 1; k >= 0; k--) {
      const p = this.postbox[k]!
      if (p.orgId === l.orgId && p.to === a.branchId && want.has(p.id)) { this.postbox.splice(k, 1); deleted++ }
    }
    return { deleted }
  }
}
