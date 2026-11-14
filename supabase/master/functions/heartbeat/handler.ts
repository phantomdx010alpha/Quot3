/**
 * Phase 260 - F4 heartbeat: profile version + seat / company status. A removed seat or a switched-off company is reported
 * as a STATUS here, never as an error (D7), so the client can show the right words.
 */
import { parse, requireDevice, runFunction, touchDevice } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { HeartbeatRequestSchema } from '../../../../src/shared/master/schemas'

export function handleHeartbeat(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'heartbeat', async (ctx) => {
    const r = parse(HeartbeatRequestSchema, ctx.body)
    const a = await requireDevice(ctx)
    await touchDevice(ctx, a.device)
    const version = a.company.profile_version
    const profileChanged = r.profileVersion === null ? version > 0 : r.profileVersion !== version
    return {
      profileVersion: version, profileChanged,
      seat: { no: a.seat.seat_no, label: a.seat.label, status: a.seat.status },
      company: { status: a.company.status }, serverTime: deps.now().toISOString()
    }
  })
}
