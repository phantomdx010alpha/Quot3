import { asideEnvelopeJson, decodeRecord, READER_VER, type DecodeResult, type RawRecord } from '../../shared/sync/codecV2'
import { reqToPromise, type PhoneDb } from '../data/db'

/**
 * Phase 179 - `sync_aside` on IndexedDB: records written by a NEWER app (`min_reader_ver` above this build's `READER_VER`, or an unknown kind)
 * are kept WHOLE and never applied or overwritten; the cursor still moves on. After an app update `asideRetry.retryAsideRecords` decodes them again (own file: it needs the applier, which imports this one).
 * Rows: `{ kind, rec_id, version, min_reader_ver, payload_json, seen_at }` (`payload_json` = the whole record envelope, `codecV2.asideEnvelopeJson`).
 */
export interface AsideRow { kind: string; recId: string; version: number; minReaderVer: number; payloadJson: string; seenAt: string }
interface StoredAside { kind: string; rec_id: string; version: number; min_reader_ver: number; payload_json: string; seen_at: string }
const fromStored = (s: StoredAside): AsideRow => ({ kind: s.kind, recId: s.rec_id, version: s.version, minReaderVer: s.min_reader_ver, payloadJson: s.payload_json, seenAt: s.seen_at })

export async function isAsideTx(tx: IDBTransaction, kind: string, recId: string): Promise<boolean> {
  return (await reqToPromise(tx.objectStore('sync_aside').get([kind, recId]))) !== undefined
}

/** Keeps the HIGHER version when a row for the record already exists. */
export async function putAsideTx(tx: IDBTransaction, row: AsideRow): Promise<void> {
  const store = tx.objectStore('sync_aside')
  const cur = (await reqToPromise(store.get([row.kind, row.recId]))) as StoredAside | undefined
  if (cur && cur.version > row.version) return
  store.put({ kind: row.kind, rec_id: row.recId, version: row.version, min_reader_ver: row.minReaderVer, payload_json: row.payloadJson, seen_at: row.seenAt } satisfies StoredAside)
}

/**
 * The version check comes FIRST (`decodeRecord` never looks at a newer writer's payload). A record this build cannot read is stored whole in
 * the aside list and answered as `aside`; `apply` / `invalid` leave the aside list alone (the caller applies or counts the damage).
 */
export async function ingestTx(tx: IDBTransaction, raw: RawRecord, now: Date, readerVer: number = READER_VER): Promise<DecodeResult> {
  const dec = decodeRecord(raw, readerVer)
  if (dec.outcome === 'aside') {
    await putAsideTx(tx, { kind: dec.kind, recId: dec.recId, version: dec.version, minReaderVer: dec.minReaderVer, payloadJson: asideEnvelopeJson(raw), seenAt: now.toISOString() })
  }
  return dec
}

export async function listAside(db: PhoneDb): Promise<AsideRow[]> {
  return ((await reqToPromise(db.idb.transaction('sync_aside', 'readonly').objectStore('sync_aside').getAll())) as StoredAside[]).map(fromStored)
}

/** How many records wait for an app update (drives "Update the app to see N bills"). */
export async function countAside(db: PhoneDb): Promise<{ total: number; bills: number }> {
  const rows = await listAside(db)
  return { total: rows.length, bills: rows.filter((r) => r.kind === 'bill').length }
}
