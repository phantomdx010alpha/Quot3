import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { flagsToStore, effectiveFlags, missingFlags, normalizeFlags, permRecordFromPayload, requiredFlags, type PermFlags, type PriceKind } from '../../shared/pricelist/perms'
import { deriveServerChange, type LogChange, type LogEntity, type LogOp } from '../../shared/pricelist/logEntry'
import { SHARED_MESSAGES, SHARED_SQLSTATE_KIND, classifySharedFailure, normalizeLicenseKey, type SharedErrorKind, type SharedFailure } from '../../shared/sync/license'

/**
 * Phase 132 - the one door to the shared notebook (docs/SYNC_SHARED_STORE_SPEC.md sections 6, 11, 12).
 *
 *  - `SharedStoreTransport`: the interface every sync worker of Milestone 12 talks to.
 *  - `InMemorySharedTransport` (+ `InMemorySharedServer`): the same rules as supabase/sql/15_rpcs.sql, kept in memory, for tests and the dev harness.
 *    It is checked against the executable truth table `PUSH_CASES` (src/main/sync/__tests__/pushTruthTable.cases.ts).
 *  - `SupabaseSharedTransport`: Supabase Auth + RPC + Realtime. The ONLY code that imports `@supabase/supabase-js`.
 *
 * Main process only. Secrets (anon key, license, password, tokens) are arguments here and never appear in an error message or a log.
 * The v1 transport (`transport.ts`, encrypted postbox) is untouched and stays dormant until Phase 142 removes it.
 */

export type SharedKind = 'bill' | 'party' | 'party_merge' | 'item_rule' | 'price_tier' | 'price_category' | 'price_tab' | 'price_row'
export const SHARED_KINDS: readonly SharedKind[] = ['bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row']
export const SHARED_PUSH_MAX_ITEMS = 200
export const SHARED_PULL_MAX_ITEMS = 200
export const SHARED_PULL_MAX_BYTES = 4 * 1024 * 1024
export const SHARED_PUSH_MAX_BYTES = 8 * 1024 * 1024
export const SHARED_PAYLOAD_MAX_BYTES = 1024 * 1024
export const SHARED_MANIFEST_MAX = 1000
export const SHARED_HISTORY_CAP = 20
/** Refresh the access token when it expires within this many seconds. */
export const SESSION_REFRESH_MARGIN_S = 60

export interface SharedBranch { branchId: string; name: string; poPrefix: string }
export interface SharedBranchInfo extends SharedBranch { deviceName: string; lastSeenAt: string | null }
/** `expiresAt` is epoch seconds (as Supabase reports it). */
export interface SharedSession { accessToken: string; refreshToken: string; expiresAt: number; userId: string }

export interface SignInArgs { email: string; password: string }
export interface LicenseArgs { license: string }
export interface BranchScope extends LicenseArgs { branchId: string }
export interface ActivateArgs extends BranchScope { name: string; poPrefix: string; device: string; takeover: boolean }
export interface ActivateResult { orgId: string; seatNo: number; serverTime: string; maxServerSeq: number; branches: SharedBranch[] }
export interface NameFreeArgs extends LicenseArgs { name: string; branchId?: string }
export interface RenameArgs extends BranchScope { name: string }
export interface ManifestArgs extends BranchScope { kind: SharedKind; afterRecId?: string; limit?: number }
export interface ManifestRow { recId: string; version: number; payloadHash: string; serverSeq: number; deleted: boolean }

export interface PushItem {
  kind: SharedKind
  recId: string
  /** The version the sender last saw (0 = new). */
  baseVersion: number
  payload: Record<string, unknown>
  /** Must cover the deleted flag (Phase 133 codec): a noop is decided by the hash alone. */
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  /** ISO timestamp, already corrected by the clock offset measured against `now()`. */
  editedAt: string
  deleted: boolean
}
export interface PushArgs extends BranchScope { items: PushItem[] }
export type SharedPushOutcome = 'accepted' | 'noop' | 'won' | 'lost'
/** A price-list item the server refused for lack of a right (Phase 242): nothing was written and the other items of the batch still went through. */
export type PushResultOutcome = SharedPushOutcome | 'refused'
export interface PushResultItem {
  kind: SharedKind
  recId: string
  outcome: PushResultOutcome
  version: number
  serverSeq: number
  /** Only for `refused`: the error code (`Q3P01`) and the rights this seat is missing. */
  code?: string
  missing?: string[]
}
export interface PullArgs extends BranchScope { afterSeq: number; limit?: number }
export interface PulledRecord {
  kind: SharedKind
  recId: string
  version: number
  serverSeq: number
  deleted: boolean
  payload: Record<string, unknown>
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  fromBranch: string | null
}
export interface PullResult { items: PulledRecord[]; hasMore: boolean; serverTime: string }

/** Phase 171: theme sharing (supabase/sql/17_themes.sql). Implemented by `SupabaseSharedTransport` only; the in-memory / flaky transports do not have them. */
export interface ThemePushItem { themeId: string; payload: Record<string, unknown>; payloadHash: string; schemaVer: number; minReaderVer: number; appVer: string; editedAt: string }
export interface ThemePushResult { themeId: string; outcome: SharedPushOutcome; version: number; serverSeq: number }
export interface PulledTheme { themeId: string; version: number; serverSeq: number; payload: Record<string, unknown>; payloadHash: string; schemaVer: number; minReaderVer: number; appVer: string; editedAt: string; fromBranch: string | null }
export interface ThemePullResult { items: PulledTheme[]; hasMore: boolean; serverTime: string }
export interface ThemeShareCalls {
  themePush(a: BranchScope & { items: ThemePushItem[] }): Promise<ThemePushResult[]>
  themePull(a: BranchScope & { afterSeq: number; limit?: number }): Promise<ThemePullResult>
}

/** Phase 242: who may edit the Price List. `get` = this seat's own rights; `list` / `set` = seat 1 only (else `seat1_only`, code `Q3P02`). */
export interface PriceSeatRights { seatNo: number; flags: PermFlags }
export interface PriceSeatRow extends PriceSeatRights { branchName: string | null; updatedAt: string | null }
export interface PriceRightsCalls {
  pricePermsGet(a: LicenseArgs): Promise<PriceSeatRights>
  pricePermsList(a: LicenseArgs): Promise<PriceSeatRow[]>
  pricePermsSet(a: LicenseArgs & { seatNo: number; flags: PermFlags }): Promise<PriceSeatRights>
}

/** Phase 243: the shared Price List activity log. Both calls are seat 1 only (else `seat1_only`, code `Q3P02`). Newest first; `beforeId` pages. */
export interface SharedLogRow {
  id: number; at: string; seatNo: number | null; branchId: string | null; branchName: string; device: 'pc' | 'phone'
  entity: LogEntity; recId: string | null; op: LogOp; path: string
  /** Old / new values keyed by column label (null when the entry has no values). */
  before: Record<string, string> | null; after: Record<string, string> | null; count: number
}
export interface PriceLogCalls {
  priceLogList(a: LicenseArgs & { limit?: number; beforeId?: number }): Promise<SharedLogRow[]>
  /** Removes entries older than `days` (30..3650). Returns how many. */
  priceLogTrim(a: LicenseArgs & { days: number }): Promise<number>
}
/** `before` / `after` maps -> the pure entry's `changes` list. */
export function logChangesOf(r: Pick<SharedLogRow, 'before' | 'after'>): LogChange[] | null {
  const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])]
  const out = keys.map((k) => ({ column: k, before: r.before?.[k] ?? '', after: r.after?.[k] ?? '' })).filter((c) => c.before !== c.after)
  return out.length > 0 ? out : null
}

