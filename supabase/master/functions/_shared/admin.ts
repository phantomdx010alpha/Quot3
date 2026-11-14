/**
 * Phase 261 - what the seat-admin functions (F6-F13) share: the seat-1 check, the idempotency claim (D8), the company
 * calls with the sealed service_role key, and row -> `SeatView`. The check is on the master, never only in the client.
 */
import { generateSeatCode, seatCodeChars } from '../../../../src/shared/master/seatCode'
import type { SeatView } from '../../../../src/shared/master/schemas'
import { SealError, openText, sealText, seatCodeHash } from '../../../../src/shared/master/seal'
import { aadSeatCode, aadSeatPassword, aadServiceRole } from './aad'
import { MasterError, logAction, requireActive, requireDevice, type Ctx, type DeviceAuth } from './http'
import { CompanyCallError, type CompanyRow, type DeviceRow, type SeatRow } from './types'

/** Device token -> seat 1 of an active company, else Q3M04 / Q3M05 (not seat 1) / Q3M07 (seat 1 removed) / Q3M06 (company off). */
export async function requireAdmin(ctx: Ctx, action: string): Promise<DeviceAuth> {
  const a = await requireDevice(ctx)
  const who = { company_id: a.company.id, seat_no: a.seat.seat_no }
  try {
    if (a.seat.seat_no !== 1) throw new MasterError('Q3M05')
    requireActive(a)
  } catch (e) {
    if (e instanceof MasterError) await logAction(ctx, action, e.code, who)
    throw e
  }
  return a
}

/**
 * Run `run` once per (company, action, reqId). A repeated reqId answers Q3M13 and changes nothing. When `run` fails BEFORE
 * it called `changed()` the claim is given back, so the same reqId can be retried after a company outage.
 */
export async function once<T>(ctx: Ctx, a: DeviceAuth, action: string, reqId: string, run: (changed: () => void) => Promise<T>): Promise<T> {
  const { db } = ctx.deps
  if (!(await db.claimRequest(a.company.id, action, reqId, a.seat.seat_no))) {
    await logAction(ctx, action, 'Q3M13', { company_id: a.company.id, seat_no: a.seat.seat_no })
    throw new MasterError('Q3M13')
  }
  let didChange = false
  try {
    return await run(() => { didChange = true })
  } catch (e) {
    if (!didChange) {
      await db.releaseRequest(a.company.id, action, reqId).catch(() => undefined)
      if (e instanceof MasterError) await logAction(ctx, action, e.code, { company_id: a.company.id, seat_no: a.seat.seat_no })
    } else {
      // The company changed but the master write failed: keep the claim (a retry would make a second seat) and tell the owner.
      await logAction(ctx, `${action}.master_write_failed`, 'Q3M99', { company_id: a.company.id, seat_no: a.seat.seat_no })
    }
    throw e
  }
}

/** The company's service_role key, unsealed for this request only. */
export async function companyKey(ctx: Ctx, c: CompanyRow): Promise<string> {
  try {
    return await openText(ctx.deps.kek, c.service_role_enc, aadServiceRole(c.id))
  } catch (e) {
    if (e instanceof SealError) throw new MasterError('Q3M99')
    throw e
  }
}

/** A company-project call: network / 5xx -> Q3M11, anything else the company refused -> Q3M12. */
export async function callCompany<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof CompanyCallError) throw new MasterError(e.kind === 'unreachable' ? 'Q3M11' : 'Q3M12')
    if (e instanceof MasterError) throw e
    throw new MasterError('Q3M11')
  }
}

export interface IssuedSeat { seat_no: number; email: string; password: string }

/** `rpc/qt_add_seats` and `rpc/qt_reset_seat` answer a one-row table; read it defensively (a bad shape = Q3M12). */
export function oneIssued(raw: unknown): IssuedSeat {
  const row = Array.isArray(raw) ? raw[0] : raw
  const r = row as Partial<IssuedSeat> | null | undefined
  if (!r || typeof r.seat_no !== 'number' || typeof r.email !== 'string' || typeof r.password !== 'string' || !r.password) {
    throw new MasterError('Q3M12')
  }
  return { seat_no: r.seat_no, email: r.email, password: r.password }
}

/** A fresh seat code and the three stored forms of it (hash of the 16 characters, hint, sealed full text). */
export async function newCode(ctx: Ctx, companyId: string, seatNo: number): Promise<{ code: string; code_hash: string; code_enc: string; code_hint: string }> {
  const code = generateSeatCode(ctx.deps.randomBytes(15))
  return {
    code,
    code_hash: await seatCodeHash(seatCodeChars(code)),
    code_enc: await sealText(ctx.deps.kek, code, aadSeatCode(companyId, seatNo)),
    code_hint: code.slice(-4)
  }
}

export const sealPassword = (ctx: Ctx, companyId: string, seatNo: number, password: string): Promise<string> =>
  sealText(ctx.deps.kek, password, aadSeatPassword(companyId, seatNo))

/** Row -> wire shape. The full code is opened for seat 1 only (these functions are all admin-only); the password never. */
export async function seatView(ctx: Ctx, s: SeatRow, devices: DeviceRow[]): Promise<SeatView> {
  let code: string | null = null
  if (s.status === 'active' && s.code_enc) {
    try {
      code = await openText(ctx.deps.kek, s.code_enc, aadSeatCode(s.company_id, s.seat_no))
    } catch (e) {
      if (e instanceof SealError) throw new MasterError('Q3M99')
      throw e
    }
  }
  const mine = devices.filter((d) => d.seat_no === s.seat_no)
  const seen = mine.map((d) => d.last_seen_at).filter((x): x is string => !!x).sort()
  return {
    no: s.seat_no, label: s.label, email: s.email, status: s.status, legacy: s.legacy, code,
    codeHint: s.status === 'active' ? s.code_hint : null, createdAt: s.created_at, resetAt: s.reset_at,
    devices: mine.length, lastSeenAt: seen.length ? seen[seen.length - 1]! : null
  }
}

/** Seat row + its devices, fresh from the master (after a write). */
export async function freshSeatView(ctx: Ctx, companyId: string, seatNo: number): Promise<SeatView> {
  const s = await ctx.deps.db.findSeat(companyId, seatNo)
  if (!s) throw new MasterError('Q3M99')
  return seatView(ctx, s, await ctx.deps.db.listDevices(companyId))
}

/** A random uuid v4 from 16 bytes (for new company ids). */
export function uuidFromBytes(b: Uint8Array): string {
  const x = Uint8Array.from(b)
  x[6] = (x[6]! & 0x0f) | 0x40
  x[8] = (x[8]! & 0x3f) | 0x80
  const h = Array.from(x, (v) => v.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
