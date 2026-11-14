/** Phase 261 - F12 seat-regen: a NEW code only (the old one dies at once); linked devices and the password are untouched. A legacy seat has no code to regenerate (Q3M21). */
import { freshSeatView, newCode, once, requireAdmin } from '../_shared/admin'
import { MasterError, logAction, parse, runFunction } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SeatRegenRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatRegen(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-regen', async (ctx) => {
    const r = parse(SeatRegenRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-regen')
    const c = a.company
    return once(ctx, a, 'seat-regen', r.reqId, async () => {
      const seat = await deps.db.findSeat(c.id, r.seatNo)
      if (!seat) throw new MasterError('Q3M09')
      if (seat.status !== 'active') throw new MasterError('Q3M07')
      if (seat.legacy || !seat.password_enc) throw new MasterError('Q3M21')
      const code = await newCode(ctx, c.id, r.seatNo)
      await deps.db.updateSeat(c.id, r.seatNo, { code_hash: code.code_hash, code_enc: code.code_enc, code_hint: code.code_hint })
      await logAction(ctx, 'seat-regen.done', 'ok', { company_id: c.id, seat_no: r.seatNo })
      return { seat: await freshSeatView(ctx, c.id, r.seatNo) }
    })
  })
}