export interface SharedStoreTransport {
  /** E-mail + password of this computer's seat. Throws `auth_failed` for a wrong or banned login. */
  signIn(a: SignInArgs): Promise<SharedSession>
  /** Re-uses a stored session; refreshes it when it is expired. Throws `auth_failed` when the refresh token is no longer valid. */
  restoreSession(s: SharedSession): Promise<SharedSession>
  /** Called with the new session whenever the transport refreshed it by itself (the caller stores it). Returns an unsubscribe. */
  onSessionChange(cb: (s: SharedSession) => void): () => void
  signOut(): Promise<void>
  activate(a: ActivateArgs): Promise<ActivateResult>
  branchNameFree(a: NameFreeArgs): Promise<boolean>
  renameBranch(a: RenameArgs): Promise<{ branchId: string; name: string }>
  listBranches(a: BranchScope): Promise<SharedBranchInfo[]>
  /** The server clock (for the skew correction of `edited_at`). */
  now(): Promise<{ serverTime: string }>
  touch(a: BranchScope): Promise<{ serverTime: string }>
  manifest(a: ManifestArgs): Promise<ManifestRow[]>
  /** All or nothing (one transaction). Outcomes are returned in input order. */
  push(a: PushArgs): Promise<PushResultItem[]>
  /** Records with `serverSeq > afterSeq`, in order. Deletes nothing. */
  pull(a: PullArgs): Promise<PullResult>
  /**
   * The data-less doorbell (Realtime on `sn_ping`): `onRing` means "something changed, pull now". `onLive(false)` means the socket is down and
   * the 60 s poll is the fallback. Returns an unsubscribe. Built on in Phase 138.
   */
  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void
}

export class SharedTransportError extends Error {
  constructor(readonly kind: SharedErrorKind, readonly sqlstate?: string) {
    super(SHARED_MESSAGES[kind])
    this.name = 'SharedTransportError'
  }
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const isPriceKind = (k: SharedKind): k is PriceKind => k === 'price_tier' || k === 'price_category' || k === 'price_tab' || k === 'price_row'
const byteLength = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8')
const normName = (n: string): string => n.replace(/\s+/g, ' ').trim().toLowerCase()
const err = (kind: SharedErrorKind, sqlstate?: string): SharedTransportError => new SharedTransportError(kind, sqlstate ?? Object.entries(SHARED_SQLSTATE_KIND).find(([, k]) => k === kind)?.[0])

// =====================================================================================================================
// In-memory server: the RPC rules of supabase/sql/15_rpcs.sql, written once more (NOT copied from the reference model)
// =====================================================================================================================

export interface InMemoryOrgSpec {
  orgId?: string
  licenseKey: string
  status?: 'active' | 'suspended'
  seats: { email: string; password: string }[]
}
export interface InMemoryRecord {
  kind: SharedKind
  recId: string
  version: number
  serverSeq: number
  deleted: boolean
  payload: Record<string, unknown>
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  fromBranch: string | null
}
export interface InMemoryHistory { kind: SharedKind; recId: string; version: number; reason: 'superseded' | 'conflict_loser'; payload: Record<string, unknown>; fromBranch: string | null; editedAt: string }

interface Org { orgId: string; licenseKey: string; status: 'active' | 'suspended'; records: Map<string, InMemoryRecord>; history: InMemoryHistory[]; pingSeq: number; /** Phase 243: the Price List activity log (newest last). */ priceLog: SharedLogRow[]; /** seat number -> granted Price List flags (a seat without an entry has none). */ pricePerms: Map<number, PermFlags> }
interface User { userId: string; email: string; password: string; orgId: string; seatNo: number; branchId: string | null; banned: boolean }
interface BranchRow { branchId: string; orgId: string; userId: string; name: string; nameNorm: string; poPrefix: string; deviceName: string; lastSeenAt: string }
interface TokenRow { userId: string; expiresAt: number }

export class InMemorySharedServer {
  private readonly orgs = new Map<string, Org>()
  private readonly users = new Map<string, User>()
  private readonly branchRows = new Map<string, BranchRow>()
  private readonly access = new Map<string, TokenRow>()
  private readonly refresh = new Map<string, string>()
  private seq = 0
  private tokenSeq = 0
  private paused = false
  private offline = false
  private readonly doorbells = new Map<string, Set<() => void>>()
  /** Seconds an access token lives (Supabase default 3600). */
  tokenLifetimeS = 3600
  readonly now: () => number

  constructor(opts: { now?: () => number } = {}) { this.now = opts.now ?? (() => Date.now()) }

  // ---- test controls -----------------------------------------------------------------------------------------------
  setPaused(on: boolean): void { this.paused = on }
  setOffline(on: boolean): void { this.offline = on }
  addOrg(spec: InMemoryOrgSpec): { orgId: string } {
    const orgId = spec.orgId ?? randomUUID()
    this.orgs.set(orgId, { orgId, licenseKey: normalizeLicenseKey(spec.licenseKey), status: spec.status ?? 'active', records: new Map(), history: [], pingSeq: 0, priceLog: [], pricePerms: new Map() })
    spec.seats.forEach((s, i) => {
      const userId = randomUUID()
      this.users.set(userId, { userId, email: s.email.trim().toLowerCase(), password: s.password, orgId, seatNo: i + 1, branchId: null, banned: false })
    })
    return { orgId }
  }
  /** `suspended` bans the seats' logins as `qt_set_license_status` does. */
  setLicenseStatus(orgId: string, status: 'active' | 'suspended'): void {
    const o = this.mustOrg(orgId)
    o.status = status
    for (const u of this.users.values()) if (u.orgId === orgId) u.banned = status === 'suspended'
  }
  revokeSeat(email: string): void {
    const u = [...this.users.values()].find((x) => x.email === email.trim().toLowerCase())
    if (!u) return
    this.users.delete(u.userId)
    if (u.branchId) this.branchRows.delete(u.branchId)
    for (const [t, row] of this.access) if (row.userId === u.userId) this.access.delete(t)
    for (const [t, id] of this.refresh) if (id === u.userId) this.refresh.delete(t)
  }
  /** Test seeding: a stored row as if earlier pushes had made it. */
  seedRecord(orgId: string, r: Omit<InMemoryRecord, 'serverSeq' | 'schemaVer' | 'minReaderVer' | 'appVer' | 'deleted'> & Partial<InMemoryRecord>): InMemoryRecord {
    const rec: InMemoryRecord = { schemaVer: 1, minReaderVer: 1, appVer: 'test', deleted: false, ...r, serverSeq: ++this.seq }
    this.mustOrg(orgId).records.set(`${rec.kind}:${rec.recId}`, rec)
    return rec
  }
  records(orgId: string): InMemoryRecord[] { return [...this.mustOrg(orgId).records.values()].sort((a, b) => a.serverSeq - b.serverSeq) }
  record(orgId: string, kind: SharedKind, recId: string): InMemoryRecord | undefined { return this.mustOrg(orgId).records.get(`${kind}:${recId}`) }
  historyOf(orgId: string, kind: SharedKind, recId: string): InMemoryHistory[] { return this.mustOrg(orgId).history.filter((h) => h.kind === kind && h.recId === recId) }
  pingSeq(orgId: string): number { return this.mustOrg(orgId).pingSeq }
  branches(orgId: string): BranchRow[] { return [...this.branchRows.values()].filter((b) => b.orgId === orgId) }
  seatOf(email: string): { orgId: string; seatNo: number; branchId: string | null } | undefined {
    const u = [...this.users.values()].find((x) => x.email === email.trim().toLowerCase())
    return u ? { orgId: u.orgId, seatNo: u.seatNo, branchId: u.branchId } : undefined
  }
  /** Makes an access token invalid without touching the refresh token (what an expired JWT looks like). */
  expireAccessTokens(): void { for (const row of this.access.values()) row.expiresAt = Math.floor(this.now() / 1000) - 1 }
  /** Forgets every refresh token (what a revoked / replaced login looks like). */
  dropRefreshTokens(): void { this.refresh.clear() }

