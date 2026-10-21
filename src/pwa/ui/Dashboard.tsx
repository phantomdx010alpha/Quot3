import type { ReactElement } from 'react'
import type { DashboardView } from './dashboardModel'

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1] ?? key} ${y ?? ''}`.trim()
}

const billsWord = (n: number): string => `${n} ${n === 1 ? 'bill' : 'bills'}`

/** Compact phone Dashboard (Phase 180): today and month totals, recent bills, sync status, last export. No live tiles, no big cards. */
export function Dashboard(props: { view: DashboardView | null; error?: string | null; onOpenBill?: (id: string) => void }): ReactElement {
  const { view } = props
  if (props.error) return <p className="q3-note q3-note-warn" role="alert">{props.error}</p>
  if (!view) return <p className="q3-muted" role="status">Loading</p>
  return (
    <div className="q3-dash">
      <section className="q3-tiles" aria-label="Totals">
        <div className="q3-tile" data-testid="tile-today">
          <span className="q3-tile-label">Today</span>
          <strong className="q3-tile-total">{view.today.total}</strong>
          <span className="q3-muted">{billsWord(view.today.count)}</span>
        </div>
        <div className="q3-tile" data-testid="tile-month">
          <span className="q3-tile-label">{monthLabel(view.month.month)}</span>
          <strong className="q3-tile-total">{view.month.total}</strong>
          <span className="q3-muted">{billsWord(view.month.count)}</span>
        </div>
      </section>

      <section aria-label="Recent bills">
        <h2 className="q3-h2">Recent bills</h2>
        {view.recent.length === 0 ? (
          <p className="q3-muted">No bills yet. Tap New to make one.</p>
        ) : (
          <ul className="q3-list">
            {view.recent.map((b) => {
              const inner = (
                <>
                  <span className="q3-li-main">
                    <span className="q3-li-title">{b.partyName || 'No name'}</span>
                    <span className="q3-muted">{b.poNumber} · {b.billDate}</span>
                  </span>
                  <span className="q3-li-amount">{b.total}</span>
                </>
              )
              return (
                <li key={b.id} className="q3-li">
                  {props.onOpenBill ? <button type="button" className="q3-li-btn" onClick={() => props.onOpenBill?.(b.id)}>{inner}</button> : <div className="q3-li-btn">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-label="Status" className="q3-status">
        <div className="q3-row" data-testid="sync-line">
          <span>Sync</span>
          <span className={`q3-tone-${view.sync.tone}`}>{view.sync.text}</span>
        </div>
        {view.sync.detail ? <p className="q3-note">{view.sync.detail}</p> : null}
        <div className="q3-row" data-testid="backup-line">
          <span>Last export</span>
          <span className={`q3-tone-${view.backup.tone === 'ok' ? 'ok' : 'warn'}`}>{view.backup.text}</span>
        </div>
        {view.backup.note ? <p className="q3-note">{view.backup.note}</p> : null}
      </section>
    </div>
  )
}
