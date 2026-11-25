/** Phase 279 - list operations (API_CONTRACTS.md M25-1). All pure; each returns a new list; `version` is never bumped here. */
import type { PayeeAccount, PaymentsBody, PaymentsList, Result } from './types'
import { seedList } from './seed'
import { MAX_PAYEES, MAX_BODY_BYTES, bodyBytes, validatePayee, validateRecipient } from './validate'
import { PAYMENTS_WORDS as W } from './words'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
type Op = Result<PaymentsList>
const fail = (words: string): Op => ({ ok: false, words })

/** New payee id: 'p' + 10 random [a-z0-9]. `rng` is injectable for tests. */
export function newPayeeId(rng: () => number = Math.random): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'p'
  for (let i = 0; i < 10; i++) s += a[Math.min(35, Math.floor(rng() * 36))]
  return s
}

/** Never throws. Non-objects become the seed; bad payees are dropped (not repaired); empty becomes the seed. */
export function normalizeList(raw: unknown): PaymentsList {
  if (!isObj(raw)) return seedList()
  const seed = seedList()
  const rec = validateRecipient(own(raw, 'recipient'))
  const src = own(raw, 'accounts')
  const accounts: PayeeAccount[] = []
  const ids = new Set<string>()
  if (Array.isArray(src)) {
    for (const item of src) {
      if (accounts.length >= MAX_PAYEES) break
      const p = validatePayee(item, accounts.map((a) => a.name))
      if (p.ok && !ids.has(p.value.id)) { ids.add(p.value.id); accounts.push(p.value) }
    }
  }
  if (accounts.length === 0) return { ...seed, version: versionOf(raw) }
  const wanted = typeof own(raw, 'defaultId') === 'string' ? (own(raw, 'defaultId') as string).trim() : ''
  const out: PaymentsList = {
    recipient: rec.ok ? rec.value : seed.recipient,
    defaultId: ids.has(wanted) ? wanted : accounts[0]!.id,
    accounts,
    version: versionOf(raw)
  }
  return bodyBytes(out) > MAX_BODY_BYTES ? { ...seed, version: out.version } : out
}

function versionOf(raw: Record<string, unknown>): number {
  const v = own(raw, 'version')
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0
}

const done = (list: PaymentsList): Op => (bodyBytes(list) > MAX_BODY_BYTES ? fail(W.tooBig) : { ok: true, value: list })

/** `payee.id` may be empty / missing: a new id is made. */
export function addPayee(list: PaymentsList, payee: unknown, rng?: () => number): Op {
  if (list.accounts.length >= MAX_PAYEES) return fail(W.count)
  const withId = isObj(payee) && !String(own(payee, 'id') ?? '').trim() ? { ...payee, id: newPayeeId(rng) } : payee
  const p = validatePayee(withId, list.accounts.map((a) => a.name))
  if (!p.ok) return p
  if (list.accounts.some((a) => a.id === p.value.id)) return fail(W.missing)
  return done({ ...list, accounts: [...list.accounts, p.value] })
}

/** Replaces the payee with `id`; the id cannot change. */
export function editPayee(list: PaymentsList, id: string, payee: unknown): Op {
  const i = list.accounts.findIndex((a) => a.id === id)
  if (i < 0) return fail(W.notFound)
  const p = validatePayee(isObj(payee) ? { ...payee, id } : payee, list.accounts.filter((a) => a.id !== id).map((a) => a.name))
  if (!p.ok) return p
  const accounts = list.accounts.slice()
  accounts[i] = p.value
  return done({ ...list, accounts })
}

export function removePayee(list: PaymentsList, id: string): Op {
  if (!list.accounts.some((a) => a.id === id)) return fail(W.notFound)
  if (list.accounts.length <= 1) return fail(W.lastPayee)
  const accounts = list.accounts.filter((a) => a.id !== id)
  return { ok: true, value: { ...list, accounts, defaultId: list.defaultId === id ? accounts[0]!.id : list.defaultId } }
}

export function movePayee(list: PaymentsList, id: string, toIndex: number): Op {
  const from = list.accounts.findIndex((a) => a.id === id)
  if (from < 0) return fail(W.notFound)
  const to = Math.max(0, Math.min(list.accounts.length - 1, Number.isFinite(toIndex) ? Math.trunc(toIndex) : from))
  const accounts = list.accounts.slice()
  const [item] = accounts.splice(from, 1)
  accounts.splice(to, 0, item!)
  return { ok: true, value: { ...list, accounts } }
}

export function setDefault(list: PaymentsList, id: string): Op {
  return list.accounts.some((a) => a.id === id) ? { ok: true, value: { ...list, defaultId: id } } : fail(W.notFound)
}

export function setRecipient(list: PaymentsList, recipient: string): Op {
  const r = validateRecipient(recipient)
  return r.ok ? done({ ...list, recipient: r.value }) : r
}

/** UPI-ID mode shows merchant + upi; bank-account mode shows every payee that has an account. */
export function visiblePayees(list: PaymentsBody, accountMode: boolean): PayeeAccount[] {
  return list.accounts.filter((a) => (accountMode ? a.account !== undefined : a.kind === 'merchant' || a.kind === 'upi'))
}

/** The switch is shown only when at least one payee has a bank account. */
export const hasAccountMode = (list: PaymentsBody): boolean => list.accounts.some((a) => a.account !== undefined)

/** Remembered payee if visible, else the default if visible, else the first visible; null when nothing is visible. */
export function pickPayee(list: PaymentsBody, accountMode: boolean, lastPayeeId: string | null): PayeeAccount | null {
  const vis = visiblePayees(list, accountMode)
  return vis.find((a) => a.id === lastPayeeId) ?? vis.find((a) => a.id === list.defaultId) ?? vis[0] ?? null
}
