import type { z } from 'zod'
import { isMasterConfigured, MASTER_RETRIES, MASTER_TIMEOUT_MS, MASTER_WIRE_VERSION, masterFunctionUrl, masterHeaders, type MasterFunctionName } from '../../shared/master/config'
import { isMasterErrorCode, masterErrorWords, type MasterErrorCode } from '../../shared/master/errors'
import { redactSecrets } from '../../shared/master/redact'
import { MASTER_FUNCTIONS, parseBundle, parseErrorBody, type Bundle, type MasterFunctionKey, type ProfileView } from '../../shared/master/schemas'
import { validateSeatCode } from '../../shared/master/seatCode'
import type { PhoneDb } from '../data/db'
import { getBranchLink, linkPhoneToOrganisation, type BranchLink, type LinkResult } from './branch'
import type { SessionVault } from './session'
import type { PhoneSyncPort } from './transport'

/**
 * Phase 268 (M24) - the phone's door to the MASTER (API_CONTRACTS.md M24-N; wire contract M24-0). NO UI.
 * Runs in the PWA: fetch only, no Node / Electron imports; shapes, error words, the seat-code check and `redact` come from `src/shared/master/*`.
 * - `createPhoneMasterClient`: redeem / adopt / refresh / heartbeat / profile-get. Timeout 10 s, ONE retry (network error or 5xx only), every
 *   failure is a `PhoneMasterError` with a `Q3M*` code and plain words (offline = Q3M90). Logging names only the function and the outcome.
 * - `redeemCode`: check the code offline -> redeem -> sign in with the bundle (the password lives in memory for this call only) and register the
 *   phone's branch through the EXISTING `linkPhoneToOrganisation` -> keep the device token in the vault (optional `deviceToken` key) -> the existing
 *   "linked" state, so the existing first-sync flow runs.
 * - `adoptIfPossible`: an old phone (valid session, already linked, no device token) quietly gets its device token. Never throws.
 */
export const PHONE_NOT_CONFIGURED_WORDS = 'Company codes are not switched on in this version yet.'

export class PhoneMasterError extends Error {
  readonly code: MasterErrorCode
  constructor(code: MasterErrorCode) {
    super(masterErrorWords(code))
    this.name = 'PhoneMasterError'
    this.code = code
  }
}

export interface PhoneMasterDeps {
  url: string
  anon: string
  appVersion: string
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>
  log?: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  /** Pause before the single retry (real: 400 ms; tests: none). */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface PhoneMasterClient {
  configured(): boolean
  redeem(a: { code: string; deviceLabel?: string }): Promise<Bundle>
  adopt(a: { supabaseUrl: string; accessToken: string; deviceLabel?: string }, deviceToken?: string): Promise<{ deviceToken: string | null; existing: boolean; seat: { no: number; label: string }; company: { id: string; label: string }; profile: ProfileView | null }>
  /** The new seat password for a reset seat (Phase 269 uses it). `password` is null for a legacy seat. */
  refresh(deviceToken: string): Promise<{ supabaseUrl: string; anonKey: string; license: string; seat: { no: number; email: string; password: string | null }; legacy: boolean }>
  heartbeat(a: { profileVersion: number | null }, deviceToken: string): Promise<{ profileChanged: boolean; seat: { no: number; label: string; status: string } }>
  profileGet(deviceToken: string): Promise<ProfileView>
}

export function createPhoneMasterClient(deps: PhoneMasterDeps): PhoneMasterClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const note = (level: 'info' | 'warn', fn: string, outcome: string): void => deps.log?.[level]('master call', redactSecrets({ fn, outcome }))
  const configured = (): boolean => isMasterConfigured(deps.url, deps.anon)

