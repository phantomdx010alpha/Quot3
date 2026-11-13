/** Phase 248 (M23): reads the Price List sync status from the phone database (counts only, never content). */
import { getRecord, type PhoneDb } from '../data/db'
import { getBranchLink } from '../sync/branch'
import { listPending } from '../sync/outbox'
import { readRefused } from '../data/priceRights'
import { SERVER_MISSING_KEY, type PriceSyncStatus } from '../sync/priceSyncWords'

/** Items held = rows of kind `item` that are not deleted. Reads one store; a failure answers 0 rather than throwing. */
export async function countPriceItems(db: PhoneDb): Promise<number> {
  try {
    const tx = db.idb.transaction('price_rows', 'readonly')
    const rows = await new Promise<{ kind?: unknown; deleted?: unknown }[]>((resolve, reject) => {
      const r = tx.objectStore('price_rows').getAll()
      r.onsuccess = () => resolve(r.result as { kind?: unknown; deleted?: unknown }[])
      r.onerror = () => reject(r.error)
    })
    return rows.filter((r) => r.kind === 'item' && !r.deleted).length
  } catch { return 0 }
}

export async function loadPriceSyncStatus(db: PhoneDb): Promise<PriceSyncStatus> {
  const [items, pending, refused, missing, link] = await Promise.all([
    countPriceItems(db),
    listPending(db).catch(() => []),
    readRefused(db).catch(() => []),
    getRecord<{ key: string; value: unknown }>(db, 'meta', SERVER_MISSING_KEY).catch(() => undefined),
    getBranchLink(db).catch(() => null)
  ])
  return {
    items,
    queued: pending.filter((p) => p.kind.startsWith('price_')).length,
    refused: refused.length,
    serverMissing: missing?.value === true,
    linked: link?.linked === true
  }
}
