/** Phase 260 - F3 refresh: device token -> the CURRENT credentials of THAT seat only. Read-only (throttled last_seen_at). */
import { aadLicense, aadSeatPassword } from '../_shared/aad'
import { MasterError, logAction, parse, requireActive, requireDevice, runFunction, touchDevice } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { RefreshRequestSchema } from '../../../../src/shared/master/schemas'
import { SealError, openText } from '../../../../src/shared/master/seal'

export function handleRefresh(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'refresh', async (ctx) => {
    parse(RefreshRequestSchema, ctx.body)
    const a = await requireDevice(ctx)
    const who = { company_id: a.company.id, seat_no: a.seat.seat_no }
    try {
      requireActive(a)
    } catch (e) {
      if (e instanceof MasterError) await logAction(ctx, 'refresh', e.code, who)
      throw e
    }
    // A legacy seat (or one without a stored password) is not known to the master: the device types it as today.
    const legacy = a.seat.legacy || !a.seat.password_enc
    let password: string | null = null
    let license: string
    try {
      license = await openText(deps.kek, a.company.license_key_enc, aadLicense(a.company.id))
      if (!legacy && a.seat.password_enc) password = await openText(deps.kek, a.seat.password_enc, aadSeatPassword(a.company.id, a.seat.seat_no))
    } catch (e) {
      if (e instanceof SealError) throw new MasterError('Q3M99')
      throw e
    }
    if (!a.seat.email) throw new MasterError('Q3M99')
    await touchDevice(ctx, a.device)
    await logAction(ctx, 'refresh', 'ok', who)
    return {
      supabaseUrl: a.company.supabase_url, anonKey: a.company.anon_key, license,
      seat: { no: a.seat.seat_no, email: a.seat.email, password }, legacy
    }
  })
}