  async function post(name: MasterFunctionName, body: Record<string, unknown>, deviceToken: string | undefined, raw = false): Promise<unknown> {
    if (!configured()) throw new PhoneMasterError('Q3M90')
    const payload = JSON.stringify({ v: MASTER_WIRE_VERSION, ...body })
    let last: MasterErrorCode = 'Q3M90'
    for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
      if (attempt > 0) await sleep(400)
      let res: { status: number; text(): Promise<string> }
      try {
        res = await deps.fetchImpl(masterFunctionUrl(deps.url, name), {
          method: 'POST', headers: masterHeaders(deps.anon, deviceToken), body: payload, signal: AbortSignal.timeout(deps.timeoutMs ?? MASTER_TIMEOUT_MS)
        })
      } catch {
        last = 'Q3M90'
        continue
      }
      let json: unknown = null
      try { json = JSON.parse(await res.text()) } catch { /* not JSON */ }
      if (res.status >= 500 && attempt < MASTER_RETRIES) { last = failureCode(json, res.status); continue }
      if ((json as { ok?: unknown } | null)?.ok === false || res.status >= 400) {
        const code = failureCode(json, res.status)
        note('warn', name, code)
        throw new PhoneMasterError(code)
      }
      if (raw) { note('info', name, 'ok'); return json }
      const checked = (MASTER_FUNCTIONS[name as MasterFunctionKey].response as z.ZodType).safeParse(json)
      if (!checked.success) { note('warn', name, 'Q3M93'); throw new PhoneMasterError('Q3M93') }
      note('info', name, 'ok')
      return checked.data
    }
    note('warn', name, last)
    throw new PhoneMasterError(last)
  }

  return {
    configured,
    async redeem(a) {
      const json = (await post('redeem', { code: a.code, platform: 'phone', deviceLabel: a.deviceLabel, appVersion: deps.appVersion }, undefined, true)) as { bundle?: unknown } | null
      const parsed = parseBundle(json?.bundle)
      if (!parsed.ok) { note('warn', 'redeem', parsed.code); throw new PhoneMasterError(parsed.code) }
      return parsed.bundle
    },
    adopt: async (a, t) => (await post('adopt', { ...a, platform: 'phone', appVersion: deps.appVersion }, t)) as Awaited<ReturnType<PhoneMasterClient['adopt']>>,
    refresh: async (t) => (await post('refresh', {}, t)) as Awaited<ReturnType<PhoneMasterClient['refresh']>>,
    heartbeat: async (a, t) => (await post('heartbeat', { profileVersion: a.profileVersion, appVersion: deps.appVersion }, t)) as Awaited<ReturnType<PhoneMasterClient['heartbeat']>>,
    profileGet: async (t) => ((await post('profile-get', {}, t)) as { profile: ProfileView }).profile
  }
}

function failureCode(json: unknown, status: number): MasterErrorCode {
  const body = parseErrorBody(json)
  if (body && isMasterErrorCode(body.code)) return body.code
  return status >= 500 ? 'Q3M99' : 'Q3M93'
}

/**
 * The branch a phone gets when the person typed only a code [A]: the seat's own name (as the admin typed it) and `P<seat no>`. Pure.
 * An old master that sends no seat name gives `Phone <company>` as before.
 */
export function defaultPhoneBranch(seat: { no: number; label?: string }, label: string): { branchName: string; poPrefix: string } {
  const own = (seat.label ?? '').trim().replace(/\s+/g, ' ')
  const base = own !== '' ? own : `Phone ${label.trim() === '' ? `seat ${seat.no}` : label.trim()}`
  return { branchName: base.slice(0, 80), poPrefix: `P${seat.no}`.slice(0, 8) }
}

/** Try number `i` (0 = the plain name) when the company already has a branch of that name: `Rahul 2`, `Rahul 3`... Pure, max 80 letters. */
export function nameVariant(base: string, i: number): string {
  if (i <= 0) return base
  const suffix = ` ${i + 1}`
  return base.slice(0, 80 - suffix.length).trimEnd() + suffix
}

/** Try number `i` when the company already uses that PO prefix: `P9`, `P9A`, `P9B`... (up to 8 characters). Pure. */
export function prefixVariant(base: string, i: number): string {
  if (i <= 0) return base
  return base.slice(0, 7) + String.fromCharCode(64 + Math.min(i, 26))
}

const MAX_BRANCH_TRIES = 10

export type RedeemResult =
  | { ok: true; link: BranchLink; seatNo: number; companyLabel: string; profile: ProfileView | null; branches: Extract<LinkResult, { ok: true }>['branches'] }
  | { ok: false; code: MasterErrorCode | 'LINK'; message: string; link?: LinkResult }

export interface RedeemDeps {
  db: PhoneDb; vault: SessionVault; port: PhoneSyncPort; master: PhoneMasterClient; deviceLabel?: () => string; nowMs?: () => number
  /** Phase 269: called with the company's address once the code is accepted, BEFORE the sign-in (the real port is built from it). */
  onBundle?: (b: { supabaseUrl: string; anonKey: string }) => void
}

