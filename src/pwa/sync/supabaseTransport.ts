import { z } from 'zod'
import { classifySharedFailure, type SharedErrorKind } from '../../shared/sync/license'
import type { RecordKind } from '../../shared/sync/codecV2'
import { PhoneSyncError } from './errors'
import {
  PHONE_MANIFEST_PAGE, PHONE_PULL_PAGE,
  type PhoneActivateArgs, type PhoneActivateResult, type PhoneBranchInfo, type PhoneBranchScope, type PhoneManifestRow, type PhonePullResult,
  type PhonePushItem, type PhonePushResult, type PhoneSession, type PhoneSharedPort
} from './transport'

/**
 * The REAL browser transport for the phone (supabase-js in the phone bundle). It talks to the SAME shared notebook the Windows app uses
 * (functions sn_activate / sn_push / sn_pull / ... from supabase/sql/15_rpcs.sql, doorbell = Realtime on sn_ping), so the phone and the PCs
 * share one set of bills and customers.
 *
 * It mirrors `SupabaseSharedTransport` in src/main/sync/sharedTransport.ts (phone code may not import src/main, so the logic is copied).
 * It has been checked only against a fake client (see supabaseTransport.test.ts). Real Supabase / real Android = owner to confirm. [A]
 */

interface ErrLike { message?: string; code?: string; status?: number; name?: string }
interface AuthSessionLike { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user: { id: string } }
interface AuthResult { data: { session: AuthSessionLike | null }; error: ErrLike | null }
interface RpcResult { data: unknown; error: ErrLike | null; status?: number }
export interface RpcCallLike extends PromiseLike<RpcResult> { abortSignal(s: AbortSignal): RpcCallLike }
interface ChannelLike {
  on(type: 'postgres_changes', filter: { event: '*'; schema: string; table: string; filter: string }, cb: () => void): ChannelLike
  subscribe(cb?: (status: string) => void): ChannelLike
}
/** The slice of the supabase-js client this file uses (tests pass a fake). */
export interface PhoneSupabaseLike {
  rpc(fn: string, args: Record<string, unknown>): RpcCallLike
  auth: {
    signInWithPassword(c: { email: string; password: string }): Promise<AuthResult>
    setSession(t: { access_token: string; refresh_token: string }): Promise<AuthResult>
    refreshSession(t?: { refresh_token: string }): Promise<AuthResult>
    signOut(): Promise<{ error: ErrLike | null }>
  }
  channel(name: string): ChannelLike
  removeChannel(ch: ChannelLike): Promise<unknown>
  realtime: { setAuth(token?: string): unknown }
}
export type PhoneSupabaseFactory = (url: string, anonKey: string) => PhoneSupabaseLike | Promise<PhoneSupabaseLike>

/** No persisted session (the phone vault stores it encrypted), no automatic refresh (we refresh before each call). */
export const createPhoneSupabaseClient: PhoneSupabaseFactory = async (url, anonKey) => {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as PhoneSupabaseLike
}

export interface PhoneSupabaseTransportOptions {
  url: string
  anonKey: string
  factory?: PhoneSupabaseFactory
  timeoutMs?: number
  /** Total tries for a network error / timeout / 5xx (never for a server answer such as a wrong license). */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}
export const PHONE_DEFAULT_TIMEOUT_MS = 20_000
export const PHONE_DEFAULT_ATTEMPTS = 3
/** Refresh the login when it has less than this many seconds left (same number as the desktop transport). */
const SESSION_REFRESH_MARGIN_S = 60

const uuid = z.string().uuid()
const iso = z.string().min(1)
const branchWire = z.object({ branch_id: uuid, name: z.string(), po_prefix: z.string() })
const activateWire = z.object({ org_id: uuid, seat_no: z.number().int(), server_time: iso, max_server_seq: z.number().int().nonnegative(), branches: z.array(branchWire) })
const branchInfoWire = branchWire.extend({ device_name: z.string().nullable().optional(), last_seen_at: z.string().nullable().optional() })
const kindWire = z.enum(['bill', 'party', 'party_merge', 'item_rule'])
const manifestWire = z.array(z.object({ rec_id: uuid, version: z.number().int(), payload_hash: z.string(), server_seq: z.number().int(), deleted: z.boolean() }))
const pushWire = z.array(z.object({ kind: kindWire, rec_id: uuid, outcome: z.enum(['accepted', 'noop', 'won', 'lost']), version: z.number().int(), server_seq: z.number().int() }))
const pulledWire = z.object({
  items: z.array(z.object({
    kind: kindWire, rec_id: uuid, version: z.number().int(), server_seq: z.number().int(), deleted: z.boolean(), payload: z.record(z.string(), z.unknown()),
    payload_hash: z.string(), schema_ver: z.number().int(), min_reader_ver: z.number().int(), app_ver: z.string().nullable().optional(), edited_at: iso, from_branch: z.string().nullable().optional()
  })),
  has_more: z.boolean(),
  server_time: iso
})