  // ---- network gate -------------------------------------------------------------------------------------------------
  gate(): void {
    if (this.offline) throw new SharedTransportError('offline')
    if (this.paused) throw new SharedTransportError('server_paused')
  }

  // ---- auth ---------------------------------------------------------------------------------------------------------
  private issue(u: User): SharedSession {
    const n = ++this.tokenSeq
    const expiresAt = Math.floor(this.now() / 1000) + this.tokenLifetimeS
    const accessToken = `at-${n}-${randomBytes(6).toString('hex')}`
    const refreshToken = `rt-${n}-${randomBytes(6).toString('hex')}`
    this.access.set(accessToken, { userId: u.userId, expiresAt })
    this.refresh.set(refreshToken, u.userId)
    return { accessToken, refreshToken, expiresAt, userId: u.userId }
  }
  signIn(a: SignInArgs): SharedSession {
    this.gate()
    const u = [...this.users.values()].find((x) => x.email === a.email.trim().toLowerCase())
    if (!u || u.password !== a.password || u.banned) throw new SharedTransportError('auth_failed')
    return this.issue(u)
  }
  refreshSession(refreshToken: string): SharedSession {
    this.gate()
    const id = this.refresh.get(refreshToken)
    const u = id ? this.users.get(id) : undefined
    if (!u || u.banned) throw new SharedTransportError('auth_failed')
    this.refresh.delete(refreshToken) // refresh tokens are single-use
    return this.issue(u)
  }
  /** `auth.uid()`: null without a valid token, exactly like PostgREST with a missing / expired JWT (here an expired one is `auth_failed`). */
  uid(accessToken: string | null): string | null {
    if (accessToken === null) return null
    const row = this.access.get(accessToken)
    if (!row) throw new SharedTransportError('auth_failed')
    if (row.expiresAt <= Math.floor(this.now() / 1000)) throw new SharedTransportError('auth_failed')
    return row.userId
  }

  // ---- helpers mirroring sn_member_org ------------------------------------------------------------------------------
  private mustOrg(orgId: string): Org { const o = this.orgs.get(orgId); if (!o) throw new Error('unknown org in test') ; return o }
  private memberOrg(uid: string | null, license: string, branchId: string | null): Org {
    const u = uid === null ? undefined : this.users.get(uid)
    if (!u) throw err('not_member')
    const org = this.orgs.get(u.orgId)
    if (!org || org.licenseKey !== normalizeLicenseKey(license) || org.status !== 'active') throw err('license')
    if (branchId !== null && (u.branchId === null || u.branchId !== branchId)) throw err('unknown_branch')
    return org
  }
  private stamp(branchId: string): void { const b = this.branchRows.get(branchId); if (b) b.lastSeenAt = new Date(this.now()).toISOString() }
  private ring(org: Org): void {
    org.pingSeq += 1
    for (const cb of this.doorbells.get(org.orgId) ?? []) cb()
  }
  addDoorbell(orgId: string, cb: () => void): () => void {
    const set = this.doorbells.get(orgId) ?? new Set<() => void>()
    set.add(cb)
    this.doorbells.set(orgId, set)
    return () => void set.delete(cb)
  }
  private addHistory(org: Org, h: InMemoryHistory): void {
    org.history.push(h)
    const mine = org.history.filter((x) => x.kind === h.kind && x.recId === h.recId)
    // Keep the newest SHARED_HISTORY_CAP per record (insertion order = age).
    for (const old of mine.slice(0, Math.max(0, mine.length - SHARED_HISTORY_CAP))) org.history.splice(org.history.indexOf(old), 1)
  }

  // ---- RPCs ---------------------------------------------------------------------------------------------------------
  rpcNow(): { serverTime: string } { this.gate(); return { serverTime: new Date(this.now()).toISOString() } }

  rpcActivate(uid: string | null, a: ActivateArgs): ActivateResult {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    const u = this.users.get(uid!)!
    const name = a.name.trim()
    const norm = normName(a.name)
    const prefix = a.poPrefix.trim().toUpperCase()
    if (!isUuid(a.branchId) || name.length < 1 || name.length > 80 || norm === '' || a.device.trim().length > 80 || !/^[A-Z0-9_/-]{1,8}$/.test(prefix)) throw err('invalid_input')
    if (u.branchId !== null && u.branchId !== a.branchId) {
      if (!a.takeover) throw err('seat_in_use')
      this.branchRows.delete(u.branchId)
      u.branchId = null
    }
    const owner = this.branchRows.get(a.branchId)
    if (owner && (owner.orgId !== org.orgId || owner.userId !== u.userId)) throw err('branch_conflict')
    const others = this.branches(org.orgId).filter((b) => b.branchId !== a.branchId)
    if (others.some((b) => b.nameNorm === norm)) throw err('name_taken')
    if (others.some((b) => b.poPrefix === prefix)) throw err('prefix_taken')
    this.branchRows.set(a.branchId, { branchId: a.branchId, orgId: org.orgId, userId: u.userId, name, nameNorm: norm, poPrefix: prefix, deviceName: a.device.trim(), lastSeenAt: new Date(this.now()).toISOString() })
    u.branchId = a.branchId
    return {
      orgId: org.orgId,
      seatNo: u.seatNo,
      serverTime: new Date(this.now()).toISOString(),
      maxServerSeq: Math.max(0, ...[...org.records.values()].map((r) => r.serverSeq)),
      branches: this.branches(org.orgId).sort((x, y) => (x.poPrefix < y.poPrefix ? -1 : 1)).map((b) => ({ branchId: b.branchId, name: b.name, poPrefix: b.poPrefix }))
    }
  }

  rpcBranchNameFree(uid: string | null, a: NameFreeArgs): boolean {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    const norm = normName(a.name)
    if (norm === '' || a.name.trim().length > 80) throw err('invalid_input')
    return !this.branches(org.orgId).some((b) => b.nameNorm === norm && (a.branchId === undefined || b.branchId !== a.branchId))
  }

  rpcRenameBranch(uid: string | null, a: RenameArgs): { branchId: string; name: string } {
    this.gate()
    const org = this.memberOrg(uid, a.license, a.branchId)
    const name = a.name.trim()
    const norm = normName(a.name)
    if (norm === '' || name.length > 80) throw err('invalid_input')
    if (this.branches(org.orgId).some((b) => b.nameNorm === norm && b.branchId !== a.branchId)) throw err('name_taken')
    const row = this.branchRows.get(a.branchId)!
    row.name = name
    row.nameNorm = norm
    this.stamp(a.branchId)
    return { branchId: a.branchId, name }
  }

