/**
 * Phase 260 - F2 adopt: a device that already signs in to the company project gets a device token. The master verifies
 * the session at the COMPANY project, maps it to a seat and never reads or changes any password.
 */
import { MasterError, checkRate, logAction, newDeviceToken, noteAttempt, normaliseUrl, parse, runFunction, touchDevice } from '../_shared/http'
import { profileView } from '../_shared/views'
import type { Deps } from '../_shared/types'
import { AdoptRequestSchema } from '../../../../src/shared/master/schemas'
import { sha256Hex } from '../../../../src/shared/master/seal'

export function handleAdopt(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'adopt', async (ctx) => {
    await checkRate(ctx)
    const r = parse(AdoptRequestSchema, ctx.body)
    const fail = async (code: 'Q3M14' | 'Q3M15' | 'Q3M06' | 'Q3M07', who: { company_id?: string; seat_no?: number } = {}): Promise<never> => {
      if (code === 'Q3M14' || code === 'Q3M15') await noteAttempt(ctx, false)
      await logAction(ctx, 'adopt', code, who)
      throw new MasterError(code)
    }
    const company = await deps.db.findCompanyByUrl(normaliseUrl(r.supabaseUrl))
    if (!company) return fail('Q3M15')
    if (company.status !== 'active') return fail('Q3M06', { company_id: company.id })

    const user = await deps.company.getUser(company, r.accessToken)
    if (!user) return fail('Q3M14', { company_id: company.id })

    let seat = await deps.db.findSeatByAuthUser(company.id, user.id)
    if (!seat && user.email) {
      // A legacy row recorded without its auth id: match by e-mail, then fill both columns.
      seat = await deps.db.findSeatByEmail(company.id, user.email)
      if (seat) await deps.db.updateSeat(company.id, seat.seat_no, { auth_user_id: user.id, email: seat.email ?? user.email })
    } else if (seat && !seat.email && user.email) {
      await deps.db.updateSeat(company.id, seat.seat_no, { email: user.email }) // legacy seat: e-mail filled at first adopt
    }
    if (!seat) return fail('Q3M14', { company_id: company.id })
    const who = { company_id: company.id, seat_no: seat.seat_no }
    if (seat.status !== 'active') return fail('Q3M07', who)

    const profile = profileView(company)
    const base = { company: { id: company.id, label: company.label }, seat: { no: seat.seat_no, label: seat.label }, profile }

    // A valid device token of the SAME seat: nothing new is made.
    const header = ctx.req.headers.get('x-q3-device')?.trim()
    if (header) {
      const dev = await deps.db.findDeviceByTokenHash(await sha256Hex(header))
      if (dev && dev.company_id === company.id && dev.seat_no === seat.seat_no) {
        await touchDevice(ctx, dev)
        await logAction(ctx, 'adopt', 'ok', who)
        return { deviceToken: null, existing: true, ...base }
      }
    }
    const { token, hash } = await newDeviceToken(deps)
    await deps.db.insertDevice({
      company_id: company.id, seat_no: seat.seat_no, token_hash: hash, label: (r.deviceLabel ?? '').slice(0, 40),
      platform: r.platform, app_version: r.appVersion.slice(0, 40)
    })
    await noteAttempt(ctx, true)
    await logAction(ctx, 'adopt', 'ok', who)
    return { deviceToken: token, existing: false, ...base }
  })
}