const TRANSIENT: ReadonlySet<SharedErrorKind> = new Set(['offline', 'timeout', 'server'])
const NETWORK_RE = /fetch failed|failed to fetch|network|load failed|enotfound|econnrefused|econnreset|etimedout|eai_again|socket|getaddrinfo/i

export class PhoneSupabaseTransport implements PhoneSharedPort {
  private client: PhoneSupabaseLike | null = null
  private session: PhoneSession | null = null
  private readonly listeners = new Set<(s: PhoneSession) => void>()
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now_: () => number

  constructor(private readonly o: PhoneSupabaseTransportOptions) {
    this.timeoutMs = o.timeoutMs ?? PHONE_DEFAULT_TIMEOUT_MS
    this.attempts = Math.max(1, o.attempts ?? PHONE_DEFAULT_ATTEMPTS)
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now_ = o.now ?? (() => Date.now())
  }

  private async cl(): Promise<PhoneSupabaseLike> {
    if (!this.client) this.client = await (this.o.factory ?? createPhoneSupabaseClient)(this.o.url, this.o.anonKey)
    return this.client
  }

  /** Turns a supabase-js / PostgREST error into a PhoneSyncError (the message text is read for classification only, never kept). */
  private fail(e: ErrLike | null, extra: { status?: number; timeout?: boolean; auth?: boolean; network?: boolean } = {}): PhoneSyncError {
    const msg = e?.message ?? ''
    const status = e?.status ?? extra.status
    const network = extra.network === true || status === 0 || (status === undefined && NETWORK_RE.test(msg)) || e?.name === 'AuthRetryableFetchError'
    const kind = classifySharedFailure({ status: status === 0 ? undefined : status, code: e?.code, message: msg, network, ...(extra.timeout ? { timeout: true } : {}), ...(extra.auth ? { auth: true } : {}) })
    return new PhoneSyncError(kind)
  }

