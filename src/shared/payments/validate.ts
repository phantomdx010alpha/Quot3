/** Phase 279 - validation (API_CONTRACTS.md M25-1). Never throws. Unknown keys are dropped, text is trimmed. */
import type { BankAccount, MerchantFields, PayeeAccount, PayeeKind, PaymentsBody, Result } from './types'
import { PAYMENTS_WORDS as W } from './words'

export const MAX_PAYEES = 20 // [A]
export const MAX_BODY_BYTES = 32768
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const UPI_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,40}$/
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACC_RE = /^[0-9]{9,18}$/
const TWO_RE = /^[0-9]{2}$/
const ORG_RE = /^[0-9]{1,10}$/
const MC_RE = /^[0-9]{4}$/
const ALNUM_RE = /^[A-Za-z0-9]{1,35}$/
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const KINDS: readonly string[] = ['merchant', 'upi', 'account']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export function validateRecipient(raw: unknown): Result<string> {
  const s = str(raw)
  if (s.length < 1 || s.length > 60 || CONTROL.test(s)) return { ok: false, words: W.recipient }
  return { ok: true, value: s }
}

export function validateUpiId(raw: unknown): Result<string> {
  const s = str(raw)
  return UPI_RE.test(s) ? { ok: true, value: s } : { ok: false, words: W.upiId }
}

export function validateAccount(raw: unknown): Result<BankAccount> {
  const o = isObj(raw) ? raw : {}
  const ifsc = str(own(o, 'ifsc')).toUpperCase()
  if (!IFSC_RE.test(ifsc)) return { ok: false, words: W.ifsc }
  const number = str(own(o, 'number'))
  if (!ACC_RE.test(number)) return { ok: false, words: W.accountNumber }
  return { ok: true, value: { number, ifsc } }
}

export function validateMerchant(raw: unknown): Result<MerchantFields> {
  if (!isObj(raw)) return { ok: false, words: W.missing }
  const g = (k: string): string => str(own(raw, k))
  const pa = validateUpiId(g('pa'))
  if (!pa.ok) return pa
  for (const k of ['ver', 'mode', 'qrMedium']) if (!TWO_RE.test(g(k))) return { ok: false, words: W.twoDigits }
  if (!ORG_RE.test(g('orgId'))) return { ok: false, words: W.orgId }
  if (!MC_RE.test(g('mc'))) return { ok: false, words: W.mc }
  for (const k of ['tr', 'mid', 'mtid']) if (!ALNUM_RE.test(g(k))) return { ok: false, words: W.alnum }
  return {
    ok: true,
    value: { pa: pa.value, ver: g('ver'), mode: g('mode'), orgId: g('orgId'), tr: g('tr'), mid: g('mid'), mtid: g('mtid'), mc: g('mc'), qrMedium: g('qrMedium') }
  }
}

/**
 * Validate one payee. `others` are the names of the OTHER payees (for the unique-name rule).
 * Order: name, then the kind's fields, then the optional account. Returns a clean copy with unknown keys dropped.
 */
export function validatePayee(raw: unknown, others: readonly string[] = []): Result<PayeeAccount> {
  if (!isObj(raw)) return { ok: false, words: W.missing }
  const name = str(own(raw, 'name'))
  if (name.length < 1 || name.length > 40 || CONTROL.test(name) || others.some((n) => sameName(n, name))) return { ok: false, words: W.name }
  const kind = own(raw, 'kind')
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return { ok: false, words: W.missing }
  const id = str(own(raw, 'id'))
  if (!ID_RE.test(id)) return { ok: false, words: W.missing }
  const out: PayeeAccount = { id, name, kind: kind as PayeeKind }
  const rawAcc = own(raw, 'account')
  if (kind === 'merchant') {
    if (own(raw, 'merchant') === undefined) return { ok: false, words: W.missing }
    const m = validateMerchant(own(raw, 'merchant'))
    if (!m.ok) return m
    out.merchant = m.value
  } else if (kind === 'upi') {
    if (own(raw, 'upiId') === undefined) return { ok: false, words: W.missing }
    const u = validateUpiId(own(raw, 'upiId'))
    if (!u.ok) return u
    out.upiId = u.value
  } else if (rawAcc === undefined) {
    return { ok: false, words: W.missing }
  }
  if (rawAcc !== undefined) {
    const a = validateAccount(rawAcc)
    if (!a.ok) return a
    out.account = a.value
  }
  return { ok: true, value: out }
}

/** Validate a whole body (strict: the first failing payee reports its words). Includes count, unique ids and size. */
export function validateBody(raw: unknown): Result<PaymentsBody> {
  if (!isObj(raw)) return { ok: false, words: W.missing }
  const rec = validateRecipient(own(raw, 'recipient'))
  if (!rec.ok) return rec
  const list = own(raw, 'accounts')
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PAYEES) return { ok: false, words: W.count }
  const accounts: PayeeAccount[] = []
  const ids = new Set<string>()
  for (const item of list) {
    const p = validatePayee(item, accounts.map((a) => a.name))
    if (!p.ok) return p
    if (ids.has(p.value.id)) return { ok: false, words: W.missing }
    ids.add(p.value.id)
    accounts.push(p.value)
  }
  const wanted = str(own(raw, 'defaultId'))
  const body: PaymentsBody = { recipient: rec.value, defaultId: ids.has(wanted) ? wanted : accounts[0]!.id, accounts }
  if (bodyBytes(body) > MAX_BODY_BYTES) return { ok: false, words: W.tooBig }
  return { ok: true, value: body }
}

/** UTF-8 byte length of the JSON text. */
export function bodyBytes(body: PaymentsBody): number {
  const s = JSON.stringify(body)
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ }
    else n += 3
  }
  return n
}