  rpcListBranches(uid: string | null, a: BranchScope): SharedBranchInfo[] {
    this.gate()
    const org = this.memberOrg(uid, a.license, a.branchId)
    return this.branches(org.orgId).sort((x, y) => (x.poPrefix < y.poPrefix ? -1 : 1)).map((b) => ({ branchId: b.branchId, name: b.name, poPrefix: b.poPrefix, deviceName: b.deviceName, lastSeenAt: b.lastSeenAt }))
  }

  rpcTouch(uid: string | null, a: BranchScope): { serverTime: string } {
    this.gate()
    this.memberOrg(uid, a.license, a.branchId)
    this.stamp(a.branchId)
    return { serverTime: new Date(this.now()).toISOString() }
  }

  // ---- Phase 242: Price List rights (mirrors supabase/sql/19_price_perms.sql) ----------------------------------------
  /** Test control: grant flags to a seat directly (what seat 1's `qt_price_perms_set` stores). */
  setPricePerms(orgId: string, seatNo: number, flags: Partial<PermFlags>): void { this.mustOrg(orgId).pricePerms.set(seatNo, flagsToStore(seatNo, flags)) }
  private seatNoOf(uid: string | null): number { const u = uid === null ? undefined : this.users.get(uid); if (!u) throw err('not_member'); return u.seatNo }
  private flagsOf(org: Org, seatNo: number): PermFlags { return effectiveFlags(seatNo, org.pricePerms.get(seatNo), true) }

  rpcPricePermsGet(uid: string | null, a: LicenseArgs): PriceSeatRights {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    const seatNo = this.seatNoOf(uid)
    return { seatNo, flags: this.flagsOf(org, seatNo) }
  }

  rpcPricePermsList(uid: string | null, a: LicenseArgs): PriceSeatRow[] {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    if (this.seatNoOf(uid) !== 1) throw err('seat1_only')
    return [...this.users.values()].filter((u) => u.orgId === org.orgId).sort((x, y) => x.seatNo - y.seatNo)
      .map((u) => ({ seatNo: u.seatNo, flags: this.flagsOf(org, u.seatNo), branchName: u.branchId ? this.branchRows.get(u.branchId)?.name ?? null : null, updatedAt: null }))
  }

  rpcPricePermsSet(uid: string | null, a: LicenseArgs & { seatNo: number; flags: PermFlags }): PriceSeatRights {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    if (this.seatNoOf(uid) !== 1) throw err('seat1_only')
    const known = [...this.users.values()].some((u) => u.orgId === org.orgId && u.seatNo === a.seatNo)
    if (!Number.isInteger(a.seatNo) || a.seatNo < 1 || a.seatNo > 50 || typeof a.flags !== 'object' || a.flags === null || !known) throw err('invalid_input')
    const stored = flagsToStore(a.seatNo, a.flags)
    const was = this.flagsOf(org, a.seatNo)
    org.pricePerms.set(a.seatNo, stored)
    if (JSON.stringify(was) !== JSON.stringify(stored)) {
      const own = [...this.users.values()].find((u) => u.userId === uid)
      const asText = (f: PermFlags): Record<string, string> => ({ add: String(f.add), edit: String(f.edit), overwrite: String(f.overwrite), delete: String(f.delete), structure: String(f.structure) })
      this.addLog(org, { seatNo: 1, branchId: own?.branchId ?? null, branchName: own?.branchId ? this.branchRows.get(own.branchId)?.name ?? '' : '', device: 'pc', entity: 'perms', recId: null, op: 'permission', path: `Seat ${a.seatNo}`, before: asText(was), after: asText(stored), count: 1 })
    }
    return { seatNo: a.seatNo, flags: stored }
  }

  // ---- Phase 243: Price List activity log (mirrors supabase/sql/20_price_log.sql) ----------------------------------------
  private logSeq = 0
  private addLog(org: Org, e: Omit<SharedLogRow, 'id' | 'at'>): void { org.priceLog.push({ ...e, id: ++this.logSeq, at: new Date(this.now()).toISOString() }) }
  /** One entry per accepted / winning price change; the author is the seat of the caller (never the payload). Never throws: logging must not stop a save. */
  private logPriceChange(org: Org, seatNo: number, branchId: string, it: PushItem, old: InMemoryRecord | undefined): void {
    try {
      const pk = it.kind as PriceKind
      const tabRec = pk === 'price_row' ? org.records.get(`price_tab:${String((it.payload as { row?: { tabId?: unknown } }).row?.tabId ?? '')}`) : pk === 'price_tab' ? { payload: it.payload } : undefined
      const tab = (tabRec?.payload as { tab?: { name?: unknown; categoryId?: unknown; columns?: unknown } } | undefined)?.tab
      const cat = tab ? (org.records.get(`price_category:${String(tab.categoryId ?? '')}`)?.payload as { category?: { name?: unknown } } | undefined)?.category : undefined
      const cols = Array.isArray(tab?.columns) ? (tab!.columns as Array<{ key?: unknown; label?: unknown }>) : []
      const colLabel = (k: string): string => { const c = cols.find((x) => x.key === k); return typeof c?.label === 'string' && c.label !== '' ? c.label : k }
      const ch = deriveServerChange(old ? permRecordFromPayload(pk, old.payload, old.deleted) : null, permRecordFromPayload(pk, it.payload, it.deleted === true), {
        ...(typeof cat?.name === 'string' ? { categoryName: cat.name } : {}), ...(pk === 'price_row' && typeof tab?.name === 'string' ? { tabName: tab.name } : {}), colLabel
      })
      if (!ch) return
      const before: Record<string, string> = {}
      const after: Record<string, string> = {}
      for (const c of ch.changes) { before[c.column] = c.before; after[c.column] = c.after }
      this.addLog(org, {
        seatNo, branchId, branchName: this.branchRows.get(branchId)?.name ?? '', device: /^(pwa|phone)/i.test(it.appVer ?? '') ? 'phone' : 'pc', entity: ch.entity, recId: it.recId, op: ch.op,
        path: ch.path.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x !== '').join(' \u203A ').slice(0, 300),
        before: ch.changes.length > 0 ? before : null, after: ch.changes.length > 0 ? after : null, count: 1
      })
    } catch { /* never blocks a save */ }
  }
  rpcPriceLogList(uid: string | null, a: LicenseArgs & { limit?: number; beforeId?: number }): SharedLogRow[] {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    if (this.seatNoOf(uid) !== 1) throw err('seat1_only')
    const lim = Math.max(1, Math.min(500, Math.round(a.limit ?? 100)))
    return org.priceLog.filter((r) => a.beforeId === undefined || r.id < a.beforeId).sort((x, y) => y.id - x.id).slice(0, lim).map((r) => ({ ...r }))
  }
  rpcPriceLogTrim(uid: string | null, a: LicenseArgs & { days: number }): number {
    this.gate()
    const org = this.memberOrg(uid, a.license, null)
    if (this.seatNoOf(uid) !== 1) throw err('seat1_only')
    const cutoff = this.now() - Math.max(30, Math.min(3650, Math.round(a.days))) * 86_400_000
    const keep = org.priceLog.filter((r) => Date.parse(r.at) >= cutoff)
    const gone = org.priceLog.length - keep.length
    org.priceLog = keep
    return gone
  }

