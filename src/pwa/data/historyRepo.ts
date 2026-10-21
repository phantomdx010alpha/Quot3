import { reqToPromise, type PhoneDb } from './db'
import type { StoredBill, StoredRow } from './billsRepo'
import { listBillHeads, type BillHead } from './billsRepo'
import type { SearchCandidate } from '../../shared/history/historySearch'

/** Phone History read model (Phase 181). Read-only: never writes, so it works in a read-only tab. */

/** `BillHead` as the shared History list item (the shape the shared search ranks). */
export function headToListItem(h: BillHead): Omit<SearchCandidate, 'itemText'> {
  return { id: h.id, poNumber: h.poNumber, poSeq: h.poSeq, billDate: h.billDate, partyName: h.partyName, grandTotal: h.grandTotal, branchId: h.branchId, revision: h.revision }
}

/** Every live (or trashed) bill with all its item names joined, ready for the shared `rankBills`. One read of both stores. */
export async function listSearchCandidates(db: PhoneDb, o: { trashed?: boolean } = {}): Promise<SearchCandidate[]> {
  const heads = await listBillHeads(db, o)
  if (heads.length === 0) return []
  const tx = db.idb.transaction(['bills', 'bill_rows'], 'readonly')
  const rows = (await reqToPromise(tx.objectStore('bill_rows').getAll())) as StoredRow[]
  const byBill = new Map<string, string[]>()
  for (const r of rows) {
    const t = r.namePlain
    if (!t) continue
    const list = byBill.get(r.bill_id)
    if (list) list.push(t)
    else byBill.set(r.bill_id, [t])
  }
  return heads.map((h) => ({ ...headToListItem(h), itemText: (byBill.get(h.id) ?? []).join(' ') }))
}

/** How many trashed bills exist (for the Recently deleted entry button). */
export async function countTrashed(db: PhoneDb): Promise<number> {
  const all = (await reqToPromise(db.idb.transaction('bills', 'readonly').objectStore('bills').getAll())) as StoredBill[]
  let n = 0
  for (const b of all) if (b.deletedAt !== null) n++
  return n
}
