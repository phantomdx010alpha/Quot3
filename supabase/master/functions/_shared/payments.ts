/**
 * Phase 280 - what `payments-get` / `payments-set` share (API_CONTRACTS.md M25-3): the stored list as a wire view, the
 * "is M05 there" check (Q3M27) and the per-seat right check. The right is read from the COMPANY project with the sealed
 * service_role key on every call (no cache). Nothing here logs a list, UPI id, IFSC or account number.
 */
import type { PaymentsBody } from '../../../../src/shared/payments/types'
import type { PaymentsView } from '../../../../src/shared/master/schemas'
import { MasterError, logAction, type Ctx, type DeviceAuth } from './http'
import { callCompany, companyKey } from './admin'
import type { CompanyRow } from './types'

/** Q3M27 when `M05_payments.sql` has not been run (the columns are absent from the row). */
export function requireM05(c: CompanyRow): { payments: Record<string, unknown>; version: number } {
  if (c.payments === undefined || c.payments === null || typeof c.payments_version !== 'number') throw new MasterError('Q3M27')
  return { payments: c.payments, version: c.payments_version }
}

/** The stored list as the wire view. `{}` (never set) -> `list: null`. */
export function paymentsView(c: CompanyRow, unchanged = false): PaymentsView {
  const { payments, version } = requireM05(c)
  const has = Array.isArray((payments as { accounts?: unknown }).accounts)
  return { version, unchanged: unchanged && has, list: unchanged ? null : has ? (payments as unknown as PaymentsBody) : null }
}

export type PaymentsRight = 'seePayments' | 'editPayments'

/**
 * Seat 1 always may. Another seat: its `sn_seat_rights` row decides; no row = Staff preset (both false); the table missing
 * (company SQL 23 not run, HTTP 404) = get allowed and set refused (seat 1 only) [A, M25-12 #3]; company unreachable / refusing = Q3M11 / Q3M12.
 */
export async function requirePaymentsRight(ctx: Ctx, a: DeviceAuth, right: PaymentsRight): Promise<void> {
  if (a.seat.seat_no === 1) return
  const refuse = right === 'seePayments' ? 'Q3M22' : 'Q3M23'
  const who = { company_id: a.company.id, seat_no: a.seat.seat_no }
  try {
    const key = await companyKey(ctx, a.company)
    const path = `sn_seat_rights?select=flags&org_id=eq.${encodeURIComponent(a.company.org_id)}&seat_no=eq.${a.seat.seat_no}`
    let rows: unknown[]
    try {
      rows = await ctx.deps.company.adminSelect(a.company, key, path)
    } catch (e) {
      if ((e as { kind?: string; status?: number }).kind === 'refused' && (e as { status?: number }).status === 404) {
        if (right === 'seePayments') return // an old company project never locks the phones
        throw new MasterError(refuse)
      }
      return await callCompany(() => Promise.reject(e))
    }
    const flags = (rows[0] as { flags?: Record<string, unknown> } | undefined)?.flags
    if (!flags || typeof flags !== 'object' || (flags as Record<string, unknown>)[right] !== true) throw new MasterError(refuse)
  } catch (e) {
    if (e instanceof MasterError) await logAction(ctx, right === 'seePayments' ? 'payments-get' : 'payments-set', e.code, who)
    throw e
  }
}

/** Key-order independent text of a payments body, to tell "changed" from "same content". */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}
