/**
 * Phase 284 (M25) - "Pick a bill" on the Payments page: search by party / PO number / date over the phone's own bills (existing History reads),
 * choose one, and the page fills the amount with the bill's grand total. Read only: it never changes a bill.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { X } from '@phosphor-icons/react'
import { getBill } from '../../data/billsRepo'
import type { PhoneDb } from '../../data/db'
import { listSearchCandidates } from '../../data/historyRepo'
import type { SearchCandidate } from '../../../shared/history/historySearch'
import { billQrInfo, pickBills, type BillQrInfo } from '../../share/billQr'
import { PAY_WORDS } from './paymentsModel'

export function BillPicker(props: { db: PhoneDb; picked: BillQrInfo | null; onPick: (info: BillQrInfo) => void; onClear: () => void }): ReactElement {
  const { db, picked } = props
  const [cands, setCands] = useState<SearchCandidate[] | null>(null)
  const [query, setQuery] = useState('')
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    let off = false
    void listSearchCandidates(db).then((c) => { if (!off) setCands(c) }, () => { if (!off) setCands([]) })
    return () => { off = true }
  }, [db])

  const rows = useMemo(() => (cands ? pickBills(cands, query) : []), [cands, query])

  const choose = async (id: string): Promise<void> => {
    setWarn(null)
    try { props.onPick(billQrInfo(await getBill(db, id))) } catch { setWarn(PAY_WORDS.pickFailed) }
  }

  return (
    <section className="q3x-pay-pick" aria-label={PAY_WORDS.pickTitle}>
      <h2 className="q3x-pay-pick-title">{PAY_WORDS.pickTitle}</h2>
      {picked ? (
        <div className="q3x-pay-picked" role="status">
          <span className="q3x-pay-picked-text">{picked.line || PAY_WORDS.pickNoName}</span>
          <button type="button" className="q3x-pay-icon" aria-label={PAY_WORDS.pickClear} onClick={props.onClear}><X size={20} weight="light" aria-hidden="true" /></button>
        </div>
      ) : null}
      <input className="q3x-pay-input" aria-label={PAY_WORDS.pickSearch} placeholder={PAY_WORDS.pickSearch} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
      {warn ? <p className="q3x-pay-warn" role="alert">{warn}</p> : null}
      {cands === null ? <p className="q3-muted" role="status">{PAY_WORDS.loading}</p> : rows.length === 0 ? (
        <p className="q3x-pay-empty" role="status">{cands.length === 0 ? PAY_WORDS.pickEmpty : PAY_WORDS.pickNone}</p>
      ) : (
        <ul className="q3x-pay-picklist" aria-label="Bills">
          {rows.map((r) => (
            <li key={r.id} className="q3x-pay-tab-li">
              <button type="button" className="q3x-pay-tab" aria-pressed={picked?.billId === r.id} onClick={() => void choose(r.id)}>
                <span className="q3x-pay-tab-name">{r.partyName.trim() || PAY_WORDS.pickNoName}</span>
                <span className="q3x-pay-tab-sub">{r.poNumber} {'·'} {r.dateText} {'·'} {r.totalText}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