  rpcManifest(uid: string | null, a: ManifestArgs): ManifestRow[] {
    this.gate()
    const org = this.memberOrg(uid, a.license, a.branchId)
    const limit = a.limit ?? SHARED_MANIFEST_MAX
    if (!SHARED_KINDS.includes(a.kind) || !Number.isInteger(limit) || limit < 1 || limit > SHARED_MANIFEST_MAX) throw err('invalid_input')
    return [...org.records.values()]
      .filter((r) => r.kind === a.kind && (a.afterRecId === undefined || r.recId > a.afterRecId))
      .sort((x, y) => (x.recId < y.recId ? -1 : x.recId > y.recId ? 1 : 0))
      .slice(0, limit)
      .map((r) => ({ recId: r.recId, version: r.version, payloadHash: r.payloadHash, serverSeq: r.serverSeq, deleted: r.deleted }))
  }

  rpcPush(uid: string | null, a: PushArgs): PushResultItem[] {
    this.gate()
    const org = this.memberOrg(uid, a.license, a.branchId)
    const items = a.items as unknown
    if (!Array.isArray(items) || items.length === 0) throw err('invalid_input')
    if (items.length > SHARED_PUSH_MAX_ITEMS) throw err('too_many')
    if (byteLength(items) > SHARED_PUSH_MAX_BYTES) throw err('too_large')
    // The SQL is one transaction: nothing is written when any item is refused. Validation never depends on stored state, so check first.
    for (const raw of items as PushItem[]) {
      const it = raw as Partial<PushItem> | null
      if (!it || typeof it !== 'object') throw err('invalid_input')
      const edited = typeof it.editedAt === 'string' ? Date.parse(it.editedAt) : NaN
      if (!it.kind || !SHARED_KINDS.includes(it.kind) || !isUuid(it.recId) || !Number.isInteger(it.baseVersion) || (it.baseVersion as number) < 0 ||
          !it.payload || typeof it.payload !== 'object' || Array.isArray(it.payload) ||
          typeof it.payloadHash !== 'string' || it.payloadHash.length < 8 || it.payloadHash.length > 128 ||
          !Number.isInteger(it.schemaVer ?? 1) || (it.schemaVer ?? 1) < 1 || !Number.isInteger(it.minReaderVer ?? 1) || (it.minReaderVer ?? 1) < 1 ||
          (it.appVer ?? '').length > 40 || Number.isNaN(edited)) throw err('invalid_input')
      if (byteLength(it.payload) > SHARED_PAYLOAD_MAX_BYTES) throw err('too_large')
    }
    const results: PushResultItem[] = []
    let changed = false
    const seatNo = this.seatNoOf(uid)
    const seatFlags = this.flagsOf(org, seatNo)
    for (const it of items as PushItem[]) {
      const key = `${it.kind}:${it.recId}`
      const row = org.records.get(key)
      const edited = Date.parse(it.editedAt)
      // Phase 242: a price-list item needs the seat's rights. Seat 1 is never refused; a same-hash resend writes nothing, so it is not checked.
      // A refused item writes nothing (no record, no history) and the batch carries on.
      if (isPriceKind(it.kind) && seatNo !== 1 && !(row && row.payloadHash === it.payloadHash)) {
        const need = requiredFlags(row ? permRecordFromPayload(it.kind, row.payload, row.deleted) : null, permRecordFromPayload(it.kind, it.payload, it.deleted === true))
        const missing = missingFlags(seatFlags, need)
        if (missing.length > 0) { results.push({ kind: it.kind, recId: it.recId, outcome: 'refused', code: 'Q3P01', missing, version: 0, serverSeq: 0 }); continue }
      }
      const next = (over: Partial<InMemoryRecord>): InMemoryRecord => ({
        kind: it.kind, recId: it.recId, version: 1, serverSeq: ++this.seq, deleted: it.deleted === true, payload: it.payload, payloadHash: it.payloadHash,
        schemaVer: it.schemaVer ?? 1, minReaderVer: it.minReaderVer ?? 1, appVer: it.appVer ?? '', editedAt: it.editedAt, fromBranch: a.branchId, ...over
      })
      let outcome: SharedPushOutcome
      let rec: InMemoryRecord
      if (!row) {
        rec = next({})
        org.records.set(key, rec)
        outcome = 'accepted'
        changed = true
      } else if (row.payloadHash === it.payloadHash) {
        rec = row
        outcome = 'noop'
      } else if (it.baseVersion === row.version) {
        this.addHistory(org, { kind: row.kind, recId: row.recId, version: row.version, reason: 'superseded', payload: row.payload, fromBranch: row.fromBranch, editedAt: row.editedAt })
        rec = next({ version: row.version + 1 })
        org.records.set(key, rec)
        outcome = 'accepted'
        changed = true
      } else {
        const stored = Date.parse(row.editedAt)
        const wins = edited > stored || (edited === stored && a.branchId > (row.fromBranch ?? '00000000-0000-0000-0000-000000000000'))
        if (wins) {
          this.addHistory(org, { kind: row.kind, recId: row.recId, version: row.version, reason: 'conflict_loser', payload: row.payload, fromBranch: row.fromBranch, editedAt: row.editedAt })
          rec = next({ version: row.version + 1 })
          org.records.set(key, rec)
          outcome = 'won'
        } else {
          this.addHistory(org, { kind: it.kind, recId: it.recId, version: Math.max(1, it.baseVersion), reason: 'conflict_loser', payload: it.payload, fromBranch: a.branchId, editedAt: it.editedAt })
          rec = { ...row, version: row.version + 1, serverSeq: ++this.seq }
          org.records.set(key, rec)
          outcome = 'lost'
        }
        changed = true
      }
      if (isPriceKind(it.kind) && (outcome === 'accepted' || outcome === 'won')) this.logPriceChange(org, seatNo, a.branchId, it, row)
      results.push({ kind: it.kind, recId: it.recId, outcome, version: rec.version, serverSeq: rec.serverSeq })
    }
    if (changed) this.ring(org)
    this.stamp(a.branchId)
    return results
  }

  rpcPull(uid: string | null, a: PullArgs): PullResult {
    this.gate()
    const org = this.memberOrg(uid, a.license, a.branchId)
    const limit = a.limit ?? SHARED_PULL_MAX_ITEMS
    if (!Number.isInteger(a.afterSeq) || a.afterSeq < 0 || !Number.isInteger(limit) || limit < 1 || limit > SHARED_PULL_MAX_ITEMS) throw err('invalid_input')
    const items: PulledRecord[] = []
    let bytes = 0
    let hasMore = false
    for (const r of this.records(org.orgId).filter((x) => x.serverSeq > a.afterSeq)) {
      const size = byteLength(r.payload)
      if (items.length >= limit || (items.length > 0 && bytes + size > SHARED_PULL_MAX_BYTES)) { hasMore = true; break }
      items.push({ kind: r.kind, recId: r.recId, version: r.version, serverSeq: r.serverSeq, deleted: r.deleted, payload: r.payload, payloadHash: r.payloadHash, schemaVer: r.schemaVer, minReaderVer: r.minReaderVer, appVer: r.appVer, editedAt: r.editedAt, fromBranch: r.fromBranch })
      bytes += size
    }
    this.stamp(a.branchId)
    return { items, hasMore, serverTime: new Date(this.now()).toISOString() }
  }
}

