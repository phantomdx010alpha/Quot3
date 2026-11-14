/** Phase 260 - F1 redeem: seat code -> bundle + a NEW device row. The code stays valid (reusable until reset / regen). */
import { aadLicense, aadSeatPassword } from '../_shared/aad'
import { MasterError, checkRate, logAction, newDeviceToken, noteAttempt, parse, runFunction } from '../_shared/http'
import { profileView } from '../_shared/views'
import type { Deps } from '../_shared/types'
import { BundleSchema, RedeemRequestSchema } from '../../../../src/shared/master/schemas'
import { SealError, openText, seatCodeHash } from '../../../../src/shared/master/seal'
import { validateSeatCode } from '../../../../src/shared/master/seatCode'

export function handleRedeem(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'redeem', async (ctx) => {
    await checkRate(ctx)
    const r = parse(RedeemRequestSchema, ctx.body)
    const v = validateSeatCode(r.code)
    const hit = v.ok ? await deps.db.findSeatByCodeHash(await seatCodeHash(v.chars)) : null
    // Wrong, malformed, revoked, expired and regenerated codes all end here with the IDENTICAL Q3M01 body.
    if (!hit || hit.seat.status !== 'active' || hit.seat.legacy || !hit.seat.password_enc || !hit.seat.email) {
      await noteAttempt(ctx, false)
      await logAction(ctx, 'redeem', 'Q3M01')
      throw new MasterError('Q3M01')
    }
    const { seat, company } = hit
    const passwordEnc = seat.password_enc
    const email = seat.email
    if (!passwordEnc || !email) throw new MasterError('Q3M01')
    const who = { company_id: company.id, seat_no: seat.seat_no }
    if (company.status !== 'active') {
      await logAction(ctx, 'redeem', 'Q3M06', who)
      throw new MasterError('Q3M06')
    }
    let password: string
    let license: string
    try {
      password = await openText(deps.kek, passwordEnc, aadSeatPassword(company.id, seat.seat_no))
      license = await openText(deps.kek, company.license_key_enc, aadLicense(company.id))
    } catch (e) {
      if (e instanceof SealError) throw new MasterError('Q3M99')
      throw e
    }
    const { token, hash } = await newDeviceToken(deps)
    await deps.db.insertDevice({
      company_id: company.id, seat_no: seat.seat_no, token_hash: hash, label: (r.deviceLabel ?? '').slice(0, 40),
      platform: r.platform, app_version: r.appVersion.slice(0, 40)
    })
    const bundle = BundleSchema.safeParse({
      v: 1, company: { id: company.id, label: company.label }, supabaseUrl: company.supabase_url, anonKey: company.anon_key,
      license, seat: { no: seat.seat_no, email, password }, profile: profileView(company), deviceToken: token
    })
    if (!bundle.success) throw new MasterError('Q3M99')
    await noteAttempt(ctx, true)
    await logAction(ctx, 'redeem', 'ok', who)
    return { bundle: bundle.data }
  })
}
