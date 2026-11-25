/**
 * Phase 281 (M25, API_CONTRACTS.md M25-1 / M25-3) - the phone's Payments list, offline.
 * Kept as two extra rows in the existing `meta` store (keys `payments.list`, `payments.prefs`): no schema change, and `getMeta`
 * ignores unknown keys, so backups and the other meta readers are untouched. The list is seeded from `shared/payments/seed` only
 * when neither the phone nor the master has one (`readPayments` answers the seed WITHOUT storing it until the first save).
 * Per-phone prefs (not synced): the bank-account switch and the last payee.
 */
import { normalizeList } from '../../shared/payments/list'
import { seedList } from '../../shared/payments/seed'
import type { PaymentsList } from '../../shared/payments/types'
import { getRecord, putRecord, type PhoneDb } from './db'
import { assertSeatRight } from './seatRights'

const LIST_KEY = 'payments.list'
const PREFS_KEY = 'payments.prefs'

export interface StoredPayments {
  list: PaymentsList
  /** True while the list holds a change the master has not accepted yet. */
  unpublished: boolean
  /** False = nothing was ever stored on this phone: `list` is the seed. */
  stored: boolean
}

export interface PaymentsPrefs { accountMode: boolean; lastPayeeId: string | null }

interface Row { key: string; value: unknown }

/** The stored list (normalised again on every read: a damaged row never reaches a screen), or the seed. Never throws. */
export async function readPayments(db: PhoneDb): Promise<StoredPayments> {
  try {
    const row = await getRecord<Row>(db, 'meta', LIST_KEY)
    const v = row?.value as { list?: unknown; unpublished?: unknown } | undefined
    if (v && typeof v === 'object' && v.list !== undefined) return { list: normalizeList(v.list), unpublished: v.unpublished === true, stored: true }
  } catch { /* fall through to the seed */ }
  return { list: seedList(), unpublished: false, stored: false }
}

/** Store a list as it is (version = the master version it is based on). */
export async function writePayments(db: PhoneDb, list: PaymentsList, unpublished: boolean): Promise<void> {
  if (unpublished) assertSeatRight('editPayments', 'change payment details') // Phase 291: only a LOCAL edit; the master's list (unpublished = false) is stored as before
  await putRecord(db, 'meta', { key: LIST_KEY, value: { list: normalizeList(list), unpublished } } satisfies Row)
}

/** Forget the stored list (the phone lost the right to see Payments). Prefs stay. */
export async function dropPayments(db: PhoneDb): Promise<void> {
  await putRecord(db, 'meta', { key: LIST_KEY, value: null } satisfies Row)
}

export async function readPaymentsPrefs(db: PhoneDb): Promise<PaymentsPrefs> {
  try {
    const v = (await getRecord<Row>(db, 'meta', PREFS_KEY))?.value as Partial<PaymentsPrefs> | undefined
    return { accountMode: v?.accountMode === true, lastPayeeId: typeof v?.lastPayeeId === 'string' ? v.lastPayeeId : null }
  } catch { return { accountMode: false, lastPayeeId: null } }
}

export async function writePaymentsPrefs(db: PhoneDb, prefs: PaymentsPrefs): Promise<void> {
  await putRecord(db, 'meta', { key: PREFS_KEY, value: { accountMode: prefs.accountMode === true, lastPayeeId: prefs.lastPayeeId } } satisfies Row)
}
