import { reqToPromise, txDone, type PhoneDb } from '../data/db'
import type { BillChangeInfo, BillsOptions } from '../data/billsRepo'
import type { PartiesOptions, PartyChangeInfo } from '../data/partiesRepo'
import { OUTBOX_MAX_ATTEMPTS } from '../../shared/sync/outbox'

/**
 * Phase 179 - `sync_outbox` on IndexedDB (port of the desktop outbox rules).
 *
 * ONE row per record that has an unsent change, keyed `"<kind>:<recId>"`. A newer change to the same record REPLACES the older row
 * (`n` counts the replacements; attempts reset), so the row never holds a copy of the record: the push worker builds the record from the
 * stores AT SEND TIME. A row is "unsent" for as long as it exists: sent rows are deleted (the server and `sync_record_state` are the trail).
 * Capture happens INSIDE the save transaction (`withOutbox`), so a bill and its outbox row commit or roll back together.
 * Parties sort before bills (a bill never reaches another branch before the customer it names).
 */
export type OutboxKind = 'bill' | 'party' | 'party_merge' | 'item_rule'
export type OutboxOp = 'upsert' | 'delete'
export type OutboxState = 'pending' | 'failed'

export interface OutboxRow {
  id: string
  kind: OutboxKind
  recId: string
  op: OutboxOp
  /** Bill revision after the change (0 for other kinds). */
  revision: number
  /** Replacement counter: a settle only removes the row when `n` is still the one that was sent. */
  n: number
  createdAt: string
  attempts: number
  lastError: string | null
  state: OutboxState
}

interface StoredOutbox { id: string; kind: OutboxKind; rec_id: string; op: OutboxOp; revision: number; n: number; created_at: string; attempts: number; last_error: string | null; state: OutboxState }

const toRow = (s: StoredOutbox): OutboxRow => ({ id: s.id, kind: s.kind, recId: s.rec_id, op: s.op, revision: s.revision, n: s.n, createdAt: s.created_at, attempts: s.attempts, lastError: s.last_error, state: s.state })
export const outboxKey = (kind: string, recId: string): string => `${kind}:${recId}`
const KIND_RANK: Record<string, number> = { party_merge: 0, party: 1, bill: 2, item_rule: 3 }
const byOrder = (a: OutboxRow, b: OutboxRow): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export interface CaptureInput { kind: OutboxKind; recId: string; op: OutboxOp; revision: number }

/**
 * Queues (or replaces) the unsent change of a record, inside `tx` (the transaction must include `sync_outbox`). Synchronous from the
 * caller's side: the read-modify-write finishes inside the same transaction. A failure aborts the transaction, i.e. the whole save.
 */
export function captureInTx(tx: IDBTransaction, c: CaptureInput, at: string): void {
  const store = tx.objectStore('sync_outbox')
  const id = outboxKey(c.kind, c.recId)
  const req = store.get(id)
  req.onsuccess = () => {
    const old = req.result as StoredOutbox | undefined
    store.put({ id, kind: c.kind, rec_id: c.recId, op: c.op, revision: c.revision, n: (old?.n ?? 0) + 1, created_at: at, attempts: 0, last_error: null, state: 'pending' } satisfies StoredOutbox)
  }
  req.onerror = () => { try { tx.abort() } catch { /* already finished */ } }
}

export interface OutboxCaptureOptions { now?: () => Date }

/**
 * The options that make bill and customer saves feed the outbox. Spread them into `saveBillWithParty`, `deleteBills` and `restoreBills`:
 *   `saveBillWithParty(db, input, { ...withOutbox(), ...other })`.
 */
export function withOutbox(o: OutboxCaptureOptions = {}): Pick<BillsOptions, 'inTx'> & { parties: Pick<PartiesOptions, 'inTx'> } {
  const now = o.now ?? (() => new Date())
  return {
    inTx: (tx: IDBTransaction, info: BillChangeInfo) =>
      captureInTx(tx, { kind: 'bill', recId: info.billId, op: info.op === 'delete' ? 'delete' : 'upsert', revision: info.revision }, now().toISOString()),
    parties: { inTx: (tx: IDBTransaction, info: PartyChangeInfo) => captureInTx(tx, { kind: 'party', recId: info.partyId, op: 'upsert', revision: 0 }, now().toISOString()) }
  }
}

