/**
 * Phase 263 - the desktop's master service (API_CONTRACTS.md M24-0 C8; no screens). NOTHING here runs by itself: no timer, no start-up call.
 * Every method is called by an IPC channel (`master:*`) or, later, by the phases that wire it (264 link wizard + silent adopt, 267 re-credential).
 *   - Not configured (the build holds no master URL / anon key): no call is ever made (T21).
 *   - Silent methods (`adopt`, `heartbeat`, `refreshCredentials`) never throw: they record the last problem in plain words and answer an outcome (T22, T24).
 *   - Explicit methods (`link`, `redeem`, seat admin, profile) throw `AppError` carrying the `Q3M*` code in `details.code`.
 *   - The service_role key and the enrol token exist only inside `link`; they are never stored, logged or returned (T29).
 *   - Credentials / bundle / profile are handed to PORTS (`applyBundle`, `applyCredentials`, `applyProfile`), so no password reaches the renderer
 *     and the existing shared-sync code is not touched. A missing port means that screen's phase has not wired it yet.
 */
import { AppError } from '../../ipc/envelope'
import type { ErrorCode } from '../../../shared/ipc'
import { masterErrorWords, type MasterErrorCode } from '../../../shared/master/errors'
import { redactSecrets } from '../../../shared/master/redact'
import { validateSeatCode } from '../../../shared/master/seatCode'
import { isMasterConfigured } from '../../../shared/master/config'
import { profileTooLarge, type Bundle, type ProfileView, type SeatView } from '../../../shared/master/schemas'
import type { MasterAdoptOutcome, MasterFailure, MasterHeartbeatOutcome, MasterRefreshOutcome, MasterStatus } from '../../../shared/master/clientTypes'
import { MasterError, type MasterClient } from './masterClient'
import type { MasterStore } from './masterStore'

type RefreshResponse = Awaited<ReturnType<MasterClient['refresh']>>

export interface MasterServiceDeps {
  client: MasterClient
  store: MasterStore
  /** The build's master constants. */
  config: { url: string; anon: string }
  /** This computer's company sign-in (the existing shared sync): URL, anon key, license and a fresh access token. Null / absent = not signed in. */
  company: { credentials(): { url: string; anonKey: string; license: string } | null; accessToken(): Promise<string | null> }
  appVersion: string
  deviceLabel(): string
  newReqId(): string
  log: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  /** Redeem on a computer that is not signed in yet: writes URL / anon / license / e-mail / password into the activation (Phase 264). */
  applyBundle?(bundle: Bundle): Promise<void>
  /** A new password for THIS seat (Phase 267). Called only when the master knows it. */
  applyCredentials?(c: RefreshResponse): Promise<void>
  /** A newer company profile (Phase 270). */
  applyProfile?(p: ProfileView): Promise<void>
}

export interface MasterService {
  status(): MasterStatus
  link(input: { enrolToken: string; label: string; serviceRoleKey: string }): Promise<MasterStatus>
  redeem(input: { code: string }): Promise<MasterStatus>
  adopt(): Promise<MasterAdoptOutcome>
  refreshCredentials(): Promise<MasterRefreshOutcome>
  heartbeat(): Promise<MasterHeartbeatOutcome>
  seatList(): Promise<{ company: { id: string; label: string; maxSeats: number; status: string }; seats: SeatView[] }>
  seatCreate(input: { label: string }): Promise<SeatView>
  seatReset(input: { seatNo: number }): Promise<SeatView>
  seatRevoke(input: { seatNo: number }): Promise<SeatView>
  seatRename(input: { seatNo: number; label: string }): Promise<SeatView>
  seatRegen(input: { seatNo: number }): Promise<SeatView>
  profileGet(): Promise<ProfileView>
  profileSet(input: { name: string; phone: string; address: string; logo?: string | null; expectVersion?: number }): Promise<ProfileView>
}

const CODE_TO_APP: Partial<Record<MasterErrorCode, ErrorCode>> = {
  Q3M90: 'SYNC_OFFLINE', Q3M04: 'AUTH_FAILED', Q3M05: 'AUTH_FAILED', Q3M07: 'AUTH_FAILED', Q3M14: 'AUTH_FAILED', Q3M06: 'LICENSE_INVALID',
  Q3M01: 'VALIDATION', Q3M03: 'VALIDATION', Q3M91: 'VALIDATION', Q3M18: 'VALIDATION', Q3M15: 'VALIDATION', Q3M16: 'VALIDATION', Q3M13: 'CONFLICT_REVISION', Q3M20: 'CONFLICT_REVISION'
}

