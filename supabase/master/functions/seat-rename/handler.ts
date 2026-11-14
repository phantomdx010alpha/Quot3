/** Phase 261 - F11 seat-rename: master-only (the company project has no seat label); naturally idempotent; seat 1 may be renamed. */
import { freshSeatView, requireAdmin } from '../_shared/admin'
import { MasterError, logAction, parse, runFunction } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SeatRenameRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatRename(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-rename', async (ctx) => {
    const r = parse(SeatRenameRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-rename')
    const seat = await deps.db.findSeat(a.company.id, r.seatNo)
    if (!seat) {
      await logAction(ctx, 'seat-rename', 'Q3M09', { company_id: a.company.id, seat_no: 1 })
      throw new MasterError('Q3M09')
    }
    if (seat.label !== r.label) await deps.db.updateSeat(a.company.id, r.seatNo, { label: r.label })
    await logAction(ctx, 'seat-rename', 'ok', { company_id: a.company.id, seat_no: r.seatNo })
    return { seat: await freshSeatView(ctx, a.company.id, r.seatNo) }
  })
}
