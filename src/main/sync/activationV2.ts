import { hostname } from 'node:os'
import type { BranchRepo } from '../db/branchRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import { AppError } from '../ipc/envelope'
import type { Logger } from '../logger'
import {
  DEACTIVATE_WORD, checkPrefixForServer, maskEmail, maskLicenseKey, sharedKindToErrorCode, sharedLinkStateFor, validateAnonKey, validateBranchName,
  validateEmail, validateLicenseKey, validateSeatPassword, validateSupabaseUrl,
  type ActivateInputV2, type Checked, type LinkState, type RegisteredBranch, type SharedLicenseStatus
} from '../../shared/sync/license'
import type { SecretStore } from './secretStore'
import { SharedTransportError, type SharedSession, type SharedStoreTransport } from './sharedTransport'

/**
 * Phase 132 - activation service v2 for the shared notebook (SYNC_SHARED_STORE_SPEC sections 3, 5, 11).
 *
 * Inputs: project URL, anon key, license key, this computer's e-mail + password (one Supabase login per seat), branch name, PO prefix, takeover.
 * No passphrase, no client-side encryption. The session (tokens) and the seat login (e-mail + password) are kept in `sync_state` wrapped by
 * `SecretStore` (Electron safeStorage); activation is refused when the OS cannot protect them. The renderer only ever gets `SharedLicenseStatus`
 * (masked hints). Nothing secret is written to a log, an audit row or an error message.
 *
 * The v1 `licenseService.ts` is untouched and keeps its own `license.*` keys; this service uses the `shared.*` prefix so the two cannot collide
 * before Phase 142 removes v1.
 */
export const SHARED_KEYS = {
  url: 'shared.url',
  anonKey: 'shared.anonKey',
  licenseBlob: 'shared.licenseBlob',
  licenseHint: 'shared.licenseHint',
  /** safeStorage-wrapped JSON `{ email, password }` of this seat. */
  loginBlob: 'shared.loginBlob',
  emailHint: 'shared.emailHint',
  /** safeStorage-wrapped JSON `SharedSession`. */
  sessionBlob: 'shared.sessionBlob',
  orgId: 'shared.orgId',
  seatNo: 'shared.seatNo',
  branches: 'shared.branches',
  registeredBranch: 'shared.registeredBranch',
  activatedAt: 'shared.activatedAt',
  link: 'shared.link'
} as const
const ALL_SHARED_KEYS = Object.values(SHARED_KEYS)

export interface SharedCredentials { url: string; anonKey: string; license: string; email: string; branchId: string; orgId: string }

export interface SharedActivation {
  status(opts?: { check?: boolean }): Promise<SharedLicenseStatus>
  activate(input: ActivateInputV2): Promise<SharedLicenseStatus>
  deactivate(input: { confirm: string }): Promise<SharedLicenseStatus>
  isActivated(): boolean
  /** Main only, never sent to the renderer. Null while not activated or when the stored secrets cannot be read. */
  credentials(): SharedCredentials | null
  /**
   * A signed-in transport for the workers of Phases 134-138: restores the stored session (refreshing it when needed) and falls back to signing in
   * again with the stored seat password when the session is no longer valid. Network failures are NOT answered by re-signing in. The refreshed
   * session is stored again by itself.
   */
  connect(): Promise<{ transport: SharedStoreTransport; creds: SharedCredentials }>
  /**
   * Phase 267: the master's refreshed seat password goes into the SAME wrapped login blob the activation wrote (e-mail kept unless a new one is
   * given). Returns false when this PC is not activated or the blob cannot be read; nothing is logged with the password.
   */
  storeSeatPassword(password: string, email?: string): boolean
}

export interface SharedActivationDeps {
  sync: SyncStateRepo
  branches: BranchRepo
  secrets: SecretStore
  /** The real one wraps `SupabaseSharedTransport`; tests return an `InMemorySharedTransport` on a shared `InMemorySharedServer`. */
  makeTransport: (cfg: { url: string; anonKey: string }) => SharedStoreTransport
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  deviceName?: () => string
  /**
   * Phase 267 (M24): silent re-credential. Absent = old behaviour exactly. `hasDeviceToken` says whether this PC is linked to the master;
   * `refresh` is `masterService.refreshCredentials()` (it hands the new password to `storeSeatPassword` by itself and never throws).
   */
  recredential?: {
    hasDeviceToken(): boolean
    refresh(): Promise<{ ok: true; legacy: boolean; applied: boolean } | { ok: false; code: string; message: string }>
  }
}

