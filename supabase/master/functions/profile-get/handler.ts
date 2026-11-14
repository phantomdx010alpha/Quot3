/** Phase 260 - F5 profile-get: the company profile (version 0 + the label as name when it was never set). */
import { MasterError, logAction, parse, requireActive, requireDevice, runFunction, touchDevice } from '../_shared/http'
import { profileView } from '../_shared/views'
import type { Deps } from '../_shared/types'
import { ProfileGetRequestSchema } from '../../../../src/shared/master/schemas'

export function handleProfileGet(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'profile-get', async (ctx) => {
    parse(ProfileGetRequestSchema, ctx.body)
    const a = await requireDevice(ctx)
    try {
      requireActive(a)
    } catch (e) {
      if (e instanceof MasterError) await logAction(ctx, 'profile-get', e.code, { company_id: a.company.id, seat_no: a.seat.seat_no })
      throw e
    }
    await touchDevice(ctx, a.device)
    return { profile: profileView(a.company) }
  })
}
