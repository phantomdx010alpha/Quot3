import type { ReactElement } from 'react'
import { BillRow } from './TidyRows'
import type { ScreenProps } from '../types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (key: string): string => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1] ?? key} ${y ?? ''}`.trim() }
const billsWord = (n: number): string => `${n} ${n === 1 ? 'bill' : 'bills'}`

/** Tidy Home (Phase 192): today / month tiles and the recent bills as two-line rows (party names wrap). Reads what App.tsx loaded. */
export function TidyHome(props: ScreenProps): ReactElement {
  const d = props.dashboard
  if (d?.error) return <p className="q3-note q3-note-warn" role="alert">{d.error}</p>
  const view = d?.view ?? null
  if (!view) return <p className="q3-muted" role="status">Loading</p>
  return (
    <div className="q3x-tidy-page">
      <section className="q3x-tidy-tiles" aria-label="Totals">
        <div className="q3x-tidy-tile" data-testid="tile-today">
          <span className="q3x-tidy-tile-label">Today</span>
          <strong className="q3x-amount-grand">{view.today.total}</strong>
          <span className="q3x-tidy-sub">{billsWord(view.today.count)}</span>
        </div>
        <div className="q3x-tidy-tile" data-testid="tile-month">
          <span className="q3x-tidy-tile-label">{monthLabel(view.month.month)}</span>
          <strong className="q3x-amount-grand">{view.month.total}</strong>
          <span className="q3x-tidy-sub">{billsWord(view.month.count)}</span>
        </div>
      </section>
      <section aria-label="Recent bills">
        <h2 className="q3x-tidy-h2">Recent bills</h2>
        {view.recent.length === 0 ? <p className="q3-muted">No bills yet. Tap the + button to make one.</p> : (
          <ul className="q3x-tidy-list">
            {view.recent.map((b) => <BillRow key={b.id} id={b.id} party={b.partyName} sub={`${b.poNumber} \u00b7 ${b.billDate}`} total={b.total} onOpen={(id) => props.onNavigate('billview', id)} />)}
          </ul>
        )}
      </section>
    </div>
  )
}
