/**
 * Phase 261 - F8 seat-create (D3): count active seats < max_seats, `qt_add_seats(label, 1)` on the company with the sealed
 * service_role key, a returned number > 15 is undone with `qt_revoke_seat` (Q3M08), seal the password, make a code, write
 * the master row ONLY after the company call worked.
 */
import { callCompany, companyKey, freshSeatView, newCode, oneIssued, once, requireAdmin, sealPassword } from '../_shared/admin'
import { MasterError, logAction, parse, runFunction } from '../_shared/http'
import type { Deps } from '../_shared/types'
import { SEATS_MAX, SeatCreateRequestSchema } from '../../../../src/shared/master/schemas'

export function handleSeatCreate(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'seat-create', async (ctx) => {
    const r = parse(SeatCreateRequestSchema, ctx.body)
    const a = await requireAdmin(ctx, 'seat-create')
    const c = a.company
    return once(ctx, a, 'seat-create', r.reqId, async (changed) => {
      const seats = await deps.db.listSeats(c.id)
      if (seats.filter((s) => s.status === 'active').length >= c.max_seats) throw new MasterError('Q3M08')
      const key = await companyKey(ctx, c)
      const issued = oneIssued(await callCompany(() => deps.company.adminRpc(c, key, 'qt_add_seats', { p_label: c.label, p_n: 1 })))
      if (issued.seat_no > SEATS_MAX) {
        // The company numbered it past 15: undo it there. If the undo fails the company still holds the login: tell the owner.
        try {
          await callCompany(() => deps.company.adminRpc(c, key, 'qt_revoke_seat', { p_label: c.label, p_seat_no: issued.seat_no }))
        } catch (e) {
          changed()
          throw e
        }
        throw new MasterError('Q3M08')
      }
      changed()
      const existing = seats.find((s) => s.seat_no === issued.seat_no)
      if (existing && existing.status === 'active') throw new MasterError('Q3M99') // the master and the company disagree
      if (existing) await deps.db.deleteDevicesOfSeat(c.id, issued.seat_no) // a revoked row is replaced: its old devices must not follow
      const code = await newCode(ctx, c.id, issued.seat_no)
      await deps.db.upsertSeat({
        company_id: c.id, seat_no: issued.seat_no, label: r.label, email: issued.email, auth_user_id: null,
        password_enc: await sealPassword(ctx, c.id, issued.seat_no, issued.password),
        code_hash: code.code_hash, code_enc: code.code_enc, code_hint: code.code_hint,
        legacy: false, status: 'active', created_at: deps.now().toISOString(), reset_at: null
      })
      await logAction(ctx, 'seat-create.done', 'ok', { company_id: c.id, seat_no: issued.seat_no })
      return { seat: await freshSeatView(ctx, c.id, issued.seat_no) }
    })
  })
}