/** Unsent rows (state `pending`), oldest first. */
export async function listPending(db: PhoneDb, limit = Number.MAX_SAFE_INTEGER): Promise<OutboxRow[]> {
  const all = (await reqToPromise(db.idb.transaction('sync_outbox', 'readonly').objectStore('sync_outbox').getAll())) as StoredOutbox[]
  return all.map(toRow).filter((r) => r.state === 'pending').sort(byOrder).slice(0, limit)
}

export async function listFailed(db: PhoneDb): Promise<OutboxRow[]> {
  const all = (await reqToPromise(db.idb.transaction('sync_outbox', 'readonly').objectStore('sync_outbox').getAll())) as StoredOutbox[]
  return all.map(toRow).filter((r) => r.state === 'failed').sort(byOrder)
}

export interface OutboxCounts { pending: number; failed: number }
export async function outboxCounts(db: PhoneDb): Promise<OutboxCounts> {
  const all = (await reqToPromise(db.idb.transaction('sync_outbox', 'readonly').objectStore('sync_outbox').getAll())) as StoredOutbox[]
  let pending = 0, failed = 0
  for (const s of all) if (s.state === 'failed') failed++; else pending++
  return { pending, failed }
}

export async function hasUnsentTx(tx: IDBTransaction, kind: string, recId: string): Promise<boolean> {
  return (await reqToPromise(tx.objectStore('sync_outbox').get(outboxKey(kind, recId)))) !== undefined
}

/** Removes the unsent change of a record (its local edit lost to a later remote version; the local version stays in the revision list). */
export function dropUnsentTx(tx: IDBTransaction, kind: string, recId: string): void {
  tx.objectStore('sync_outbox').delete(outboxKey(kind, recId))
}

/** Settles a row that was sent: removed only when it was not replaced by a newer change meanwhile (`n` unchanged). */
export async function settleTx(tx: IDBTransaction, row: Pick<OutboxRow, 'id' | 'n'>): Promise<void> {
  const store = tx.objectStore('sync_outbox')
  const cur = (await reqToPromise(store.get(row.id))) as StoredOutbox | undefined
  if (cur && cur.n === row.n) store.delete(row.id)
}

/** Counts a failed attempt for one row (never for connection trouble). Returns the new state; `failed` after `OUTBOX_MAX_ATTEMPTS`. */
export async function markAttempt(db: PhoneDb, row: Pick<OutboxRow, 'id' | 'n'>, error: string): Promise<OutboxState | null> {
  db.assertWritable()
  const tx = db.idb.transaction('sync_outbox', 'readwrite')
  const store = tx.objectStore('sync_outbox')
  const cur = (await reqToPromise(store.get(row.id))) as StoredOutbox | undefined
  let state: OutboxState | null = null
  if (cur && cur.n === row.n) {
    const attempts = cur.attempts + 1
    state = attempts >= OUTBOX_MAX_ATTEMPTS ? 'failed' : 'pending'
    store.put({ ...cur, attempts, last_error: error.slice(0, 300), state })
  }
  await txDone(tx)
  return state
}

/** "Try again": failed rows go back to pending with a fresh attempt count. */
export async function retryFailed(db: PhoneDb): Promise<number> {
  db.assertWritable()
  const tx = db.idb.transaction('sync_outbox', 'readwrite')
  const store = tx.objectStore('sync_outbox')
  const all = (await reqToPromise(store.getAll())) as StoredOutbox[]
  let n = 0
  for (const s of all) if (s.state === 'failed') { store.put({ ...s, state: 'pending', attempts: 0, last_error: null }); n++ }
  await txDone(tx)
  return n
}

export interface EnqueueItem { kind: OutboxKind; recId: string; op: OutboxOp; revision: number }
/** Bulk queue for the first-sync compare ("upload" records). Idempotent: an already queued record is replaced. */
export function enqueueManyTx(tx: IDBTransaction, items: readonly EnqueueItem[], at: string): void {
  for (const i of items) captureInTx(tx, i, at)
}
