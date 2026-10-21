import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { listBillHeads, restoreBills, type BillHead } from '../data/billsRepo'
import type { PhoneDb } from '../data/db'
import { withOutbox } from '../sync/outbox'
import { formatHistoryDate, formatHistoryTotal } from '../../shared/history/historyList'

/** Recently deleted (Phase 181): trashed bills, newest bill date first, with Restore. Nothing is purged automatically. */
export function Trash(props: { db: PhoneDb | null; onChanged?: () => void }): ReactElement {
  const { db } = props
  const [heads, setHeads] = useState<BillHead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    listBillHeads(db, { trashed: true }).then(
      (h) => { if (!cancelled) setHeads(h) },
      (e: unknown) => { if (!cancelled) setError(`Could not read deleted bills: ${e instanceof Error ? e.message : String(e)}`) }
    )
    return () => { cancelled = true }
  }, [db])

  const restore = useCallback(async (h: BillHead): Promise<void> => {
    if (!db) return
    try {
      const r = await restoreBills(db, [h.id], { ...withOutbox() })
      if (r.restored.length > 0) {
        setHeads((cur) => (cur ? cur.filter((x) => x.id !== h.id) : cur))
        setNotice(`${h.poNumber} restored.`)
        props.onChanged?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [db, props])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">Your bills could not be opened.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!heads) return <p className="q3-muted" role="status">Loading</p>
  const canWrite = db.canWrite()
  return (
    <div>
      {notice ? <p className="q3-note" role="status">{notice}</p> : null}
      {heads.length === 0 ? <p className="q3-muted">Nothing deleted.</p> : (
        <ul className="q3-list" aria-label="Deleted bills">
          {heads.map((h) => (
            <li key={h.id} className="q3-li">
              <div className="q3-li-btn">
                <span className="q3-li-main">
                  <span className="q3-li-title">{h.partyName || 'No name'}</span>
                  <span className="q3-muted">{h.poNumber} · {formatHistoryDate(h.billDate)} · {formatHistoryTotal(h.grandTotal)}</span>
                </span>
                <button type="button" className="q3-btn" disabled={!canWrite} onClick={() => void restore(h)}>Restore</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!canWrite ? <p className="q3-note">Open in another tab: close it to restore bills here.</p> : null}
    </div>
  )
}
