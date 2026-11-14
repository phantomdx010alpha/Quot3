/**
 * Phase 260 - the shared request / response layer of every master function: CORS, method + body checks, error envelope,
 * rate limit, device-token check, throttled `last_seen_at`. Logging goes through `redact` only.
 */
import { MASTER_MAX_BODY_BYTES } from '../../../../src/shared/master/config'
import { masterErrorBody, masterErrorHttp, type MasterErrorCode } from '../../../../src/shared/master/errors'
import { redactedJson } from '../../../../src/shared/master/redact'
import { b64urlEncode, sha256Hex } from '../../../../src/shared/master/seal'
import { parseRequest } from '../../../../src/shared/master/schemas'
import type { z } from 'zod'
import type { CompanyRow, Deps, DeviceRow, SeatRow } from './types'

/** Thrown inside a handler to answer a `Q3M*` code. */
export class MasterError extends Error {
  constructor(public readonly code: MasterErrorCode) {
    super(code)
    this.name = 'MasterError'
  }
}

export const RATE_LIMIT_FAILS = 10
export const RATE_WINDOW_MS = 15 * 60 * 1000
export const LAST_SEEN_THROTTLE_MS = 60 * 1000

export interface Ctx {
  deps: Deps
  req: Request
  body: unknown
  ipHash: string
}

function corsHeaders(deps: Deps): Record<string, string> {
  const h: Record<string, string> = {
    'access-control-allow-headers': 'apikey, authorization, content-type, x-q3-device',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin'
  }
  if (deps.allowedOrigin) h['access-control-allow-origin'] = deps.allowedOrigin
  return h
}

function json(deps: Deps, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(deps) }
  })
}

export const failResponse = (deps: Deps, code: MasterErrorCode | string): Response =>
  json(deps, masterErrorHttp(code), masterErrorBody(code))

/** Client ip for rate limiting: first `x-forwarded-for` entry, else `cf-connecting-ip`, else 'unknown'. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return (xff.split(',')[0] ?? '').trim() || 'unknown'
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown'
}

/**
 * Run one function: OPTIONS -> 204, only POST, body <= 400 KB (else Q3M18), JSON (else Q3M03), then `run`. A `MasterError`
 * becomes its failure body; anything else is logged (redacted) and answered Q3M99. Success = `{ ok: true, ...fields }`.
 */
export async function runFunction(
  req: Request,
  deps: Deps,
  name: string,
  run: (ctx: Ctx) => Promise<Record<string, unknown>>
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(deps) })
  try {
    if (req.method !== 'POST') throw new MasterError('Q3M03')
    const text = await req.text()
    if (new TextEncoder().encode(text).length > MASTER_MAX_BODY_BYTES) throw new MasterError('Q3M18')
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new MasterError('Q3M03')
    }
    const ipHash = await sha256Hex(clientIp(req) + deps.pepper)
    const fields = await run({ deps, req, body, ipHash })
    return json(deps, 200, { ok: true, ...fields })
  } catch (e) {
    if (e instanceof MasterError) return failResponse(deps, e.code)
    deps.log(redactedJson({ fn: name, internal: e }))
    return failResponse(deps, 'Q3M99')
  }
}

/** Parse the body with a schema from `shared/master/schemas`; Q3M19 for a wrong wire version, Q3M03 for a bad shape. */
export function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = parseRequest(schema, body)
  if (!r.ok) throw new MasterError(r.code)
  return r.value
}

/** Rate limit for the no-device functions: 10 failed tries in 15 minutes from one ip hash -> Q3M02. */
export async function checkRate(ctx: Ctx): Promise<void> {
  const since = new Date(ctx.deps.now().getTime() - RATE_WINDOW_MS).toISOString()
  if ((await ctx.deps.db.attemptsRecent(ctx.ipHash, since)) >= RATE_LIMIT_FAILS) throw new MasterError('Q3M02')
}
export const noteAttempt = (ctx: Ctx, ok: boolean): Promise<void> =>
  ctx.deps.db.recordAttempt(ctx.ipHash, ok, ctx.deps.now().toISOString())

/** Write the master log (`detail` = `ok` or an error code only). A failing log write never breaks the answer. */
export async function logAction(
  ctx: Ctx,
  action: string,
  detail: string,
  who: { company_id?: string | null; seat_no?: number | null } = {}
): Promise<void> {
  try {
    await ctx.deps.db.log({ company_id: who.company_id ?? null, seat_no: who.seat_no ?? null, action, req_id: null, detail })
  } catch (e) {
    ctx.deps.log(redactedJson({ fn: action, log_failed: e }))
  }
}

export interface DeviceAuth {
  device: DeviceRow
  seat: SeatRow
  company: CompanyRow
  tokenHash: string
}

/** `x-q3-device` -> device -> seat -> company, or Q3M04 (missing, unknown or orphaned). Status checks are the caller's. */
export async function requireDevice(ctx: Ctx): Promise<DeviceAuth> {
  const token = ctx.req.headers.get('x-q3-device')?.trim()
  if (!token) throw new MasterError('Q3M04')
  const tokenHash = await sha256Hex(token)
  const device = await ctx.deps.db.findDeviceByTokenHash(tokenHash)
  if (!device) throw new MasterError('Q3M04')
  const seat = await ctx.deps.db.findSeat(device.company_id, device.seat_no)
  const company = await ctx.deps.db.findCompanyById(device.company_id)
  if (!seat || !company) throw new MasterError('Q3M04')
  return { device, seat, company, tokenHash }
}

/** Seat must be active (else Q3M07), then the company active (else Q3M06). */
export function requireActive(a: { seat: SeatRow; company: CompanyRow }): void {
  if (a.seat.status !== 'active') throw new MasterError('Q3M07')
  if (a.company.status !== 'active') throw new MasterError('Q3M06')
}

/** `last_seen_at` is written at most once per 60 s per device. */
export async function touchDevice(ctx: Ctx, device: DeviceRow): Promise<void> {
  const now = ctx.deps.now().getTime()
  const last = device.last_seen_at ? Date.parse(device.last_seen_at) : 0
  if (!device.last_seen_at || now - last >= LAST_SEEN_THROTTLE_MS) {
    await ctx.deps.db.touchDevice(device.id, new Date(now).toISOString())
  }
}

/** A new device token: 32 random bytes as base64url (43 characters). The master keeps only its sha256 hex. */
export async function newDeviceToken(deps: Deps): Promise<{ token: string; hash: string }> {
  const token = b64urlEncode(deps.randomBytes(32))
  return { token, hash: await sha256Hex(token) }
}

/** Company URL as compared by `adopt`: lower-case, no trailing slash. */
export const normaliseUrl = (u: string): string => u.trim().toLowerCase().replace(/\/+$/, '')
