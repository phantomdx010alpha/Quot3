import { useEffect, useState, type ReactElement } from 'react'
import type { Bill } from '../../shared/types'
import { BillError, deleteBills, getBill } from '../data/billsRepo'
import type { PhoneDb } from '../data/db'
import { withOutbox } from '../sync/outbox'
import { buildBillView, type BillView as BillViewData } from './billViewModel'
import { RichName } from './RichName'
import { SharePanel } from './SharePanel'

/** Read-only compact bill (Phase 181): party block, item lines, footer totals, Edit entry point, delete to the trash.
 *  A hybrid bill, a stock transfer or an unknown layout opens here too but offers "Edit on PC" instead of Edit ([A]). */
export function BillView(props: { db: PhoneDb | null; id: string; onEdit: (id: string) => void; onDeleted: () => void; onChanged?: () => void }): ReactElement {
  const { db, id } = props
  const [view, setView] = useState<BillViewData | null>(null)
  const [bill, setBill] = useState<Bill | null>(null)
  const [sharing, setSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    setView(null); setBill(null); setError(null); setConfirming(false); setSharing(false)
    getBill(db, id).then(
      (b) => { if (!cancelled) { setBill(b); setView(buildBillView(b)) } },
      (e: unknown) => { if (!cancelled) setError(e instanceof BillError && e.code === 'NOT_FOUND' ? 'This bill is not here any more.' : e instanceof Error ? e.message : String(e)) }
    )
    return () => { cancelled = true }
  }, [db, id])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">Your bills could not be opened.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!view) return <p className="q3-muted" role="status">Loading</p>

  const canWrite = db.canWrite()
  const doDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      await deleteBills(db, [id], { ...withOutbox() })
      props.onChanged?.()
      props.onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <article className="q3-bill" aria-label={`Bill ${view.poNumber}`}>
      <header className="q3-bill-head">
        <strong>{view.poNumber}</strong>
        <span className="q3-muted">{view.billDate} · {view.formatLabel} · rev {view.revision}</span>
      </header>
      <section className="q3-bill-party" aria-label="Party">
        {view.party.length === 0 ? <div className="q3-muted">No name</div> : view.party.map((f) => (
          <div key={f.key} className="q3-kv"><span className="q3-muted">{f.label}</span><span>{f.value}</span></div>
        ))}
      </section>

      <ol className="q3-bill-items" aria-label="Items">
        {view.items.map((it) => (
          <li key={it.key} className={`q3-bill-item${it.kind === 'adjustment' ? ' is-adjustment' : ''}`}>
            <div className="q3-bill-name"><span className="q3-muted">{it.slNo}</span><span><RichName runs={it.runs} /></span></div>
            {it.fields.length > 0 ? (
              <div className="q3-bill-fields">
                {it.fields.map((f) => <span key={f.key}><span className="q3-muted">{f.label}</span> {f.value}</span>)}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="q3-bill-footer" aria-label="Totals">
        {view.footer.map((l) => (
          <div key={l.key} className={`q3-row${l.strong ? ' q3-strong' : ''}`}><span>{l.label}</span><span>{l.value}</span></div>
        ))}
      </section>

      {view.readOnlyReason ? <p className="q3-note" role="note">{view.readOnlyReason}</p> : null}

      {confirming ? (
        <div className="q3-confirm" role="alertdialog" aria-label="Delete bill">
          <p>Move this bill to Recently deleted? You can bring it back.</p>
          <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void doDelete()}>Delete</button>{' '}
          <button type="button" className="q3-btn" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <div className="q3-actions">
          <button type="button" className="q3-btn q3-btn-primary" disabled={view.readOnlyReason !== null || !canWrite} onClick={() => props.onEdit(id)}>Edit</button>{' '}
          <button type="button" className="q3-btn" disabled={bill?.hybrid !== undefined && bill.hybrid !== null} title={bill?.hybrid ? 'Hybrid bills are shared from the PC' : undefined} aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>Share</button>{' '}
          <button type="button" className="q3-btn" disabled={!canWrite} onClick={() => setConfirming(true)}>Delete</button>
        </div>
      )}
      {sharing && bill ? <SharePanel db={db} bill={bill} /> : null}
      {!canWrite ? <p className="q3-note">Open in another tab: close it to edit or delete here.</p> : null}
    </article>
  )
}
