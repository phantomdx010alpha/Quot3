/** Phase 279 - the three URL builders and the amount rule (API_CONTRACTS.md M25-2, M25-2b). Matches the original page. */
import Decimal from 'decimal.js'
import type { PayeeAccount, Result } from './types'
import { PAYMENTS_WORDS as W } from './words'

const AMOUNT_RE = /^[0-9]{1,10}(\.[0-9]+)?$/

/** Amount text for `am=`. Empty = the payer enters the amount. Half-up to 2 decimals, no float maths. */
export function amountText(input: string): Result<string> {
  const s = typeof input === 'string' ? input.trim() : ''
  if (s === '') return { ok: true, value: '' }
  if (!AMOUNT_RE.test(s)) return { ok: false, words: W.amountFormat }
  const d = new Decimal(s).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  if (d.isZero()) return { ok: false, words: W.amountZero }
  if (d.isInteger()) return { ok: true, value: d.toFixed(0) }
  const t = d.toFixed(2)
  return { ok: true, value: t.endsWith('0') ? t.slice(0, -1) : t }
}

/** Only `pn` is escaped; every other value is validated to hold no URL-special character. `am` = '' means none. */
export function buildUpiUrl(payee: PayeeAccount, recipient: string, accountMode: boolean, am: string): string | null {
  const pn = encodeURIComponent(recipient)
  if (accountMode) {
    if (!payee.account) return null
    return `upi://pay?pa=${payee.account.number}@${payee.account.ifsc}.ifsc.npci&pn=${pn}${am ? `&am=${am}` : ''}&cu=INR`
  }
  if (payee.kind === 'merchant' && payee.merchant) {
    const m = payee.merchant
    return `upi://pay?ver=${m.ver}&mode=${m.mode}&orgId=${m.orgId}&tid=&tr=${m.tr}&tn=&pa=${m.pa}&pn=${pn}&mc=${m.mc}&am=${am}&mid=${m.mid}&mtid=${m.mtid}&qrMedium=${m.qrMedium}`
  }
  if (payee.kind === 'upi' && payee.upiId) return `upi://pay?pa=${payee.upiId}&pn=${pn}${am ? `&am=${am}` : ''}`
  return null
}
