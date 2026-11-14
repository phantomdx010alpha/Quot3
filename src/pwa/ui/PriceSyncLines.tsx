import { useEffect, useState, type ReactElement } from 'react'
import type { PhoneDb } from '../data/db'
import { priceFirstSyncNote, priceSyncLines, priceStorageNote, type PriceSyncInfo, type PriceSyncStatus } from '../sync/priceSyncWords'
import { countPriceItems, loadPriceSyncStatus } from './priceSyncStatus'

/** Phase 248 (M23): the Price List lines of Settings > Connect to your PC / Storage and backup. New layouts only (the caller passes `plain`).
 *  Wrap rule: plain paragraphs only. `refreshKey` re-reads after a sync. */
export function PriceSyncLines(props: { db: PhoneDb; refreshKey?: number; preview?: PriceSyncInfo | null; onCheckRights?: () => Promise<void> }): ReactElement {
  const [status, setStatus] = useState<PriceSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; void loadPriceSyncStatus(props.db).then((s) => { if (live) setStatus(s) }, () => undefined); return () => { live = false } }, [props.db, props.refreshKey])
  return (
    <div className="q3-set" data-testid="price-sync-lines">
      {props.preview ? <p className="q3-note" data-testid="price-first-sync">{priceFirstSyncNote(props.preview)}</p> : null}
      {status ? priceSyncLines(status).map((l) => <p key={l} className="q3-muted" role="status">{l}</p>) : null}
      {status?.rights && props.onCheckRights ? (
        <button type="button" className="q3-btn" disabled={busy} data-testid="rights-check-again" onClick={() => { setBusy(true); void props.onCheckRights?.().finally(() => setBusy(false)) }}>{busy ? 'Checking, please wait' : 'Check my rights again'}</button>
      ) : null}
    </div>
  )
}

/** Storage and backup: the size note for the Price List (new layouts only). */
export function PriceStorageNote(props: { db: PhoneDb; refreshKey?: number }): ReactElement | null {
  const [items, setItems] = useState<number | null>(null)
  useEffect(() => { let live = true; void countPriceItems(props.db).then((n) => { if (live) setItems(n) }); return () => { live = false } }, [props.db, props.refreshKey])
  return items === null ? null : <p className="q3-muted" data-testid="price-storage-note">{priceStorageNote(items)}</p>
}
