/**
 * Phase 280 - F15 payments-set: replace the company's Payments list. Needs `editPayments` (seat 1 always). `expectVersion`
 * must equal the stored version (else Q3M24); size > 32768 bytes = Q3M26; content re-validated with `shared/payments` (Q3M25);
 * the version rises by exactly 1 only when the normalised content differs. The list is never logged.
 */
import { once } from '../_shared/admin'
import { MasterError, logAction, parse, requireActive, requireDevice, runFunction } from '../_shared/http'
import { canonical, paymentsView, requireM05, requirePaymentsRight } from '../_shared/payments'
import type { Deps } from '../_shared/types'
import { PaymentsSetRequestSchema } from '../../../../src/shared/master/schemas'
import { MAX_BODY_BYTES, validateBody } from '../../../../src/shared/payments/validate'

export function handlePaymentsSet(req: Request, deps: Deps): Promise<Response> {
  return runFunction(req, deps, 'payments-set', async (ctx) => {
    const r = parse(PaymentsSetRequestSchema, ctx.body)
    const a = await requireDevice(ctx)
    try {
      requireActive(a)
      requireM05(a.company)
    } catch (e) {
      if (e instanceof MasterError) await logAction(ctx, 'payments-set', e.code, { company_id: a.company.id, seat_no: a.seat.seat_no })
      throw e
    }
    await requirePaymentsRight(ctx, a, 'editPayments')
    const fail = async (code: 'Q3M25' | 'Q3M26'): Promise<never> => {
      await logAction(ctx, 'payments-set', code, { company_id: a.company.id, seat_no: a.seat.seat_no })
      throw new MasterError(code)
    }
    if (new TextEncoder().encode(JSON.stringify(r.list)).length > MAX_BODY_BYTES) return fail('Q3M26')
    const v = validateBody(r.list)
    if (!v.ok) return fail('Q3M25')
    return once(ctx, a, 'payments-set', r.reqId, async (changed) => {
      const fresh = await deps.db.findCompanyById(a.company.id)
      if (!fresh) throw new MasterError('Q3M04')
      const { payments, version } = requireM05(fresh)
      if (r.expectVersion !== version) throw new MasterError('Q3M24')
      const old = validateBody(payments)
      if (old.ok && canonical(old.value) === canonical(v.value)) return { payments: paymentsView(fresh) } // same content: the version stays
      changed()
      await deps.db.updateCompany(fresh.id, { payments: v.value as unknown as Record<string, unknown>, payments_version: version + 1 })
      const after = await deps.db.findCompanyById(fresh.id)
      if (!after) throw new MasterError('Q3M99')
      return { payments: paymentsView(after) }
    })
  })
}
