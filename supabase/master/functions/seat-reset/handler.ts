/** Phase 261 - F9 seat-reset: new password (`qt_reset_seat`, the login's sessions end) AND new code (the old code dies). Seat 1 is refused. */
import { callCompany, companyKey, freshSeatView, newCode, oneIssued, once, requireAdmin, sealPassword } from '../_shared/admin'
import { MasterError, logAction, parse, runFunction } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SeatResetRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatReset(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-reset', async (ctx) => {
    const r = parse(SeatResetRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-reset')
    const c = a.company
    if (r.seatNo === 1) {
      await logAction(ctx, 'seat-reset', 'Q3M10', { company_id: c.id, seat_no: 1 })
      throw new MasterError('Q3M10')
    }
    return once(ctx, a, 'seat-reset', r.reqId, async (changed) => {
      const seat = await deps.db.findSeat(c.id, r.seatNo)
      if (!seat) throw new MasterError('Q3M09')
      if (seat.status !== 'active') throw new MasterError('Q3M07')
      const key = await companyKey(ctx, c)
      const issued = oneIssued(await callCompany(() => deps.company.adminRpc(c, key, 'qt_reset_seat', { p_label: c.label, p_seat_no: r.seatNo })))
      changed()
      const code = await newCode(ctx, c.id, r.seatNo)
      await deps.db.updateSeat(c.id, r.seatNo, {
        password_enc: await sealPassword(ctx, c.id, r.seatNo, issued.password),
        code_hash: code.code_hash, code_enc: code.code_enc, code_hint: code.code_hint,
        email: seat.email ?? issued.email, legacy: false, reset_at: deps.now().toISOString()
      })
      await logAction(ctx, 'seat-reset.done', 'ok', { company_id: c.id, seat_no: r.seatNo })
      return { seat: await freshSeatView(ctx, c.id, r.seatNo) }
    })
  })
}
