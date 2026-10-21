import { encodeRecord, type EncodedRecord, type RecordKind } from '../../shared/sync/codecV2'
import { correctedEditedAt } from '../../shared/sync/diff'
import { reqToPromise, type PhoneDb } from '../data/db'
import { rowRange, type StoredBill, type StoredRow } from '../data/billsRepo'

/**
 * Phase 179 - builds the v2 record (`codecV2.encodeRecord`) of a local bill or customer AT SEND TIME from the IndexedDB stores, exactly as the
 * desktop's `encodeLocalRecord` does from SQLite (an outbox row never holds a stale copy). The phone's own index fields (`bill_date`, `party_id`,
 * `po_number`, `deleted_at`, `bill_id`, `name_norm`) are NOT part of the record and are removed here: leaking them would change the content
 * hash and make the same bill look different on the phone and on a PC.
 * Stores a transaction needs: `bills`, `bill_rows`, `parties`.
 */
const BILL_INDEX_FIELDS = ['bill_date', 'party_id', 'po_number', 'deleted_at', 'syncState'] as const
type Obj = Record<string, unknown>
const omit = <T extends Obj>(o: T, keys: readonly string[]): Obj => { const out: Obj = {}; for (const k of Object.keys(o)) if (!keys.includes(k)) out[k] = o[k]; return out }
const ms = (iso: string): number => { const n = Date.parse(iso); return Number.isNaN(n) ? 0 : n }

/** The shared `BillRecord` of a stored row (no phone index fields, no local `syncState`). */
export const billRecordOf = (s: StoredBill): Obj => omit(s as unknown as Obj, BILL_INDEX_FIELDS)
export const billRowRecordOf = (s: StoredRow): Obj => omit(s as unknown as Obj, ['bill_id'])

export interface EncodeOptions { offsetMs: number | null; appVer: string }

export async function encodeLocalInTx(tx: IDBTransaction, kind: RecordKind, recId: string, o: EncodeOptions): Promise<EncodedRecord | null> {
  if (kind === 'bill') {
    const head = (await reqToPromise(tx.objectStore('bills').get(recId))) as StoredBill | undefined
    if (!head) return null
    const rows = (await reqToPromise(tx.objectStore('bill_rows').index('bill_id_idx').getAll(rowRange(recId)))) as StoredRow[]
    return encodeRecord({
      kind: 'bill', recId, data: { bill: billRecordOf(head), rows: rows.map(billRowRecordOf) }, deleted: head.deletedAt !== null,
      editedAt: correctedEditedAt(ms(head.updatedAt), o.offsetMs), appVer: o.appVer
    })
  }
  if (kind === 'party') {
    const p = (await reqToPromise(tx.objectStore('parties').get(recId))) as (Obj & { updatedAt: string; deletedAt: string | null }) | undefined
    if (!p) return null
    return encodeRecord({
      kind: 'party', recId, data: { party: omit(p, ['name_norm']) }, deleted: p.deletedAt !== null,
      editedAt: correctedEditedAt(ms(p.updatedAt), o.offsetMs), appVer: o.appVer
    })
  }
  return null // `party_merge` / `item_rule` are never made on the phone [A]
}

/** Same, in its own read transaction. `null` = the record is not here (purged): nothing to send. */
export async function encodeLocal(db: PhoneDb, kind: RecordKind, recId: string, o: EncodeOptions): Promise<EncodedRecord | null> {
  return encodeLocalInTx(db.idb.transaction(['bills', 'bill_rows', 'parties'], 'readonly'), kind, recId, o)
}

export interface LocalHash { recId: string; hash: string; deleted: boolean; revision: number }

/** Every local record of a kind with its content hash as the server would see it (the local side of the first-sync compare). A record that cannot be encoded is left out. */
export async function listLocalHashes(db: PhoneDb, kind: RecordKind, o: EncodeOptions): Promise<LocalHash[]> {
  const tx = db.idb.transaction(['bills', 'bill_rows', 'parties'], 'readonly')
  const ids = (await reqToPromise(tx.objectStore(kind === 'bill' ? 'bills' : 'parties').getAllKeys())) as string[]
  const out: LocalHash[] = []
  if (kind !== 'bill' && kind !== 'party') return out
  for (const id of ids) {
    try {
      const e = await encodeLocalInTx(tx, kind, id, o)
      if (!e) continue
      const rev = kind === 'bill' ? Number((e.payload.bill as { revision?: unknown }).revision) || 0 : 0
      out.push({ recId: id, hash: e.payloadHash, deleted: e.deleted, revision: rev })
    } catch { /* an unencodable record is left out of the compare; the push worker blames it when it is queued */ }
  }
  return out
}
