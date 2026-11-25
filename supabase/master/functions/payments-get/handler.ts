/** Phase 280 - F14 payments-get: the company's Payments list (or `unchanged`). Needs `seePayments` (seat 1 always). Read-only. */
import { MasterError, logAction, parse, requireActive, requireDevice, runFunction, touchDevice } from '../_shared/http'
import { paymentsView, requireM05, requirePaymentsRight } from '../_shared/payments'
import type { Deps } from '../_shared/types'
import { PaymentsGetRequestSchema } from '../../../../src/shared/master/schemas'

export function handlePaymentsGet(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'payments-get', async (ctx) => {
    const r = parse(PaymentsGetRequestSchema, ctx.body)
    const a = await requireDevice(ctx)
    try {
      requireActive(a)
      requireM05(a.company)
    } catch (e) {
      if (e instanceof MasterError) await logAction(ctx, 'payments-get', e.code, { company_id: a.company.id, seat_no: a.seat.seat_no })
      throw e
    }
    await requirePaymentsRight(ctx, a, 'seePayments')
    await touchDevice(ctx, a.device)
    return { payments: paymentsView(a.company, r.knownVersion !== undefined && r.knownVersion === a.company.payments_version) }
  })
}
