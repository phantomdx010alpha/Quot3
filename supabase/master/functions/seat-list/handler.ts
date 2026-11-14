/** Phase 261 - F7 seat-list: every seat of the company (revoked included), with its code, for seat 1 only. Read-only. */
import { requireAdmin, seatView } from '../_shared/admin'
import { logAction, parse, runFunction, touchDevice } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SeatListRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatList(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-list', async (ctx) => {
    parse(SeatListRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-list')
    const [seats, devices] = await Promise.all([deps.db.listSeats(a.company.id), deps.db.listDevices(a.company.id)])
    const views = []
    for (const s of [...seats].sort((x, y) => x.seat_no - y.seat_no)) views.push(await seatView(ctx, s, devices))
    await touchDevice(ctx, a.device)
    await logAction(ctx, 'seat-list', 'ok', { company_id: a.company.id, seat_no: 1 })
    return { company: { id: a.company.id, label: a.company.label, maxSeats: a.company.max_seats, status: a.company.status }, seats: views }
  })
}
