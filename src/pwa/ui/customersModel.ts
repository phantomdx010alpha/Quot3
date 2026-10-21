import { normalizePartyName } from '../../shared/party/partyLite'
import type { CustomerRow } from '../data/partiesRepo'

/** Pure helpers for the Customers pages (Phase 185). */
export const CUSTOMER_PAGE_SIZE = 100

/** Digits only, from whatever the person typed ("+91 98450-12345" -> "919845012345"). */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D+/g, '')
}

/** `tel:` link, or null when there is no usable number (fewer than 5 digits). Keeps a leading + the person typed. */
export function telHref(phone: string): string | null {
  const d = phoneDigits(phone)
  if (d.length < 5) return null
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${d}`
}

/** WhatsApp chat link. A 10-digit number (optionally with a leading 0) gets the India code 91 [A: unconfirmed, the owner's customers are in India]. */
export function whatsappHref(phone: string): string | null {
  let d = phoneDigits(phone)
  if (d.length < 7) return null
  d = d.replace(/^0+/, '')
  if (d.length === 10) d = `91${d}`
  if (d.length < 11 || d.length > 15) return null
  return `https://wa.me/${d}`
}

/** Name contains the typed text (normalised), or the digits typed (3 or more) are inside the phone's digits. Empty query keeps everything. */
export function filterCustomers(rows: readonly CustomerRow[], query: string): CustomerRow[] {
  const q = normalizePartyName(query)
  if (q === '') return [...rows]
  const qd = phoneDigits(query)
  const byDigits = qd.length >= 3 && qd.length >= q.replace(/\s+/g, '').length - 1
  return rows.filter((r) => normalizePartyName(r.name).includes(q) || (byDigits && phoneDigits(r.phone).includes(qd)))
}

export function billCountText(n: number): string {
  return n === 1 ? '1 bill' : `${n} bills`
}
