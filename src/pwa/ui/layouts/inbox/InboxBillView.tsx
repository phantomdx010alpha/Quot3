import { DotsThree } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Bill } from '../../../../shared/types'
import { BillError, deleteBills, getBill } from '../../../data/billsRepo'
import { withOutbox } from '../../../sync/outbox'
import { buildBillView } from '../../billViewModel'
import { RichName } from '../../RichName'
import { BottomSheet } from '../../kit/BottomSheet'
import { Button } from '../../kit/Button'
import { moneyText, plainNumber } from '../../kit/display'
import { SavedSheet } from '../../kit/SavedSheet'
import { ShareBar } from '../../kit/ShareBar'
import { TotalsBlock } from '../../kit/TotalsBlock'
import { tidyTotals } from '../tidy/tidyTotals'
import type { ScreenProps } from '../types'

const SHOWN = new Set(['qty', 'rate', 'gstRate', 'gstAmt', 'amount', 'total'])

/** Bills inbox bill view (Phase 194): a light "paper" card (# / Item / Qty / Rate / Amount; a GST bill ends Before GST / GST / Total), floating Share and Edit
 *  with bottom padding so they never cover the last row. A screen, not the printed bill. Read-only data; "Edit on PC" for hybrid / transfer / unknown format. */
export function InboxBillView(props: ScreenProps): ReactElement {
  const { db, param: id } = props
  const [bill, setBill] = useState<Bill | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!db || !id) return undefined
    let cancelled = false
    setBill(null); setError(null); setMore(false); setConfirming(false)
    getBill(db, id).then(
      (b) => { if (!cancelled) setBill(b) },
      (e: unknown) => { if (!cancelled) setError(e instanceof BillError && e.code === 'NOT_FOUND' ? 'This bill is not here any more.' : e instanceof Error ? e.message : String(e)) }
    )
    return () => { cancelled = true }
  }, [db, id])

  const view = useMemo(() => (bill ? buildBillView(bill) : null), [bill])
  const totals = useMemo(() => (bill ? tidyTotals(bill) : null), [bill])

  if (!db || !id) return <p className="q3-note q3-note-warn" role="alert">Your bills could not be opened.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!bill || !view || !totals) return <p className="q3-muted" role="status">Loading</p>

  const canWrite = db.canWrite()
  const editBlocked = view.readOnlyReason !== null
  const hybrid = bill.hybrid !== undefined && bill.hybrid !== null
  const others = view.party.filter((f) => f.key !== 'name')

  const doDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      await deleteBills(db, [id], { ...withOutbox() })
      props.onChanged?.(); setMore(false); props.onBack?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); setBusy(false)
    }
  }

  return (
    <article className="q3x-tidy-page q3x-paper-bill" aria-label={`Bill ${view.poNumber}`}>
      <div className="q3x-paper">
        <header className="q3x-paper-head">
          <div className="q3x-tidy-bill-head">
            <h2 className="q3x-paper-party">{view.partyLabel}</h2>
            <Button label="More" hideLabel variant="text" icon={<DotsThree size={26} weight="bold" />} onClick={() => setMore(true)} />
          </div>
          <p className="q3x-paper-sub">{view.poNumber} {'·'} {view.billDate} {'·'} {view.formatLabel}</p>
          {others.map((f) => <p key={f.key} className="q3x-paper-sub">{f.label} {f.value}</p>)}
        </header>
        <table className="q3x-paper-table" aria-label="Items">
          <thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col" className="q3x-paper-num">Qty</th><th scope="col" className="q3x-paper-num">Rate</th><th scope="col" className="q3x-paper-num">Amount</th></tr></thead>
          <tbody>
            {view.items.map((it) => {
              const f = (k: string): string => it.fields.find((x) => x.key === k)?.value ?? ''
              const extras = it.fields.filter((x) => !SHOWN.has(x.key))
              const gst = f('gstRate')
              return (
                <tr key={it.key}>
                  <td className="q3x-paper-slno">{it.slNo}</td>
                  <td className="q3x-paper-name">
                    <RichName runs={it.runs} />
                    {gst !== '' ? <span className="q3x-paper-extra">+{plainNumber(gst)}% GST</span> : null}
                    {extras.length > 0 ? <span className="q3x-paper-extra">{extras.map((x) => `${x.label} ${x.value}`).join(' · ')}</span> : null}
                  </td>
                  <td className="q3x-paper-num">{plainNumber(f('qty'))}</td>
                  <td className="q3x-paper-num">{plainNumber(f('rate'))}</td>
                  <td className="q3x-paper-num">{moneyText(f('amount') || f('total'))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {totals.show ? <TotalsBlock rows={totals.rows} total={totals.total} /> : null}
      </div>
      {view.readOnlyReason ? <p className="q3x-tidy-note" role="note">{view.readOnlyReason}</p> : null}
      {!canWrite ? <p className="q3x-tidy-note">Open in another tab: close it to edit or delete here.</p> : null}

      <div className="q3x-inbox-float">
        {hybrid ? (
          <>
            <p className="q3x-tidy-sub">Hybrid bills are shared from the PC.</p>
            <Button label="Edit on PC" disabled onClick={() => undefined} />
          </>
        ) : (
          <ShareBar db={db} bill={bill} mode="view" onEdit={() => props.onNavigate('create', id)} editLabel={editBlocked ? 'Edit on PC' : 'Edit'} editDisabled={editBlocked || !canWrite} />
        )}
      </div>

      <BottomSheet open={more} title="More" onClose={() => { setMore(false); setConfirming(false) }}>
        <p className="q3x-tidy-text">Version history info: revision {view.revision}</p>
        {confirming ? (
          <div role="alertdialog" aria-label="Delete bill" className="q3x-tidy-confirm">
            <p className="q3x-tidy-text">Move this bill to Recently deleted? You can bring it back.</p>
            <Button label="Delete" variant="primary" disabled={busy} onClick={() => void doDelete()} />
            <Button label="Cancel" disabled={busy} onClick={() => setConfirming(false)} />
          </div>
        ) : (
          <Button label="Delete this bill" disabled={!canWrite} onClick={() => setConfirming(true)} />
        )}
      </BottomSheet>

      <SavedSheet open={props.justSaved === true} bill={bill} db={db} onDone={() => props.onSavedDone?.()} />
    </article>
  )
}
