/** Phone Price List repo (Phase 244, M23). IndexedDB twin of the desktop `priceListRepo`, data layer only (the phone screens come in Phase 245).
 *  Stored rows ARE the shared records (`shared/sync/priceListRecords.ts`: camelCase, tombstones with `deletedAt`, unknown fields kept), so what is
 *  stored is exactly what is sent and what comes back from the notebook; there is no phone-only field that could change a content hash.
 *  Deletes are tombstones. A local change calls `inTx` INSIDE the transaction (the sync outbox row commits with the data); a change that came
 *  from another branch is written by the sync applier and never calls it. Pure data: nothing in a record is ever executed. */
import { PRICE_REVISION, type PriceCategoryRec, type PriceKind, type PriceRowRec, type PriceTabRec, type PriceTierRec } from '../../shared/sync/priceListRecords'
import { getAllRecords, getRecord, reqToPromise, txDone, type PhoneDb, type StoreName } from './db'

export type { PriceCategoryRec, PriceRowRec, PriceTabRec, PriceTierRec }
export { PRICE_REVISION }

/** One local change, as the outbox needs it. */
export interface PriceChangeInfo { kind: PriceKind; id: string; deleted: boolean }
export interface PriceListOptions {
  /** Called synchronously inside the transaction (it may `put` into other stores of `tx`, e.g. `sync_outbox`). A throw aborts the whole change. */
  inTx?: (tx: IDBTransaction, change: PriceChangeInfo) => void
}
/** Who made a local change: written into the record, never taken from anywhere else. */
export interface PriceStamp { at: string; branchId: string; seatNo: number | null }

export const PRICE_STORE: Readonly<Record<PriceKind, StoreName>> = { price_tier: 'price_tiers', price_category: 'price_categories', price_tab: 'price_tabs', price_row: 'price_rows' }

const live = <T extends { deletedAt: string | null }>(r: T): boolean => r.deletedAt === null
const byPos = <T extends { position: number; id: string }>(a: T, b: T): number => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// ---- reads (live records only; a tab or row under a deleted parent is not listed) ------------------------------------

export async function listTiers(db: PhoneDb): Promise<PriceTierRec[]> {
  return (await getAllRecords<PriceTierRec>(db, 'price_tiers')).filter(live).sort(byPos)
}
export async function listCategories(db: PhoneDb): Promise<PriceCategoryRec[]> {
  return (await getAllRecords<PriceCategoryRec>(db, 'price_categories')).filter(live).sort(byPos)
}
export async function listTabs(db: PhoneDb, categoryId: string): Promise<PriceTabRec[]> {
  const cat = await getRecord<PriceCategoryRec>(db, 'price_categories', categoryId)
  if (!cat || !live(cat)) return []
  const tx = db.idb.transaction('price_tabs', 'readonly')
  const all = (await reqToPromise(tx.objectStore('price_tabs').index('category_id_idx').getAll(categoryId))) as PriceTabRec[]
  return all.filter(live).sort(byPos)
}
export async function listRows(db: PhoneDb, tabId: string): Promise<PriceRowRec[]> {
  const tab = await getRecord<PriceTabRec>(db, 'price_tabs', tabId)
  if (!tab || !live(tab)) return []
  const tx = db.idb.transaction('price_rows', 'readonly')
  const all = (await reqToPromise(tx.objectStore('price_rows').index('tab_idx').getAll(IDBKeyRange.bound([tabId, 0], [tabId, Number.MAX_SAFE_INTEGER])))) as PriceRowRec[]
  return all.filter(live).sort((a, b) => a.idx - b.idx || (a.id < b.id ? -1 : 1))
}
export const getPriceTab = (db: PhoneDb, id: string): Promise<PriceTabRec | undefined> => getRecord<PriceTabRec>(db, 'price_tabs', id)
export const getPriceRow = (db: PhoneDb, id: string): Promise<PriceRowRec | undefined> => getRecord<PriceRowRec>(db, 'price_rows', id)
/** True when the phone holds any Price List record (live or tombstone). */
export async function hasPriceList(db: PhoneDb): Promise<boolean> {
  for (const s of Object.values(PRICE_STORE)) if ((await reqToPromise(db.idb.transaction(s, 'readonly').objectStore(s).count())) > 0) return true
  return false
}

// ---- local writes ----------------------------------------------------------------------------------------------------

type AnyRec = { id: string; updatedAt: string; deletedAt: string | null; branchId: string; createdAt: string } & Record<string, unknown>
const stampOf = (s: PriceStamp, seatKey: boolean): Record<string, unknown> => ({ updatedAt: s.at, branchId: s.branchId, ...(seatKey ? { updatedBySeat: s.seatNo } : {}) })

/** Creates or replaces one record with the caller's fields (a tier has no seat field). Returns the stored record. */
export async function savePriceRecord(db: PhoneDb, kind: PriceKind, fields: Record<string, unknown> & { id: string }, stamp: PriceStamp, opts: PriceListOptions = {}): Promise<AnyRec> {
  db.assertWritable()
  const store = PRICE_STORE[kind]
  const tx = db.idb.transaction([store, 'sync_outbox'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  try {
    const old = (await reqToPromise(tx.objectStore(store).get(fields.id))) as AnyRec | undefined
    const rec = { ...(old ?? {}), ...fields, ...stampOf(stamp, kind !== 'price_tier'), createdAt: old?.createdAt ?? stamp.at, deletedAt: null } as AnyRec
    tx.objectStore(store).put(rec)
    opts.inTx?.(tx, { kind, id: rec.id, deleted: false })
    await done
    return rec
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
}

/**
 * Soft-deletes a record. A category takes its live tabs and their live rows with it, a tab takes its live rows (each child gets the same
 * `deletedAt` and its own outbox row, like the desktop trash). Returns how many records were tombstoned.
 */
export async function softDeletePrice(db: PhoneDb, kind: PriceKind, id: string, stamp: PriceStamp, opts: PriceListOptions = {}): Promise<number> {
  db.assertWritable()
  const tx = db.idb.transaction(['price_tiers', 'price_categories', 'price_tabs', 'price_rows', 'sync_outbox'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  let n = 0
  const kill = async (k: PriceKind, rid: string): Promise<void> => {
    const st = tx.objectStore(PRICE_STORE[k])
    const cur = (await reqToPromise(st.get(rid))) as AnyRec | undefined
    if (!cur || cur.deletedAt !== null) return
    st.put({ ...cur, ...stampOf(stamp, k !== 'price_tier'), deletedAt: stamp.at })
    opts.inTx?.(tx, { kind: k, id: rid, deleted: true })
    n++
  }
  const rowsOf = async (tabId: string): Promise<AnyRec[]> => (await reqToPromise(tx.objectStore('price_rows').index('tab_idx').getAll(IDBKeyRange.bound([tabId, 0], [tabId, Number.MAX_SAFE_INTEGER])))) as AnyRec[]
  try {
    if (kind === 'price_category') {
      for (const t of (await reqToPromise(tx.objectStore('price_tabs').index('category_id_idx').getAll(id))) as AnyRec[]) {
        if (t.deletedAt !== null) continue
        for (const r of await rowsOf(t.id)) await kill('price_row', r.id)
        await kill('price_tab', t.id)
      }
    } else if (kind === 'price_tab') {
      for (const r of await rowsOf(id)) await kill('price_row', r.id)
    }
    await kill(kind, id)
    await done
    return n
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
}