export interface InMemorySharedTransportOptions { /** Stops a test hanging: nothing is async here, so unused unless a wrapper delays. */ label?: string }

/** One computer talking to an `InMemorySharedServer`. Several instances on one server = several branches. */
export class InMemorySharedTransport implements SharedStoreTransport, PriceRightsCalls, PriceLogCalls {
  private session: SharedSession | null = null
  private readonly listeners = new Set<(s: SharedSession) => void>()

  constructor(readonly server: InMemorySharedServer, readonly o: InMemorySharedTransportOptions = {}) {}

  /** The current session (tests read it to prove refresh happened). */
  currentSession(): SharedSession | null { return this.session }

  private async token(): Promise<string | null> {
    if (this.session && this.session.expiresAt - Math.floor(this.server.now() / 1000) < SESSION_REFRESH_MARGIN_S) {
      const fresh = this.server.refreshSession(this.session.refreshToken)
      this.set(fresh)
    }
    return this.session?.accessToken ?? null
  }
  private set(s: SharedSession): void { this.session = s; for (const cb of this.listeners) cb(s) }
  private async run<T>(fn: (uid: string | null) => T): Promise<T> {
    this.server.gate()
    const uid = this.server.uid(await this.token())
    return fn(uid)
  }

  async signIn(a: SignInArgs): Promise<SharedSession> { const s = this.server.signIn(a); this.session = s; return s }
  async restoreSession(s: SharedSession): Promise<SharedSession> {
    this.server.gate()
    if (s.expiresAt - Math.floor(this.server.now() / 1000) >= SESSION_REFRESH_MARGIN_S) {
      this.server.uid(s.accessToken) // throws auth_failed when the token is not one this server issued
      this.session = s
      return s
    }
    const fresh = this.server.refreshSession(s.refreshToken)
    this.session = fresh
    return fresh
  }
  onSessionChange(cb: (s: SharedSession) => void): () => void { this.listeners.add(cb); return () => void this.listeners.delete(cb) }
  async signOut(): Promise<void> { this.session = null }

  activate = (a: ActivateArgs): Promise<ActivateResult> => this.run((uid) => this.server.rpcActivate(uid, a))
  branchNameFree = (a: NameFreeArgs): Promise<boolean> => this.run((uid) => this.server.rpcBranchNameFree(uid, a))
  renameBranch = (a: RenameArgs): Promise<{ branchId: string; name: string }> => this.run((uid) => this.server.rpcRenameBranch(uid, a))
  listBranches = (a: BranchScope): Promise<SharedBranchInfo[]> => this.run((uid) => this.server.rpcListBranches(uid, a))
  now = (): Promise<{ serverTime: string }> => this.run(() => this.server.rpcNow())
  touch = (a: BranchScope): Promise<{ serverTime: string }> => this.run((uid) => this.server.rpcTouch(uid, a))
  manifest = (a: ManifestArgs): Promise<ManifestRow[]> => this.run((uid) => this.server.rpcManifest(uid, a))
  push = (a: PushArgs): Promise<PushResultItem[]> => this.run((uid) => this.server.rpcPush(uid, a))
  pull = (a: PullArgs): Promise<PullResult> => this.run((uid) => this.server.rpcPull(uid, a))
  pricePermsGet = (a: LicenseArgs): Promise<PriceSeatRights> => this.run((uid) => this.server.rpcPricePermsGet(uid, a))
  pricePermsList = (a: LicenseArgs): Promise<PriceSeatRow[]> => this.run((uid) => this.server.rpcPricePermsList(uid, a))
  pricePermsSet = (a: LicenseArgs & { seatNo: number; flags: PermFlags }): Promise<PriceSeatRights> => this.run((uid) => this.server.rpcPricePermsSet(uid, a))
  priceLogList = (a: LicenseArgs & { limit?: number; beforeId?: number }): Promise<SharedLogRow[]> => this.run((uid) => this.server.rpcPriceLogList(uid, a))
  priceLogTrim = (a: LicenseArgs & { days: number }): Promise<number> => this.run((uid) => this.server.rpcPriceLogTrim(uid, a))

  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void {
    onLive?.(true)
    const off = this.server.addDoorbell(a.orgId, onRing)
    return () => { off(); onLive?.(false) }
  }
}

// =====================================================================================================================
// Supabase: Auth (email + password) + PostgREST RPC + Realtime. The only importer of @supabase/supabase-js.
// =====================================================================================================================

interface ErrLike { message?: string; code?: string; status?: number; name?: string }
interface AuthSessionLike { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; user: { id: string } }
interface AuthResult { data: { session: AuthSessionLike | null }; error: ErrLike | null }
interface RpcResult { data: unknown; error: ErrLike | null; status?: number }
export interface RpcCallLike extends PromiseLike<RpcResult> { abortSignal(s: AbortSignal): RpcCallLike }
interface ChannelLike {
  on(type: 'postgres_changes', filter: { event: '*'; schema: string; table: string; filter: string }, cb: () => void): ChannelLike
  subscribe(cb?: (status: string) => void): ChannelLike
}
/** The slice of the supabase-js client this file uses (so tests can pass a fake; `createSupabaseClient` casts the real client to it). */
export interface SupabaseLike {
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

export type SupabaseClientFactory = (url: string, anonKey: string) => SupabaseLike | Promise<SupabaseLike>

/** Builds the real client: no persisted session (we store it ourselves, wrapped by safeStorage), no automatic refresh (we refresh before each call). */
export const createSupabaseClient: SupabaseClientFactory = async (url, anonKey) => {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as SupabaseLike
}

export interface SupabaseSharedTransportOptions {
  url: string
  anonKey: string
  factory?: SupabaseClientFactory
  /** Per attempt. */
  timeoutMs?: number
  /** Total tries for a network error / timeout / 5xx (never for a server answer such as a wrong license). */
  attempts?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}
export const SHARED_DEFAULT_TIMEOUT_MS = 20_000
export const SHARED_DEFAULT_ATTEMPTS = 3

const uuid = z.string().uuid()
const iso = z.string().min(1)
const branchWire = z.object({ branch_id: uuid, name: z.string(), po_prefix: z.string() })
const activateWire = z.object({ org_id: uuid, seat_no: z.number().int(), server_time: iso, max_server_seq: z.number().int().nonnegative(), branches: z.array(branchWire) })
const branchInfoWire = branchWire.extend({ device_name: z.string().nullable().optional(), last_seen_at: z.string().nullable().optional() })
const kindWire = z.enum(['bill', 'party', 'party_merge', 'item_rule', 'price_tier', 'price_category', 'price_tab', 'price_row'])
const manifestWire = z.array(z.object({ rec_id: uuid, version: z.number().int(), payload_hash: z.string(), server_seq: z.number().int(), deleted: z.boolean() }))
const pushWire = z.array(z.object({
  kind: kindWire, rec_id: uuid, outcome: z.enum(['accepted', 'noop', 'won', 'lost', 'refused']), version: z.number().int(), server_seq: z.number().int(),
  code: z.string().nullable().optional(), missing: z.array(z.string()).nullable().optional()
}))
const permFlagsWire = z.record(z.string(), z.unknown()).transform((o) => normalizeFlags(o))
const priceGetWire = z.object({ seat_no: z.number().int(), flags: permFlagsWire })
const logMap = z.record(z.string(), z.string()).nullable().optional()
const priceLogWire = z.array(z.object({
  id: z.number().int(), at: z.string(), seat_no: z.number().int().nullable().optional(), branch_id: z.string().nullable().optional(), branch_name: z.string().nullable().optional(),
  device: z.string().optional(), entity: z.string(), rec_id: z.string().nullable().optional(), op: z.string(), path: z.string().optional(), before: logMap, after: logMap, count: z.number().int().optional()
}))
const priceListWire = z.array(z.object({ seat_no: z.number().int(), branch_name: z.string().nullable().optional(), flags: permFlagsWire, updated_at: z.string().nullable().optional() }))
const pulledWire = z.object({
  items: z.array(z.object({
    kind: kindWire, rec_id: uuid, version: z.number().int(), server_seq: z.number().int(), deleted: z.boolean(), payload: z.record(z.string(), z.unknown()),
    payload_hash: z.string(), schema_ver: z.number().int(), min_reader_ver: z.number().int(), app_ver: z.string().nullable().optional(), edited_at: iso, from_branch: z.string().nullable().optional()
  })),
  has_more: z.boolean(),
  server_time: iso
})
const themePushWire = z.array(z.object({ theme_id: z.string(), outcome: z.enum(['accepted', 'noop', 'won', 'lost']), version: z.number().int(), server_seq: z.number().int() }))
const themePulledWire = z.object({
  items: z.array(z.object({
    theme_id: z.string(), version: z.number().int(), server_seq: z.number().int(), payload: z.record(z.string(), z.unknown()), payload_hash: z.string(),
    schema_ver: z.number().int(), min_reader_ver: z.number().int(), app_ver: z.string().nullable().optional(), edited_at: iso, from_branch: z.string().nullable().optional()
  })),
  has_more: z.boolean(),
  server_time: iso
})
const timeWire = z.object({ server_time: iso })
const renameWire = z.object({ branch_id: uuid, name: z.string() })

const TRANSIENT: ReadonlySet<SharedErrorKind> = new Set(['offline', 'timeout', 'server'])
const NETWORK_RE = /fetch failed|failed to fetch|network|enotfound|econnrefused|econnreset|etimedout|eai_again|socket|getaddrinfo/i

export class SupabaseSharedTransport implements SharedStoreTransport, ThemeShareCalls, PriceRightsCalls, PriceLogCalls {
  private client: SupabaseLike | null = null
  private session: SharedSession | null = null
  private readonly listeners = new Set<(s: SharedSession) => void>()
  private readonly timeoutMs: number
  private readonly attempts: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now_: () => number

