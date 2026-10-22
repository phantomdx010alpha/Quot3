import { DotsThree } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Bill } from '../../../../shared/types'
import { BillError, deleteBills, getBill } from '../../../data/billsRepo'
import { withOutbox } from '../../../sync/outbox'
import { buildBillView, type ViewItem } from '../../billViewModel'
import { RichName } from '../../RichName'
import { BottomSheet } from '../../kit/BottomSheet'
import { Button } from '../../kit/Button'
import { ItemLine } from '../../kit/ItemLine'
import { SavedSheet } from '../../kit/SavedSheet'
import { ShareBar } from '../../kit/ShareBar'
import { TotalsBlock } from '../../kit/TotalsBlock'
import { tidyTotals } from './tidyTotals'
import type { ScreenProps } from '../types'

const MONEY_AND_QTY = new Set(['qty', 'rate', 'gstRate', 'gstAmt', 'amount', 'total'])
const field = (it: ViewItem, key: string): string => it.fields.find((f) => f.key === key)?.value ?? ''

/** Tidy bill view (Phase 192): party name as the header with PO / date / format under it, two-line item rows, the totals block, and a sticky bar
 *  [Share] [Edit]. "rev" lives in the overflow menu with Delete. Hybrid, stock transfer and unknown-format bills show "Edit on PC". Read-only data. */
export function TidyBillView(props: ScreenProps): ReactElement {
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
      props.onChanged?.()
      setMore(false)
      props.onBack?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <article className="q3x-tidy-page q3x-tidy-bill" aria-label={`Bill ${view.poNumber}`}>
      <header className="q3x-tidy-bill-head">
        <div className="q3x-tidy-bill-headtext">
          <h2 className="q3x-tidy-party">{view.partyLabel}</h2>
          <p className="q3x-tidy-sub">{view.poNumber} {'\u00b7'} {view.billDate} {'\u00b7'} {view.formatLabel}</p>
        </div>
        <Button label="More" hideLabel variant="text" icon={<DotsThree size={26} weight="bold" />} onClick={() => setMore(true)} />
      </header>
      {others.length > 0 ? (
        <div className="q3x-tidy-details">
          {others.map((f) => <p key={f.key} className="q3x-tidy-sub"><span>{f.label}</span> {f.value}</p>)}
        </div>
      ) : null}

      <ol className="q3x-tidy-list" aria-label="Items">
        {view.items.map((it) => {
          const extras = it.fields.filter((f) => !MONEY_AND_QTY.has(f.key))
          return (
            <li key={it.key} className="q3x-tidy-li q3x-tidy-itemli">
              <ItemLine
                name={<RichName runs={it.runs} />} amount={field(it, 'amount') || field(it, 'total')}
                qty={field(it, 'qty')} rate={field(it, 'rate')} gstPct={field(it, 'gstRate')} priceSetByUser={it.overridden}
              />
              {extras.length > 0 ? <p className="q3x-item-detail">{extras.map((f) => `${f.label} ${f.value}`).join(' \u00b7 ')}</p> : null}
            </li>
          )
        })}
      </ol>

      {totals.show ? <TotalsBlock rows={totals.rows} total={totals.total} /> : null}

      {view.readOnlyReason ? <p className="q3x-tidy-note" role="note">{view.readOnlyReason}</p> : null}
      {!canWrite ? <p className="q3x-tidy-note">Open in another tab: close it to edit or delete here.</p> : null}

      <div className="q3x-tidy-stickybar">
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