/** Code -> linked phone. Nothing is stored unless every step worked; the seat password never leaves this function. */
export async function redeemCode(deps: RedeemDeps, input: string, opts: { branchName?: string; poPrefix?: string } = {}): Promise<RedeemResult> {
  const v = validateSeatCode(input)
  if (!v.ok) return { ok: false, code: 'Q3M91', message: masterErrorWords('Q3M91') } // a typo is caught here, no network call
  if (!deps.master.configured()) return { ok: false, code: 'Q3M90', message: PHONE_NOT_CONFIGURED_WORDS }
  let bundle: Bundle
  try {
    bundle = await deps.master.redeem({ code: v.code, ...(deps.deviceLabel ? { deviceLabel: deps.deviceLabel() } : {}) })
  } catch (e) {
    const code = e instanceof PhoneMasterError ? e.code : 'Q3M99'
    return { ok: false, code, message: masterErrorWords(code) }
  }
  deps.onBundle?.({ supabaseUrl: bundle.supabaseUrl, anonKey: bundle.anonKey })
  const def = defaultPhoneBranch(bundle.seat, bundle.company.label)
  // Name and prefix chosen by us (not typed, not kept from a removed seat): if the company already uses them, try the next variant instead of failing.
  const auto = opts.branchName === undefined && opts.poPrefix === undefined
  let nameTry = 0
  let prefixTry = 0
  let link: LinkResult
  for (let attempt = 0; ; attempt++) {
    link = await linkPhoneToOrganisation(deps.db, deps.port, deps.vault, {
      supabaseUrl: bundle.supabaseUrl, anonKey: bundle.anonKey, licenseKey: bundle.license, email: bundle.seat.email, password: bundle.seat.password,
      branchName: opts.branchName ?? nameVariant(def.branchName, nameTry), poPrefix: opts.poPrefix ?? prefixVariant(def.poPrefix, prefixTry), device: deps.deviceLabel?.() ?? 'Phone'
    }, deps.nowMs)
    if (link.ok || !auto || link.code !== 'SYNC' || attempt + 1 >= MAX_BRANCH_TRIES) break
    if (link.failure.kind === 'name_taken') nameTry++
    else if (link.failure.kind === 'prefix_taken') prefixTry++
    else break
  }
  if (!link.ok) {
    const message = link.code === 'SYNC' ? link.failure.message : link.code === 'VALIDATION' ? 'The company details from the master could not be used. Ask the admin for a new code.' : link.message
    return { ok: false, code: 'LINK', message, link }
  }
  try {
    const d = await deps.vault.load()
    if (!d) throw new Error('no vault')
    await deps.vault.save({ ...d, deviceToken: bundle.deviceToken })
  } catch {
    return { ok: false, code: 'Q3M99', message: 'This phone could not keep the company login. Try again.' }
  }
  return { ok: true, link: await getBranchLink(deps.db), seatNo: bundle.seat.no, companyLabel: bundle.company.label, profile: bundle.profile, branches: link.branches }
}

export type AdoptResult =
  | { adopted: true }
  | { adopted: false; reason: 'not_configured' | 'not_linked' | 'no_session' | 'session_expired' | 'has_token' | 'no_token_issued' | 'failed'; message?: string }

export interface AdoptDeps { db: PhoneDb; vault: SessionVault; master: PhoneMasterClient; nowMs?: () => number }

/** Old phones: a valid session + a linked company + no device token -> ask the master once, keep the token. Silent: never throws, never signs out. */
export async function adoptIfPossible(deps: AdoptDeps): Promise<AdoptResult> {
  try {
    if (!deps.master.configured()) return { adopted: false, reason: 'not_configured' }
    const d = await deps.vault.load()
    if (!d) return { adopted: false, reason: 'not_linked' }
    if (d.deviceToken) return { adopted: false, reason: 'has_token' }
    if (!d.session) return { adopted: false, reason: 'no_session' }
    if (!(await getBranchLink(deps.db)).linked) return { adopted: false, reason: 'not_linked' }
    if (d.session.expiresAt * 1000 <= (deps.nowMs ?? Date.now)()) return { adopted: false, reason: 'session_expired' }
    const r = await deps.master.adopt({ supabaseUrl: d.supabaseUrl, accessToken: d.session.accessToken })
    if (!r.deviceToken) return { adopted: false, reason: 'no_token_issued' }
    const latest = (await deps.vault.load()) ?? d // a session refresh may have landed meanwhile: keep the newest session
    await deps.vault.save({ ...latest, deviceToken: r.deviceToken })
    return { adopted: true }
  } catch (e) {
    const code = e instanceof PhoneMasterError ? e.code : 'Q3M99'
    return { adopted: false, reason: 'failed', message: masterErrorWords(code) }
  }
}