  constructor(private readonly o: SupabaseSharedTransportOptions) {
    this.timeoutMs = o.timeoutMs ?? SHARED_DEFAULT_TIMEOUT_MS
    this.attempts = Math.max(1, o.attempts ?? SHARED_DEFAULT_ATTEMPTS)
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now_ = o.now ?? (() => Date.now())
  }

  private async cl(): Promise<SupabaseLike> {
    if (!this.client) this.client = await (this.o.factory ?? createSupabaseClient)(this.o.url, this.o.anonKey)
    return this.client
  }

  /** Turns a supabase-js / PostgREST error object into a `SharedTransportError` (message text is read for classification only, never kept). */
  private fail(e: ErrLike | null, extra: Partial<SharedFailure> = {}): SharedTransportError {
    const msg = e?.message ?? ''
    const status = e?.status ?? extra.status
    const network = extra.network === true || status === 0 || (status === undefined && NETWORK_RE.test(msg)) || e?.name === 'AuthRetryableFetchError'
    const kind = classifySharedFailure({ status: status === 0 ? undefined : status, code: e?.code, message: msg, network, ...extra })
    return new SharedTransportError(kind, e?.code !== undefined && e.code in SHARED_SQLSTATE_KIND ? e.code : undefined)
  }

  private toSession(s: AuthSessionLike | null, e: ErrLike | null): SharedSession {
    if (e || !s) throw this.fail(e, { auth: true })
    const expiresAt = s.expires_at ?? Math.floor(this.now_() / 1000) + (s.expires_in ?? 3600)
    return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt, userId: s.user.id }
  }
  private setSession(s: SharedSession, notify: boolean): void {
    this.session = s
    if (notify) for (const cb of this.listeners) cb(s)
  }

  async signIn(a: SignInArgs): Promise<SharedSession> {
    const c = await this.cl()
    let r: AuthResult
    try { r = await c.auth.signInWithPassword({ email: a.email, password: a.password }) } catch (e) { throw this.thrown(e) }
    const s = this.toSession(r.data.session, r.error)
    this.setSession(s, false)
    return s
  }

  async restoreSession(s: SharedSession): Promise<SharedSession> {
    const c = await this.cl()
    let r: AuthResult
    try { r = await c.auth.setSession({ access_token: s.accessToken, refresh_token: s.refreshToken }) } catch (e) { throw this.thrown(e) }
    const next = this.toSession(r.data.session, r.error)
    this.setSession(next, next.accessToken !== s.accessToken)
    return next
  }

  onSessionChange(cb: (s: SharedSession) => void): () => void { this.listeners.add(cb); return () => void this.listeners.delete(cb) }

  async signOut(): Promise<void> {
    this.session = null
    const c = await this.cl()
    try { await c.auth.signOut() } catch { /* local sign-out only; nothing to tell the owner */ }
  }

  /** A thrown (not returned) failure: our own timeout abort, or a network error. */
  private thrown(e: unknown): SharedTransportError {
    if (e instanceof SharedTransportError) return e
    const msg = e instanceof Error ? e.message : ''
    const name = e instanceof Error ? e.name : ''
    return new SharedTransportError(name === 'AbortError' || /abort/i.test(msg) ? 'timeout' : NETWORK_RE.test(msg) ? 'offline' : 'server')
  }

  private async fresh(c: SupabaseLike): Promise<void> {
    const s = this.session
    if (!s || s.expiresAt - Math.floor(this.now_() / 1000) >= SESSION_REFRESH_MARGIN_S) return
    let r: AuthResult
    try { r = await c.auth.refreshSession({ refresh_token: s.refreshToken }) } catch (e) { throw this.thrown(e) }
    this.setSession(this.toSession(r.data.session, r.error), true)
  }

