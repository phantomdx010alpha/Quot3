import { toMoney, tryD, sum } from '../money'
import { createPartyIndex } from '../party/fuzzy'
import { normalizePartyName } from '../party/partyLite'
import { PARTY_FIELD_MAX } from '../partyFields'
import type { Decimal } from 'decimal.js'

/** Phase 45 - pure helpers behind the Customers page (stats, search, validation). No DOM, no Electron. */

export interface CustomerRow {
  id: string
  name: string
  phone: string
  address: string
  transport: string
  /** Live (non-trashed) bills linked to this customer. */
  billCount: number
  /** `YYYY-MM-DD` of the newest live bill; '' when there is none. */
  lastBillDate: string
  /** Canonical 2-dp decimal string, sum of the live bills' grand totals ('0.00' when none). */
  totalBilled: string
}

export interface CustomerInput { name: string; phone?: string; address?: string; transport?: string }

export const CUSTOMER_FIELDS = ['name', 'phone', 'address', 'transport'] as const
export type CustomerField = (typeof CUSTOMER_FIELDS)[number]
export const CUSTOMER_FIELD_LABEL: Readonly<Record<CustomerField, string>> = { name: 'Name', phone: 'Phone', address: 'Address', transport: 'Transport' }

export interface BillStatRow { partyId: string; billDate: string; grandTotal: string | number | null }
export interface CustomerStats { billCount: number; lastBillDate: string; totalBilled: string }

/**
 * Per-party bill count / newest date / total. Money is summed with decimal.js, never with JS numbers; a bill whose cached
 * total is unreadable still counts as a bill but adds nothing to the total.
 */
export function aggregateCustomerStats(rows: readonly BillStatRow[]): Map<string, CustomerStats> {
  const acc = new Map<string, { count: number; last: string; totals: Decimal[] }>()
  for (const r of rows) {
    const a = acc.get(r.partyId) ?? { count: 0, last: '', totals: [] }
    a.count++
    if (r.billDate > a.last) a.last = r.billDate
    const d = r.grandTotal === null ? null : tryD(String(r.grandTotal))
    if (d !== null) a.totals.push(d)
    acc.set(r.partyId, a)
  }
  const out = new Map<string, CustomerStats>()
  for (const [id, a] of acc) out.set(id, { billCount: a.count, lastBillDate: a.last, totalBilled: toMoney(sum(a.totals)) })
  return out
}

/** The address as one line for the list ("12 Main Rd, Mysuru"). */
export function addressPreview(address: string): string {
  return address.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').join(', ')
}

/**
 * Search the loaded customers: name and phone through the Phase 26 party index (exact, prefix, word-prefix, fuzzy; a numeric
 * query is a phone-digit search), plus any customer whose address contains the text. Blank query = everyone, in the given order.
 */
export function searchCustomers(rows: readonly CustomerRow[], query: string): CustomerRow[] {
  const q = normalizePartyName(query)
  if (q === '') return [...rows]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const hits: CustomerRow[] = []
  const seen = new Set<string>()
  for (const p of createPartyIndex(rows).search(q, rows.length)) {
    const r = byId.get(p.id)
    if (r && !seen.has(r.id)) { seen.add(r.id); hits.push(r) }
  }
  const more = rows.filter((r) => !seen.has(r.id) && normalizePartyName(r.address).includes(q))
  return [...hits, ...more]
}

/** Trim / collapse what was typed; the returned message (or null) is what the editor shows. */
export function validateCustomerInput(input: CustomerInput): string | null {
  if (normalizePartyName(input.name) === '') return 'A customer needs a name'
  if (input.name.length > PARTY_FIELD_MAX.name) return `The name is too long (max ${PARTY_FIELD_MAX.name} characters)`
  if ((input.phone ?? '').length > PARTY_FIELD_MAX.phone) return `The phone is too long (max ${PARTY_FIELD_MAX.phone} characters)`
  if ((input.transport ?? '').length > PARTY_FIELD_MAX.transport) return `The transport is too long (max ${PARTY_FIELD_MAX.transport} characters)`
  if ((input.address ?? '').length > PARTY_FIELD_MAX.address) return `The address is too long (max ${PARTY_FIELD_MAX.address} characters)`
  return null
}

/** Footer line: "12 customers" / "3 of 12 customers" while a search is active. */
export function describeCustomers(shown: number, total: number): string {
  const noun = total === 1 ? 'customer' : 'customers'
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`
}
