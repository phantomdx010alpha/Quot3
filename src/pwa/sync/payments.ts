/**
 * Phase 281 (M25-3 "Phone sync behaviour") - keeps the phone's Payments list in step with the master. NO UI.
 * `refresh`: fetch on start (forced), after each sync cycle, on a manual refresh and before a publish; throttled to once per 5 minutes
 * unless forced; sends `knownVersion`; a newer answer replaces the stored list, an older or equal one is ignored; offline keeps the last list.
 * `publish`: always keeps the edit on the phone first, then `payments-set` with `expectVersion` = the stored version. Q3M24 adopts the master's
 * list; Q3M23 keeps the edit marked unpublished. Never throws. Nothing is logged here (the master client logs function + outcome only).
 */
import { masterErrorWords, type MasterErrorCode } from '../../shared/master/errors'
import type { PaymentsView } from '../../shared/master/schemas'
import { normalizeList } from '../../shared/payments/list'
import type { PaymentsList } from '../../shared/payments/types'
import { dropPayments, readPayments, writePayments } from '../data/paymentsRepo'
import { getSeatRightsSnapshot } from '../data/seatRights'
import type { PhoneDb } from '../data/db'
import { PhoneMasterError, type PhoneMasterClient } from './master'
import type { SessionVault } from './session'

/** One master call per this many ms unless forced [A]. */
export const PAYMENTS_REFRESH_GAP_MS = 5 * 60_000
export const PAYMENTS_LOCAL_ONLY_WORDS = 'Saved on this phone only. It is not shared with other phones.'

export type PaymentsRefreshResult = 'updated' | 'same' | 'skipped' | 'refused' | 'failed'
export type PaymentsPublishResult =
  | { ok: true; version: number }
  | { ok: false; code: MasterErrorCode | 'LOCAL'; words: string; /** The edit is kept on the phone. */ keptLocally: true }

export interface PaymentsSyncDeps {
  db: PhoneDb
  vault: Pick<SessionVault, 'load'>
  master: Pick<PhoneMasterClient, 'configured' | 'paymentsGet' | 'paymentsSet'>
  nowMs?: () => number
  newReqId?: () => string
}

export interface PaymentsSync {
  refresh(force?: boolean): Promise<PaymentsRefreshResult>
  publish(list: PaymentsList): Promise<PaymentsPublishResult>
}

const codeOf = (e: unknown): MasterErrorCode => (e instanceof PhoneMasterError ? e.code : 'Q3M90')

/** Store the master's list when it is newer than the stored one. Returns true when stored. Pure of network. */
export async function storeMasterPayments(db: PhoneDb, view: PaymentsView): Promise<boolean> {
  if (!view.list) return false
  const cur = await readPayments(db)
  if (cur.stored && cur.list.version >= view.version) return false
  await writePayments(db, normalizeList({ ...view.list, version: view.version }), false)
  return true
}

export function createPaymentsSync(deps: PaymentsSyncDeps): PaymentsSync {
  const now = deps.nowMs ?? Date.now
  const newReqId = deps.newReqId ?? ((): string => globalThis.crypto.randomUUID())
  let last = -Infinity

  async function token(): Promise<string | null> {
    if (!deps.master.configured()) return null
    return (await deps.vault.load())?.deviceToken ?? null
  }

  async function refresh(force = false): Promise<PaymentsRefreshResult> {
    try {
      // Phase 290 (M25-5): a phone without `seePayments` does not ask for, and does not keep, the list.
      if (!getSeatRightsSnapshot().flags.seePayments) { if (deps.db.canWrite()) await dropPayments(deps.db); return 'skipped' }
      if (!force && now() - last < PAYMENTS_REFRESH_GAP_MS) return 'skipped'
      const t = await token()
      if (!t) return 'skipped' // no master link / no device token: the list stays on this phone
      last = now()
      const cur = await readPayments(deps.db)
      const view = await deps.master.paymentsGet(cur.stored ? { knownVersion: cur.list.version } : {}, t)
      return (await storeMasterPayments(deps.db, view)) ? 'updated' : 'same'
    } catch (e) {
      return e instanceof PhoneMasterError && e.code === 'Q3M22' ? 'refused' : 'failed' // offline / not set up / master down: the last list stays
    }
  }

  async function publish(list: PaymentsList): Promise<PaymentsPublishResult> {
    const keep = (code: MasterErrorCode | 'LOCAL', words: string): PaymentsPublishResult => ({ ok: false, code, words, keptLocally: true })
    const clean = normalizeList(list)
    try {
      await writePayments(deps.db, clean, true) // the edit is never lost, whatever happens next
      const t = await token()
      if (!t) return keep('LOCAL', PAYMENTS_LOCAL_ONLY_WORDS)
      const cur = await readPayments(deps.db)
      const { version: _v, ...body } = clean
      const view = await deps.master.paymentsSet({ reqId: newReqId(), expectVersion: cur.list.version, list: body }, t)
      if (!view.list) return keep('Q3M99', masterErrorWords('Q3M99'))
      await writePayments(deps.db, normalizeList({ ...view.list, version: view.version }), false)
      return { ok: true, version: view.version }
    } catch (e) {
      const code = codeOf(e)
      if (code === 'Q3M24') {
        await refresh(true) // adopt the master's newest list; the person makes the change again
        return keep(code, masterErrorWords(code))
      }
      return keep(code, masterErrorWords(code)) // Q3M23: kept and still marked unpublished; offline: tried again later
    }
  }

  return { refresh, publish }
}

export { dropPayments }