/** One master refresh attempt per this many ms (Phase 267). */
export const RECREDENTIAL_GAP_MS = 60_000
/** The plain words shown when the master says this seat was removed (Phase 267). */
export const SEAT_REMOVED_WORDS = 'This seat was removed. Ask the admin for a new code.'
type RecredentialResult = 'applied' | 'removed' | 'none'

const json = <T>(raw: string | undefined, fallback: T): T => { if (raw === undefined) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }
function need<T>(c: Checked<T>): T { if (!c.ok) throw new AppError('VALIDATION', c.message); return c.value }

/** A transport failure as the IPC error the renderer shows. Only the kind is logged by callers. */
export function sharedToAppError(e: unknown): AppError {
  if (e instanceof AppError) return e
  if (e instanceof SharedTransportError) return new AppError(sharedKindToErrorCode(e.kind), e.message, { kind: e.kind })
  return new AppError('UNKNOWN', 'Something went wrong while contacting Supabase.')
}
const kindOf = (e: unknown): string => (e instanceof SharedTransportError ? e.kind : e instanceof AppError ? e.code : 'other')

export function createSharedActivation(deps: SharedActivationDeps, opts: { writable?: boolean; now?: () => Date } = {}): SharedActivation {
  const now = opts.now ?? (() => new Date())
  const { sync, secrets } = deps
  const guard = (): void => { if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)') }
  const activated = (): boolean => sync.get(SHARED_KEYS.licenseBlob) !== undefined && sync.get(SHARED_KEYS.orgId) !== undefined

  const unwrap = (key: string): string | null => {
    const blob = sync.get(key)
    if (blob === undefined) return null
    try { return secrets.decrypt(blob) } catch { return null }
  }

  function credentials(): SharedCredentials | null {
    if (!activated()) return null
    const license = unwrap(SHARED_KEYS.licenseBlob)
    const login = json<{ email?: string } | null>(unwrap(SHARED_KEYS.loginBlob) ?? undefined, null)
    const reg = json<RegisteredBranch | null>(sync.get(SHARED_KEYS.registeredBranch), null)
    const url = sync.get(SHARED_KEYS.url), anonKey = sync.get(SHARED_KEYS.anonKey), orgId = sync.get(SHARED_KEYS.orgId)
    if (!license || !login?.email || !reg || !url || !anonKey || !orgId) return null
    return { url, anonKey, license, email: login.email, branchId: reg.branchId, orgId }
  }

  function setLink(state: LinkState, message: string): void {
    sync.set(SHARED_KEYS.link, JSON.stringify({ state, at: now().toISOString(), message }))
  }
  const storeSession = (s: SharedSession): void => sync.set(SHARED_KEYS.sessionBlob, secrets.encrypt(JSON.stringify(s)))

  function snapshot(): SharedLicenseStatus {
    const isOn = activated()
    const url = sync.get(SHARED_KEYS.url) ?? ''
    let host = ''
    try { host = url === '' ? '' : new URL(url).host } catch { host = '' }
    const seat = Number(sync.get(SHARED_KEYS.seatNo))
    return {
      state: isOn ? 'activated' : 'not_activated',
      secretsAvailable: secrets.available(),
      readOnly: opts.writable === false,
      host,
      licenseHint: isOn ? (sync.get(SHARED_KEYS.licenseHint) ?? '') : '',
      emailHint: isOn ? (sync.get(SHARED_KEYS.emailHint) ?? '') : '',
      orgId: isOn ? (sync.get(SHARED_KEYS.orgId) ?? '') : '',
      seatNo: isOn && Number.isInteger(seat) && seat > 0 ? seat : null,
      registered: isOn ? json<RegisteredBranch | null>(sync.get(SHARED_KEYS.registeredBranch), null) : null,
      branches: isOn ? json<RegisteredBranch[]>(sync.get(SHARED_KEYS.branches), []) : [],
      activatedAt: isOn ? (sync.get(SHARED_KEYS.activatedAt) ?? '') : '',
      link: isOn ? json<{ state: LinkState; at: string; message: string }>(sync.get(SHARED_KEYS.link), { state: 'unchecked', at: '', message: '' }) : { state: 'unchecked', at: '', message: '' }
    }
  }

  // Phase 267: at most one master refresh per 60 s; callers that arrive while one runs (push, pull, doorbell) wait for it and share its answer.
  let lastRecred = { at: -Infinity, result: 'none' as RecredentialResult }
  let recredInflight: Promise<RecredentialResult> | null = null
  function recredential(): Promise<RecredentialResult> {
    const r = deps.recredential
    if (!r || !r.hasDeviceToken()) return Promise.resolve('none')
    if (recredInflight) return recredInflight
    if (now().getTime() - lastRecred.at < RECREDENTIAL_GAP_MS) return Promise.resolve(lastRecred.result === 'none' ? 'none' : lastRecred.result)
    const run = async (): Promise<RecredentialResult> => {
      let result: RecredentialResult = 'none'
      try {
        const o = await r.refresh()
        if (o.ok) result = o.applied ? 'applied' : 'none'
        else if (o.code === 'Q3M07') result = 'removed'
        // any other failure (master unreachable, not linked, ...) keeps the old behaviour: paused, retried later
      } catch { result = 'none' }
      lastRecred = { at: now().getTime(), result }
      deps.log.info('Shared sync re-credential', { result })
      return result
    }
    lastRecred = { ...lastRecred, at: now().getTime() }
    recredInflight = run().finally(() => { recredInflight = null })
    return recredInflight
  }
  const readLogin = (): { email?: string; password?: string } | null => json<{ email?: string; password?: string } | null>(unwrap(SHARED_KEYS.loginBlob) ?? undefined, null)

  async function connect(): Promise<{ transport: SharedStoreTransport; creds: SharedCredentials }> {
    const creds = credentials()
    if (!creds) throw new AppError('LICENSE_INVALID', 'Sync is not activated on this computer, or the stored login could not be read. Activate again.')
    const transport = deps.makeTransport({ url: creds.url, anonKey: creds.anonKey })
    transport.onSessionChange((s) => { try { storeSession(s) } catch { /* the next call refreshes again */ } })
    const stored = json<SharedSession | null>(unwrap(SHARED_KEYS.sessionBlob) ?? undefined, null)
    try {
      if (stored) {
        try {
          const s = await transport.restoreSession(stored)
          if (s.accessToken !== stored.accessToken) storeSession(s)
          return { transport, creds }
        } catch (e) {
          if (!(e instanceof SharedTransportError) || e.kind !== 'auth_failed') throw e
          // The session ended (refresh token revoked or replaced): sign in again with the seat password below.
        }
      }
      const login = readLogin()
      if (!login?.email || login.password === undefined) throw new AppError('AUTH_FAILED', 'The stored login for this computer could not be read. Activate again.')
      try {
        storeSession(await transport.signIn({ email: login.email, password: login.password }))
      } catch (e) {
        if (!(e instanceof SharedTransportError) || e.kind !== 'auth_failed') throw e
        // Phase 267: the seat password no longer works (the admin reset the seat). Ask the master ONCE (device token, 60 s gap), then try again.
        const res = await recredential()
        if (res === 'removed') {
          setLink('license_problem', SEAT_REMOVED_WORDS)
          deps.log.warn('Shared sync seat removed by the master')
          throw new AppError('AUTH_FAILED', SEAT_REMOVED_WORDS, { kind: 'seat_removed' })
        }
        if (res !== 'applied') throw e
        const fresh = readLogin()
        if (!fresh?.email || fresh.password === undefined) throw e
        storeSession(await transport.signIn({ email: fresh.email, password: fresh.password }))
        setLink('ok', 'Connected.')
      }
      return { transport, creds }
    } catch (e) {
      const err = sharedToAppError(e)
      if (e instanceof SharedTransportError) setLink(sharedLinkStateFor(e.kind), e.message)
      deps.log.warn('Shared sync sign-in failed', { code: err.code, kind: kindOf(e) })
      throw err
    }
  }

  async function check(): Promise<void> {
    try {
      const { transport, creds } = await connect()
      await transport.now()
      const list = await transport.listBranches({ license: creds.license, branchId: creds.branchId })
      sync.set(SHARED_KEYS.branches, JSON.stringify(list.map(({ branchId, name, poPrefix }) => ({ branchId, name, poPrefix }))))
      setLink('ok', 'Connected.')
    } catch (e) {
      if (e instanceof SharedTransportError) setLink(sharedLinkStateFor(e.kind), e.message)
      else if (e instanceof AppError && e.code === 'AUTH_FAILED') setLink('license_problem', e.message)
      else if (!(e instanceof AppError)) setLink('server_problem', 'Supabase reported a problem. Try again in a moment.')
    }
  }

  return {
    credentials,
    isActivated: activated,
    connect,
    storeSeatPassword(password, email) {
      if (!activated() || password === '') return false
      const login = readLogin()
      const mail = email ?? login?.email
      if (!mail) return false
      sync.set(SHARED_KEYS.loginBlob, secrets.encrypt(JSON.stringify({ email: mail, password })))
      sync.set(SHARED_KEYS.emailHint, maskEmail(mail))
      return true
    },

    async status(o = {}) {
      if (o.check === true && activated() && opts.writable !== false) await check()
      return snapshot()
    },

    async activate(input) {
      guard()
      if (!secrets.available()) throw new AppError('IO_ERROR', 'This computer cannot protect the sign-in details (Windows secure storage is unavailable), so sync cannot be activated here.')
      const url = need(validateSupabaseUrl(input.supabaseUrl))
      const anonKey = need(validateAnonKey(input.anonKey))
      const license = need(validateLicenseKey(input.licenseKey))
      const email = need(validateEmail(input.email))
      const password = need(validateSeatPassword(input.password))
      const name = need(validateBranchName(input.branchName))
      const prefix = need(checkPrefixForServer(input.poPrefix))
      const local = deps.branches.local()
      if (!local) throw new AppError('DB_ERROR', 'No local branch is set up yet.')

      const transport = deps.makeTransport({ url, anonKey })
      let session: SharedSession
      let res
      try {
        session = await transport.signIn({ email, password })
        res = await transport.activate({ license, branchId: local.id, name, poPrefix: prefix, device: (deps.deviceName ?? hostname)().slice(0, 80), takeover: input.takeover === true })
      } catch (e) {
        await transport.signOut().catch(() => undefined)
        const err = sharedToAppError(e)
        deps.log.warn('Shared sync activation failed', { code: err.code, kind: kindOf(e) })
        throw err
      }
      // Everything or nothing: a crash in the middle cannot leave a half-activated database.
      sync.setMany({
        [SHARED_KEYS.url]: url,
        [SHARED_KEYS.anonKey]: anonKey,
        [SHARED_KEYS.licenseBlob]: secrets.encrypt(license),
        [SHARED_KEYS.licenseHint]: maskLicenseKey(license),
        [SHARED_KEYS.loginBlob]: secrets.encrypt(JSON.stringify({ email, password })),
        [SHARED_KEYS.emailHint]: maskEmail(email),
        [SHARED_KEYS.sessionBlob]: secrets.encrypt(JSON.stringify(session)),
        [SHARED_KEYS.orgId]: res.orgId,
        [SHARED_KEYS.seatNo]: String(res.seatNo),
        [SHARED_KEYS.branches]: JSON.stringify(res.branches),
        [SHARED_KEYS.registeredBranch]: JSON.stringify({ branchId: local.id, name, poPrefix: prefix }),
        [SHARED_KEYS.activatedAt]: now().toISOString(),
        [SHARED_KEYS.link]: JSON.stringify({ state: 'ok', at: now().toISOString(), message: 'Connected.' })
      })
      // The server now knows this prefix for this branch; new PO numbers must use it (another branch cannot).
      if (local.poPrefix.toUpperCase() !== prefix) deps.branches.setPrefix(local.id, prefix)
      deps.branches.audit({ at: now().toISOString(), branchId: local.id, entity: 'license', entityId: res.orgId, action: 'activate_shared', detailJson: JSON.stringify({ host: new URL(url).host, prefix, seat: res.seatNo }) })
      deps.log.info('Shared sync activated', { branches: res.branches.length, seat: res.seatNo })
      return snapshot()
    },

    async deactivate(input) {
      guard()
      if (input.confirm.trim().toUpperCase() !== DEACTIVATE_WORD) throw new AppError('VALIDATION', `Type ${DEACTIVATE_WORD} to confirm.`)
      const local = deps.branches.local()
      const org = sync.get(SHARED_KEYS.orgId) ?? null
      // Best effort: end the server session so the stored refresh token is useless. Failure (offline) never blocks deactivation.
      const creds = credentials()
      if (creds) {
        try { const t = deps.makeTransport({ url: creds.url, anonKey: creds.anonKey }); await t.signOut() } catch { /* offline */ }
      }
      // Phase 135: the workers keep their cursor, clock, compare progress and retry list under `shared.` too: all of it goes.
      sync.remove([...new Set([...ALL_SHARED_KEYS, ...sync.keys('shared.')])])
      deps.branches.audit({ at: now().toISOString(), branchId: local?.id ?? null, entity: 'license', entityId: org, action: 'deactivate_shared', detailJson: null })
      deps.log.info('Shared sync deactivated')
      return snapshot()
    }
  }
}