  private toSession(s: AuthSessionLike | null, e: ErrLike | null): PhoneSession {
    if (e || !s) throw this.fail(e, { auth: true })
    const expiresAt = s.expires_at ?? Math.floor(this.now_() / 1000) + (s.expires_in ?? 3600)
    return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt, userId: s.user.id }
  }
  private setSession(s: PhoneSession, notify: boolean): void {
    this.session = s
    if (notify) for (const cb of this.listeners) cb(s)
  }

  private thrown(e: unknown): PhoneSyncError {
    if (e instanceof PhoneSyncError) return e
    const msg = e instanceof Error ? e.message : ''
    const name = e instanceof Error ? e.name : ''
    return new PhoneSyncError(name === 'AbortError' || /abort/i.test(msg) ? 'timeout' : NETWORK_RE.test(msg) || e instanceof TypeError ? 'offline' : 'server')
  }

  async signIn(a: { email: string; password: string }): Promise<PhoneSession> {
    const c = await this.cl()
    let r: AuthResult
    try { r = await c.auth.signInWithPassword({ email: a.email, password: a.password }) } catch (e) { throw this.thrown(e) }
    const s = this.toSession(r.data.session, r.error)
    this.setSession(s, false)
    return s
  }

  async restoreSession(s: PhoneSession): Promise<PhoneSession> {
    const c = await this.cl()
    let r: AuthResult
    try { r = await c.auth.setSession({ access_token: s.accessToken, refresh_token: s.refreshToken }) } catch (e) { throw this.thrown(e) }
    const next = this.toSession(r.data.session, r.error)
    this.setSession(next, next.accessToken !== s.accessToken)
    return next
  }

  onSessionChange(cb: (s: PhoneSession) => void): () => void { this.listeners.add(cb); return () => void this.listeners.delete(cb) }

  async signOut(): Promise<void> {
    this.session = null
    const c = await this.cl()
    try { await c.auth.signOut() } catch { /* local sign-out only */ }
  }

  private async fresh(c: PhoneSupabaseLike): Promise<void> {
    const s = this.session
    if (!s || s.expiresAt - Math.floor(this.now_() / 1000) >= SESSION_REFRESH_MARGIN_S) return
    let r: AuthResult
    try { r = await c.auth.refreshSession({ refresh_token: s.refreshToken }) } catch (e) { throw this.thrown(e) }
    this.setSession(this.toSession(r.data.session, r.error), true)
  }

  /** One RPC with a timeout and bounded retries for transient failures. Throws only PhoneSyncError. */
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const c = await this.cl()
    let last = new PhoneSyncError('offline')
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (attempt > 1) await this.sleep(400 * 2 ** (attempt - 2))
      await this.fresh(c)
      const ctl = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; ctl.abort() }, this.timeoutMs)
      try {
        const res = await c.rpc(fn, args).abortSignal(ctl.signal)
        if (!res.error) return res.data
        last = this.fail(res.error, { status: res.status, timeout: timedOut })
      } catch (e) {
        last = timedOut ? new PhoneSyncError('timeout') : this.thrown(e)
      } finally {
        clearTimeout(timer)
      }
      if (!TRANSIENT.has(last.kind)) throw last
    }
    throw last
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data)
    if (!r.success) throw new PhoneSyncError('server')
    return r.data
  }

  async activate(a: PhoneActivateArgs): Promise<PhoneActivateResult> {
    const d = this.parse(activateWire, await this.rpc('sn_activate', { p_license: a.license, p_branch_id: a.branchId, p_name: a.name, p_po_prefix: a.poPrefix, p_device: a.device, p_takeover: a.takeover }))
    return { orgId: d.org_id, seatNo: d.seat_no, serverTime: d.server_time, maxServerSeq: d.max_server_seq, branches: d.branches.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix })) }
  }

  async branchNameFree(a: { license: string; name: string; branchId?: string }): Promise<boolean> {
    return this.parse(z.boolean(), await this.rpc('sn_branch_name_free', { p_license: a.license, p_name: a.name, p_branch_id: a.branchId ?? null }))
  }

  async now(): Promise<{ serverTime: string }> {
    return { serverTime: this.parse(z.string().min(1), await this.rpc('sn_now', {})) }
  }

  async listBranches(a: PhoneBranchScope): Promise<PhoneBranchInfo[]> {
    const d = this.parse(z.array(branchInfoWire), await this.rpc('sn_list_branches', { p_license: a.license, p_branch_id: a.branchId }))
    return d.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix, deviceName: b.device_name ?? '', lastSeenAt: b.last_seen_at ?? null }))
  }

  async manifest(a: PhoneBranchScope & { kind: RecordKind; afterRecId?: string; limit?: number }): Promise<PhoneManifestRow[]> {
    const d = this.parse(manifestWire, await this.rpc('sn_manifest', { p_license: a.license, p_branch_id: a.branchId, p_kind: a.kind, p_after_rec_id: a.afterRecId ?? null, p_limit: a.limit ?? PHONE_MANIFEST_PAGE }))
    return d.map((r) => ({ recId: r.rec_id, version: r.version, payloadHash: r.payload_hash, serverSeq: r.server_seq, deleted: r.deleted }))
  }

  async push(a: PhoneBranchScope & { items: PhonePushItem[] }): Promise<PhonePushResult[]> {
    const items = a.items.map((i) => ({
      kind: i.kind, rec_id: i.recId, base_version: i.baseVersion, payload: i.payload, payload_hash: i.payloadHash, schema_ver: i.schemaVer,
      min_reader_ver: i.minReaderVer, app_ver: i.appVer, edited_at: i.editedAt, deleted: i.deleted
    }))
    const d = this.parse(pushWire, await this.rpc('sn_push', { p_license: a.license, p_branch_id: a.branchId, p_items: items }))
    if (d.length !== a.items.length) throw new PhoneSyncError('server')
    return d.map((r) => ({ kind: r.kind as RecordKind, recId: r.rec_id, outcome: r.outcome, version: r.version, serverSeq: r.server_seq }))
  }

  async pull(a: PhoneBranchScope & { afterSeq: number; limit?: number }): Promise<PhonePullResult> {
    const d = this.parse(pulledWire, await this.rpc('sn_pull', { p_license: a.license, p_branch_id: a.branchId, p_after_seq: a.afterSeq, p_limit: a.limit ?? PHONE_PULL_PAGE }))
    return {
      hasMore: d.has_more,
      serverTime: d.server_time,
      items: d.items.map((r) => ({
        kind: r.kind as RecordKind, recId: r.rec_id, version: r.version, serverSeq: r.server_seq, deleted: r.deleted, payload: r.payload, payloadHash: r.payload_hash,
        schemaVer: r.schema_ver, minReaderVer: r.min_reader_ver, appVer: r.app_ver ?? '', editedAt: r.edited_at, fromBranch: r.from_branch ?? null
      }))
    }
  }

  /** Realtime on `sn_ping` for this organisation. The row holds no data: a ring means "pull now". A failure only reports `onLive(false)`; the 60 s poll covers. */
  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void {
    let stopped = false
    let channel: ChannelLike | null = null
    let clientRef: PhoneSupabaseLike | null = null
    void this.cl().then((c) => {
      if (stopped) return
      clientRef = c
      if (this.session) c.realtime.setAuth(this.session.accessToken)
      channel = c.channel(`sn_ping:${a.orgId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sn_ping', filter: `org_id=eq.${a.orgId}` }, () => onRing())
        .subscribe((status) => onLive?.(status === 'SUBSCRIBED'))
    }).catch(() => onLive?.(false))
    return () => {
      stopped = true
      if (channel && clientRef) void clientRef.removeChannel(channel)
      onLive?.(false)
    }
  }
}
