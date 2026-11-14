/** Phase 261 - F10 seat-revoke: `qt_revoke_seat` deletes the login; the master drops the code and password, keeps the devices (they get Q3M07). Seat 1 is refused; revoking again is ok. */
import { callCompany, companyKey, freshSeatView, once, requireAdmin } from '../_shared/admin'
import { MasterError, logAction, parse, runFunction } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SeatRevokeRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatRevoke(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-revoke', async (ctx) => {
    const r = parse(SeatRevokeRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-revoke')
    const c = a.company
    if (r.seatNo === 1) {
      await logAction(ctx, 'seat-revoke', 'Q3M10', { company_id: c.id, seat_no: 1 })
      throw new MasterError('Q3M10')
    }
    return once(ctx, a, 'seat-revoke', r.reqId, async (changed) => {
      const seat = await deps.db.findSeat(c.id, r.seatNo)
      if (!seat) throw new MasterError('Q3M09')
      if (seat.status === 'revoked') return { seat: await freshSeatView(ctx, c.id, r.seatNo) } // already removed: ok again
      const key = await companyKey(ctx, c)
      await callCompany(() => deps.company.adminRpc(c, key, 'qt_revoke_seat', { p_label: c.label, p_seat_no: r.seatNo }))
      changed()
      await deps.db.updateSeat(c.id, r.seatNo, { status: 'revoked', code_hash: null, code_enc: null, code_hint: null, password_enc: null })
      await logAction(ctx, 'seat-revoke.done', 'ok', { company_id: c.id, seat_no: r.seatNo })
      return { seat: await freshSeatView(ctx, c.id, r.seatNo) }
    })
  })
}
