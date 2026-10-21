import { reqToPromise, type PhoneDb } from '../data/db'

/**
 * Phase 179 - `sync_record_state` on IndexedDB: the last server version this phone saw for each synced record
 * (`base_version` feeds `base_version` of the next push, `base_hash` says what the content was then). Port of the desktop
 * `SyncRecordRepo` state rules, not of its SQL. Rows: `{ kind, rec_id, base_version, base_hash, server_seq, synced_at }`.
 * The `*Tx` forms run inside the caller's transaction (the store must be part of it), so a record and its state commit together.
 */
export interface RecordState {
  kind: string
  recId: string
  baseVersion: number
  baseHash: string
  serverSeq: number
  syncedAt: string | null
}

interface StoredState { kind: string; rec_id: string; base_version: number; base_hash: string; server_seq: number; synced_at: string | null }

const fromStored = (s: StoredState): RecordState => ({ kind: s.kind, recId: s.rec_id, baseVersion: s.base_version, baseHash: s.base_hash, serverSeq: s.server_seq, syncedAt: s.synced_at })
const toStored = (r: RecordState): StoredState => ({ kind: r.kind, rec_id: r.recId, base_version: r.baseVersion, base_hash: r.baseHash, server_seq: r.serverSeq, synced_at: r.syncedAt })

export async function getStateTx(tx: IDBTransaction, kind: string, recId: string): Promise<RecordState | undefined> {
  const s = (await reqToPromise(tx.objectStore('sync_record_state').get([kind, recId]))) as StoredState | undefined
  return s ? fromStored(s) : undefined
}

export function putStateTx(tx: IDBTransaction, r: RecordState): void {
  tx.objectStore('sync_record_state').put(toStored(r))
}

export async function getState(db: PhoneDb, kind: string, recId: string): Promise<RecordState | undefined> {
  return getStateTx(db.idb.transaction('sync_record_state', 'readonly'), kind, recId)
}

/** Every remembered state of one kind. */
export async function listStates(db: PhoneDb, kind: string): Promise<RecordState[]> {
  const tx = db.idb.transaction('sync_record_state', 'readonly')
  const all = (await reqToPromise(tx.objectStore('sync_record_state').getAll(IDBKeyRange.bound([kind, ''], [kind, '￿'])))) as StoredState[]
  return all.map(fromStored)
}

export async function countStates(db: PhoneDb): Promise<number> {
  return reqToPromise(db.idb.transaction('sync_record_state', 'readonly').objectStore('sync_record_state').count())
}
