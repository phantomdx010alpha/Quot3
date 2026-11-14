/**
 * Phase 263 - the desktop's door to the MASTER (API_CONTRACTS.md M24-0 C1): POST {MASTER_URL}/functions/v1/<name>, JSON in / out,
 * `v: 1` on every body, client timeout 10 s and ONE retry (network error or 5xx only, never after a 4xx), every failure turned into
 * a `Q3M*` code with its plain words (offline = Q3M90, unreadable answer = Q3M93, `v` of a bundle other than 1 = Q3M92).
 * Every answer is checked with the zod schema of `shared/master/schemas.ts`. Logging goes through `redactSecrets` and names only the function and the
 * outcome; no body, header or token is ever logged. `fetch` and the delay are injected (tests use a fake).
 */
import type { z } from 'zod'
import { MASTER_RETRIES, MASTER_TIMEOUT_MS, MASTER_WIRE_VERSION, masterFunctionUrl, masterHeaders } from '../../../shared/master/config'
import { isMasterErrorCode, masterErrorWords, type MasterErrorCode } from '../../../shared/master/errors'
import { redactSecrets } from '../../../shared/master/redact'
import { MASTER_FUNCTIONS, parseBundle, parseErrorBody, type Bundle, type MasterFunctionKey, type ProfileView, type SeatView } from '../../../shared/master/schemas'

export class MasterError extends Error {
  readonly code: MasterErrorCode
  constructor(code: MasterErrorCode) {
    super(masterErrorWords(code))
    this.name = 'MasterError'
    this.code = code
  }
}

export interface MasterClientDeps {
  url: string
  anon: string
  fetchImpl: (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>
  log: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  /** Pause before the single retry (real: 400 ms; tests: none). */
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

type Res<K extends MasterFunctionKey> = z.infer<(typeof MASTER_FUNCTIONS)[K]['response']>
type Platform = 'desktop' | 'phone'

export interface MasterClient {
  redeem(a: { code: string; platform: Platform; deviceLabel?: string; appVersion: string }): Promise<Bundle>
  adopt(a: { supabaseUrl: string; accessToken: string; platform: Platform; deviceLabel?: string; appVersion: string }, deviceToken?: string): Promise<Res<'adopt'>>
  refresh(deviceToken: string): Promise<Res<'refresh'>>
  heartbeat(a: { profileVersion: number | null; appVersion: string }, deviceToken: string): Promise<Res<'heartbeat'>>
  profileGet(deviceToken: string): Promise<ProfileView>
  profileSet(a: { reqId: string; expectVersion?: number; name: string; phone: string; address: string; logo?: string | null }, deviceToken: string): Promise<ProfileView>
  seatList(deviceToken: string): Promise<Res<'seat-list'>>
  seatCreate(a: { reqId: string; label: string }, deviceToken: string): Promise<SeatView>
  seatReset(a: { reqId: string; seatNo: number }, deviceToken: string): Promise<SeatView>
  seatRevoke(a: { reqId: string; seatNo: number }, deviceToken: string): Promise<SeatView>
  seatRename(a: { seatNo: number; label: string }, deviceToken: string): Promise<SeatView>
  seatRegen(a: { reqId: string; seatNo: number }, deviceToken: string): Promise<SeatView>
  enrol(a: { enrolToken: string; label: string; supabaseUrl: string; anonKey: string; license: string; accessToken: string; serviceRoleKey: string; platform: Platform; appVersion: string }): Promise<Res<'enrol'>>
}

export function createMasterClient(deps: MasterClientDeps): MasterClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const note = (level: 'info' | 'warn', fn: string, outcome: string): void => deps.log[level]('master call', redactSecrets({ fn, outcome }))

  /** One POST with the retry rule. Returns the parsed JSON; throws `MasterError`. */
  async function post(name: MasterFunctionKey, body: Record<string, unknown>, deviceToken: string | undefined, raw = false): Promise<unknown> {
    const url = masterFunctionUrl(deps.url, name)
    const payload = JSON.stringify({ v: MASTER_WIRE_VERSION, ...body })
    let lastFailure: MasterErrorCode = 'Q3M90'
    for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
      if (attempt > 0) await sleep(400)
      let res: { status: number; text(): Promise<string> }
      try {
        res = await deps.fetchImpl(url, { method: 'POST', headers: masterHeaders(deps.anon, deviceToken), body: payload, signal: AbortSignal.timeout(deps.timeoutMs ?? MASTER_TIMEOUT_MS) })
      } catch {
        lastFailure = 'Q3M90'
        continue
      }
      let json: unknown = null
      try { json = JSON.parse(await res.text()) } catch { /* not JSON */ }
      if (res.status >= 500 && attempt < MASTER_RETRIES) { lastFailure = failureCode(json, res.status); continue }
      const bad = (json as { ok?: unknown } | null)?.ok === false || res.status >= 400
      if (bad) {
        const code = failureCode(json, res.status)
        note('warn', name, code)
        throw new MasterError(code)
      }
      if (raw) { note('info', name, 'ok'); return json }
      const checked = (MASTER_FUNCTIONS[name].response as z.ZodType).safeParse(json)
      if (!checked.success) { note('warn', name, 'Q3M93'); throw new MasterError('Q3M93') }
      note('info', name, 'ok')
      return checked.data
    }
    note('warn', name, lastFailure)
    throw new MasterError(lastFailure)
  }

  const seat = async (name: MasterFunctionKey, body: Record<string, unknown>, t: string): Promise<SeatView> => ((await post(name, body, t)) as { seat: SeatView }).seat

  return {
    async redeem(a) {
      const json = (await post('redeem', a, undefined, true)) as { bundle?: unknown } | null
      const parsed = parseBundle(json?.bundle)
      if (!parsed.ok) { note('warn', 'redeem', parsed.code); throw new MasterError(parsed.code) }
      return parsed.bundle
    },
    adopt: async (a, t) => (await post('adopt', a, t)) as Res<'adopt'>,
    refresh: async (t) => (await post('refresh', {}, t)) as Res<'refresh'>,
    heartbeat: async (a, t) => (await post('heartbeat', a, t)) as Res<'heartbeat'>,
    profileGet: async (t) => ((await post('profile-get', {}, t)) as { profile: ProfileView }).profile,
    profileSet: async (a, t) => ((await post('profile-set', a, t)) as { profile: ProfileView }).profile,
    seatList: async (t) => (await post('seat-list', {}, t)) as Res<'seat-list'>,
    seatCreate: (a, t) => seat('seat-create', a, t),
    seatReset: (a, t) => seat('seat-reset', a, t),
    seatRevoke: (a, t) => seat('seat-revoke', a, t),
    seatRename: (a, t) => seat('seat-rename', a, t),
    seatRegen: (a, t) => seat('seat-regen', a, t),
    enrol: async (a) => (await post('enrol', a, undefined)) as Res<'enrol'>
  }
}

/** The code of a failure answer: the server's own `Q3M*` code when it is one we know, else Q3M99 for a 5xx and Q3M93 for anything unreadable. */
function failureCode(json: unknown, status: number): MasterErrorCode {
  const body = parseErrorBody(json)
  if (body && isMasterErrorCode(body.code)) return body.code
  return status >= 500 ? 'Q3M99' : 'Q3M93'
}
