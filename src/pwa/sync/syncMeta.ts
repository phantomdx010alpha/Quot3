import { getMetaValue, setMetaValue } from '../data/metaRepo'
import { putRecord, reqToPromise, type PhoneDb } from '../data/db'

/**
 * Phase 179 - the small bits of worker state kept in the `meta` store next to the existing `server_seq` and `clock_offset_ms`
 * (no new store, no IndexedDB upgrade). Raw `{ key, value }` rows; `getMeta` ignores keys it does not list. Nothing here is secret.
 */
export const SYNC_META = {
  /** ISO time the first-sync compare was applied; absent = the phone has not done its first sync. */
  compareDone: 'sync.compare_done',
  /** Bills older than this `server_seq` that the phone does not already hold are not stored (Q6 "recent + all customers"); 0 / absent = everything. */
  floorSeq: 'sync.floor_seq',
  /** How many older bills the floor left on the server. */
  deferredBills: 'sync.deferred_bills',
  /** When the clock offset was last measured (epoch ms). */
  clockAt: 'sync.clock_at',
  /** Prefix of records that failed to apply and wait for a retry: `sync.pull_fail.<kind>.<recId>`. */
  pullFail: 'sync.pull_fail.'
} as const

interface MetaRow { key: string; value: unknown }

export async function getRaw<T>(db: PhoneDb, key: string, fallback: T): Promise<T> {
  const row = (await reqToPromise(db.idb.transaction('meta', 'readonly').objectStore('meta').get(key))) as MetaRow | undefined
  return row ? (row.value as T) : fallback
}
export const setRaw = (db: PhoneDb, key: string, value: unknown): Promise<void> => putRecord(db, 'meta', { key, value } satisfies MetaRow)
export const setRawTx = (tx: IDBTransaction, key: string, value: unknown): void => { tx.objectStore('meta').put({ key, value } satisfies MetaRow) }

export async function readCursor(db: PhoneDb): Promise<number> {
  const n = await getMetaValue(db, 'server_seq')
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0
}
export const writeCursor = (db: PhoneDb, seq: number): Promise<void> => setMetaValue(db, 'server_seq', Math.max(0, Math.trunc(seq)))
export const setCursorTx = (tx: IDBTransaction, seq: number): void => setRawTx(tx, 'server_seq', Math.max(0, Math.trunc(seq)))

export const isFirstSyncDone = async (db: PhoneDb): Promise<boolean> => (await getRaw<string | null>(db, SYNC_META.compareDone, null)) !== null
export const readFloorSeq = async (db: PhoneDb): Promise<number> => {
  const n = await getRaw<number>(db, SYNC_META.floorSeq, 0)
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Records that failed or were held, kept with the record itself so a retry needs no server round trip. */
export interface PullFail { attempts: number; held: boolean; error: string; payloadHash: string; raw: unknown }
const failKey = (kind: string, recId: string): string => `${SYNC_META.pullFail}${kind}.${recId}`
export const putPullFail = (db: PhoneDb, kind: string, recId: string, f: PullFail): Promise<void> => setRaw(db, failKey(kind, recId), f)
export async function removePullFail(db: PhoneDb, kind: string, recId: string): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction('meta', 'readwrite')
  tx.objectStore('meta').delete(failKey(kind, recId))
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error) })
}
export async function listPullFails(db: PhoneDb): Promise<{ kind: string; recId: string; fail: PullFail }[]> {
  const rows = (await reqToPromise(db.idb.transaction('meta', 'readonly').objectStore('meta').getAll(IDBKeyRange.bound(SYNC_META.pullFail, `${SYNC_META.pullFail}￿`)))) as MetaRow[]
  const out: { kind: string; recId: string; fail: PullFail }[] = []
  for (const r of rows) {
    const rest = r.key.slice(SYNC_META.pullFail.length)
    const dot = rest.indexOf('.')
    if (dot <= 0) continue
    out.push({ kind: rest.slice(0, dot), recId: rest.slice(dot + 1), fail: r.value as PullFail })
  }
  return out
}