/** A `MasterError` (or a code) as the `AppError` the IPC envelope understands: plain words, the code in `details`. */
export function masterAppError(codeOrError: MasterErrorCode | unknown, words?: string): AppError {
  const code: MasterErrorCode | null = typeof codeOrError === 'string' ? (codeOrError as MasterErrorCode) : codeOrError instanceof MasterError ? codeOrError.code : null
  if (!code) return new AppError('UNKNOWN', masterErrorWords('Q3M99'), { code: 'Q3M99' })
  return new AppError(CODE_TO_APP[code] ?? 'IO_ERROR', words ?? masterErrorWords(code), { code })
}

export function createMasterService(deps: MasterServiceDeps): MasterService {
  const { client, store } = deps
  const configured = (): boolean => isMasterConfigured(deps.config.url, deps.config.anon)
  const platform = 'desktop' as const

  function status(): MasterStatus {
    const l = store.link()
    return {
      configured: configured(), linked: l !== null, companyLabel: l?.companyLabel ?? null, seatNo: l?.seatNo ?? null, seatLabel: l?.seatLabel ?? null,
      isAdmin: l?.seatNo === 1, profileVersion: l?.profileVersion ?? null, lastError: store.lastError()
    }
  }

  const failure = (e: unknown): MasterFailure => {
    const code: MasterErrorCode = e instanceof MasterError ? e.code : 'Q3M99'
    return { ok: false, code, message: masterErrorWords(code) }
  }
  /** Remember the problem in plain words (the master's own sentences only, never a body or a token). */
  const remember = (e: unknown): void => {
    const f = failure(e)
    store.setLastError(f.message)
    deps.log.warn('master problem', redactSecrets({ code: f.code }))
  }
  const needConfigured = (): void => {
    if (!configured()) throw new AppError('IO_ERROR', 'The master is not set up in this app yet.', { code: 'Q3M90' })
  }
  const needLink = (): { deviceToken: string; seatNo: number } => {
    needConfigured()
    const l = store.link()
    if (!l) throw masterAppError('Q3M15')
    return l
  }

  /** Run an explicit call: configured + linked, errors remembered and rethrown as AppError, success clears the last problem. */
  async function admin<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const l = needLink()
    try {
      const out = await fn(l.deviceToken)
      store.setLastError('')
      return out
    } catch (e) {
      if (e instanceof MasterError) { remember(e); throw masterAppError(e) }
      throw e
    }
  }

  async function companySession(): Promise<{ url: string; anonKey: string; license: string; accessToken: string } | null> {
    const c = deps.company.credentials()
    if (!c) return null
    let accessToken: string | null = null
    try { accessToken = await deps.company.accessToken() } catch { accessToken = null }
    return accessToken ? { ...c, accessToken } : null
  }

  return {
    status,

    async link(input) {
      needConfigured()
      const session = await companySession()
      if (!session) throw new AppError('VALIDATION', 'Sign in to sync on this computer first, then link it to the master.')
      try {
        const r = await client.enrol({
          enrolToken: input.enrolToken, label: input.label, supabaseUrl: session.url, anonKey: session.anonKey, license: session.license,
          accessToken: session.accessToken, serviceRoleKey: input.serviceRoleKey, platform, appVersion: deps.appVersion
        })
        let version: number | null = null
        if (deps.applyProfile) { await deps.applyProfile(r.profile); version = r.profile.version }
        store.save({ deviceToken: r.deviceToken, companyId: r.company.id, companyLabel: r.company.label, seatNo: 1, seatLabel: 'Seat 1', profileVersion: version })
        store.setLastError('')
      } catch (e) {
        if (e instanceof MasterError) { remember(e); throw masterAppError(e) }
        throw e
      }
      return status()
    },

    async redeem(input) {
      const v = validateSeatCode(input.code)
      if (!v.ok) throw masterAppError('Q3M91') // offline check, no network call (T30)
      needConfigured()
      if (!deps.applyBundle) throw new AppError('IO_ERROR', 'Linking by code is not available on this computer yet.')
      try {
        const bundle = await client.redeem({ code: v.code, platform, deviceLabel: deps.deviceLabel(), appVersion: deps.appVersion })
        await deps.applyBundle(bundle)
        store.save({ deviceToken: bundle.deviceToken, companyId: bundle.company.id, companyLabel: bundle.company.label, seatNo: bundle.seat.no, seatLabel: `Seat ${bundle.seat.no}`, profileVersion: null })
        store.setLastError('')
      } catch (e) {
        if (e instanceof MasterError) { remember(e); throw masterAppError(e) }
        throw e
      }
      return status()
    },

    async adopt() {
      if (!configured()) return { status: status(), adopted: false, error: null }
      const session = await companySession()
      if (!session) return { status: status(), adopted: false, error: null }
      try {
        const known = store.link()
        const r = await client.adopt({ supabaseUrl: session.url, accessToken: session.accessToken, platform, deviceLabel: deps.deviceLabel(), appVersion: deps.appVersion }, known?.deviceToken)
        const token = r.deviceToken ?? known?.deviceToken
        if (!token) { store.setLastError(''); return { status: status(), adopted: false, error: null } }
        store.save({ deviceToken: token, companyId: r.company.id, companyLabel: r.company.label, seatNo: r.seat.no, seatLabel: r.seat.label, profileVersion: known?.profileVersion ?? null })
        store.setLastError('')
        return { status: status(), adopted: true, error: null }
      } catch (e) {
        // A company that is simply not linked to the master is the normal case for old setups: no error shown.
        if (e instanceof MasterError && e.code === 'Q3M15') { store.setLastError(''); return { status: status(), adopted: false, error: null } }
        remember(e)
        return { status: status(), adopted: false, error: failure(e) }
      }
    },

    async refreshCredentials() {
      const l = store.link()
      if (!configured() || !l) return failure(new MasterError('Q3M04'))
      try {
        const r = await client.refresh(l.deviceToken)
        store.setLastError('')
        const legacy = r.legacy || r.seat.password === null
        if (!legacy && deps.applyCredentials) { await deps.applyCredentials(r); return { ok: true, legacy: false, applied: true } }
        return { ok: true, legacy, applied: false }
      } catch (e) {
        remember(e)
        return failure(e)
      }
    },

    async heartbeat() {
      const l = store.link()
      if (!configured() || !l) return failure(new MasterError('Q3M04'))
      try {
        const r = await client.heartbeat({ profileVersion: l.profileVersion, appVersion: deps.appVersion }, l.deviceToken)
        store.setSeat(r.seat.no, r.seat.label)
        let applied = false
        if (r.profileChanged && deps.applyProfile) {
          const p = await client.profileGet(l.deviceToken)
          await deps.applyProfile(p)
          store.setProfileVersion(p.version)
          applied = true
        }
        if (r.seat.status === 'revoked') store.setLastError(masterErrorWords('Q3M07'))
        else store.setLastError('')
        return { ok: true, profileChanged: r.profileChanged, profileApplied: applied, seatStatus: r.seat.status, companyStatus: r.company.status }
      } catch (e) {
        remember(e)
        return failure(e)
      }
    },

    seatList: () => admin((t) => client.seatList(t)),
    seatCreate: (i) => admin((t) => client.seatCreate({ reqId: deps.newReqId(), label: i.label }, t)),
    seatReset: (i) => admin((t) => client.seatReset({ reqId: deps.newReqId(), seatNo: i.seatNo }, t)),
    seatRevoke: (i) => admin((t) => client.seatRevoke({ reqId: deps.newReqId(), seatNo: i.seatNo }, t)),
    seatRename: (i) => admin((t) => client.seatRename({ seatNo: i.seatNo, label: i.label }, t)),
    seatRegen: (i) => admin((t) => client.seatRegen({ reqId: deps.newReqId(), seatNo: i.seatNo }, t)),
    profileGet: () => admin((t) => client.profileGet(t)),

    async profileSet(input) {
      if (profileTooLarge(input)) throw masterAppError('Q3M18')
      return admin(async (t) => {
        const body: { reqId: string; name: string; phone: string; address: string; logo?: string | null; expectVersion?: number } = { reqId: deps.newReqId(), name: input.name, phone: input.phone, address: input.address }
        if (input.logo !== undefined) body.logo = input.logo
        if (input.expectVersion !== undefined) body.expectVersion = input.expectVersion
        const p = await client.profileSet(body, t)
        if (deps.applyProfile) await deps.applyProfile(p)
        store.setProfileVersion(p.version)
        return p
      })
    }
  }
}