  /** One RPC with a timeout and bounded retries for transient failures. Throws only `SharedTransportError`. */
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const c = await this.cl()
    let last = new SharedTransportError('offline')
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
        last = timedOut ? new SharedTransportError('timeout') : this.thrown(e)
      } finally {
        clearTimeout(timer)
      }
      if (!TRANSIENT.has(last.kind)) throw last
    }
    throw last
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown): T {
    const r = schema.safeParse(data)
    if (!r.success) throw new SharedTransportError('server')
    return r.data
  }

  async activate(a: ActivateArgs): Promise<ActivateResult> {
    const d = this.parse(activateWire, await this.rpc('sn_activate', { p_license: a.license, p_branch_id: a.branchId, p_name: a.name, p_po_prefix: a.poPrefix, p_device: a.device, p_takeover: a.takeover }))
    return { orgId: d.org_id, seatNo: d.seat_no, serverTime: d.server_time, maxServerSeq: d.max_server_seq, branches: d.branches.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix })) }
  }

  async branchNameFree(a: NameFreeArgs): Promise<boolean> {
    const d = this.parse(z.boolean(), await this.rpc('sn_branch_name_free', { p_license: a.license, p_name: a.name, p_branch_id: a.branchId ?? null }))
    return d
  }

  async renameBranch(a: RenameArgs): Promise<{ branchId: string; name: string }> {
    const d = this.parse(renameWire, await this.rpc('sn_rename_branch', { p_license: a.license, p_branch_id: a.branchId, p_name: a.name }))
    return { branchId: d.branch_id, name: d.name }
  }

  async listBranches(a: BranchScope): Promise<SharedBranchInfo[]> {
    const d = this.parse(z.array(branchInfoWire), await this.rpc('sn_list_branches', { p_license: a.license, p_branch_id: a.branchId }))
    return d.map((b) => ({ branchId: b.branch_id, name: b.name, poPrefix: b.po_prefix, deviceName: b.device_name ?? '', lastSeenAt: b.last_seen_at ?? null }))
  }

  async now(): Promise<{ serverTime: string }> {
    const d = this.parse(z.string().min(1), await this.rpc('sn_now', {}))
    return { serverTime: d }
  }

  async touch(a: BranchScope): Promise<{ serverTime: string }> {
    const d = this.parse(timeWire, await this.rpc('sn_touch', { p_license: a.license, p_branch_id: a.branchId }))
    return { serverTime: d.server_time }
  }

  async manifest(a: ManifestArgs): Promise<ManifestRow[]> {
    const d = this.parse(manifestWire, await this.rpc('sn_manifest', { p_license: a.license, p_branch_id: a.branchId, p_kind: a.kind, p_after_rec_id: a.afterRecId ?? null, p_limit: a.limit ?? SHARED_MANIFEST_MAX }))
    return d.map((r) => ({ recId: r.rec_id, version: r.version, payloadHash: r.payload_hash, serverSeq: r.server_seq, deleted: r.deleted }))
  }

  async push(a: PushArgs): Promise<PushResultItem[]> {
    const items = a.items.map((i) => ({
      kind: i.kind, rec_id: i.recId, base_version: i.baseVersion, payload: i.payload, payload_hash: i.payloadHash, schema_ver: i.schemaVer,
      min_reader_ver: i.minReaderVer, app_ver: i.appVer, edited_at: i.editedAt, deleted: i.deleted
    }))
    const d = this.parse(pushWire, await this.rpc('sn_push', { p_license: a.license, p_branch_id: a.branchId, p_items: items }))
    if (d.length !== a.items.length) throw new SharedTransportError('server')
    return d.map((r) => (r.outcome === 'refused'
      ? { kind: r.kind, recId: r.rec_id, outcome: 'refused' as const, version: 0, serverSeq: 0, code: r.code ?? 'Q3P01', missing: r.missing ?? [] }
      : { kind: r.kind, recId: r.rec_id, outcome: r.outcome, version: r.version, serverSeq: r.server_seq }))
  }

  async pricePermsGet(a: LicenseArgs): Promise<PriceSeatRights> {
    const d = this.parse(priceGetWire, await this.rpc('qt_price_perms_get', { p_license: a.license }))
    return { seatNo: d.seat_no, flags: d.flags }
  }

  async pricePermsList(a: LicenseArgs): Promise<PriceSeatRow[]> {
    const d = this.parse(priceListWire, await this.rpc('qt_price_perms_list', { p_license: a.license }))
    return d.map((r) => ({ seatNo: r.seat_no, flags: r.flags, branchName: r.branch_name ?? null, updatedAt: r.updated_at ?? null }))
  }

  async priceLogList(a: LicenseArgs & { limit?: number; beforeId?: number }): Promise<SharedLogRow[]> {
    const d = this.parse(priceLogWire, await this.rpc('qt_price_log_list', { p_license: a.license, p_limit: a.limit ?? 100, p_before_id: a.beforeId ?? null }))
    return d.map((r) => ({
      id: r.id, at: r.at, seatNo: r.seat_no ?? null, branchId: r.branch_id ?? null, branchName: r.branch_name ?? '', device: r.device === 'phone' ? 'phone' as const : 'pc' as const,
      entity: r.entity as LogEntity, recId: r.rec_id ?? null, op: r.op as LogOp, path: r.path ?? '', before: r.before ?? null, after: r.after ?? null, count: r.count ?? 1
    }))
  }

  async priceLogTrim(a: LicenseArgs & { days: number }): Promise<number> {
    const d = this.parse(z.number().int(), await this.rpc('qt_price_log_trim', { p_license: a.license, p_days: a.days }))
    return d
  }

  async pricePermsSet(a: LicenseArgs & { seatNo: number; flags: PermFlags }): Promise<PriceSeatRights> {
    const d = this.parse(priceGetWire, await this.rpc('qt_price_perms_set', { p_license: a.license, p_seat: a.seatNo, p_flags: a.flags }))
    return { seatNo: d.seat_no, flags: d.flags }
  }

  async pull(a: PullArgs): Promise<PullResult> {
    const d = this.parse(pulledWire, await this.rpc('sn_pull', { p_license: a.license, p_branch_id: a.branchId, p_after_seq: a.afterSeq, p_limit: a.limit ?? SHARED_PULL_MAX_ITEMS }))
    return {
      hasMore: d.has_more,
      serverTime: d.server_time,
      items: d.items.map((r) => ({
        kind: r.kind, recId: r.rec_id, version: r.version, serverSeq: r.server_seq, deleted: r.deleted, payload: r.payload, payloadHash: r.payload_hash,
        schemaVer: r.schema_ver, minReaderVer: r.min_reader_ver, appVer: r.app_ver ?? '', editedAt: r.edited_at, fromBranch: r.from_branch ?? null
      }))
    }
  }

  async themePush(a: BranchScope & { items: ThemePushItem[] }): Promise<ThemePushResult[]> {
    const items = a.items.map((i) => ({ theme_id: i.themeId, payload: i.payload, payload_hash: i.payloadHash, schema_ver: i.schemaVer, min_reader_ver: i.minReaderVer, app_ver: i.appVer, edited_at: i.editedAt }))
    const d = this.parse(themePushWire, await this.rpc('sn_theme_push', { p_license: a.license, p_branch_id: a.branchId, p_items: items }))
    if (d.length !== a.items.length) throw new SharedTransportError('server')
    return d.map((r) => ({ themeId: r.theme_id, outcome: r.outcome, version: r.version, serverSeq: r.server_seq }))
  }

  async themePull(a: BranchScope & { afterSeq: number; limit?: number }): Promise<ThemePullResult> {
    const d = this.parse(themePulledWire, await this.rpc('sn_theme_pull', { p_license: a.license, p_branch_id: a.branchId, p_after_seq: a.afterSeq, p_limit: a.limit ?? 50 }))
    return {
      hasMore: d.has_more,
      serverTime: d.server_time,
      items: d.items.map((r) => ({
        themeId: r.theme_id, version: r.version, serverSeq: r.server_seq, payload: r.payload, payloadHash: r.payload_hash, schemaVer: r.schema_ver,
        minReaderVer: r.min_reader_ver, appVer: r.app_ver ?? '', editedAt: r.edited_at, fromBranch: r.from_branch ?? null
      }))
    }
  }

  /** Realtime `postgres_changes` on `sn_ping` for this organisation (the row holds no data; RLS lets a member read only its own). Phase 138 re-reads the Free-plan limits before relying on it. */
  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void {
    let stopped = false
    let channel: ChannelLike | null = null
    let clientRef: SupabaseLike | null = null
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
