import { MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { HISTORY_PAGE_SIZE } from '../../shared/history/historyList'
import type { SearchCandidate } from '../../shared/history/historySearch'
import type { PhoneDb } from '../data/db'
import { countTrashed, listSearchCandidates } from '../data/historyRepo'
import { buildHistory, DEFAULT_RANGE, listTotal, RANGES, type RangeKey } from './historyModel'
import { localIsoDate } from './dashboardModel'

function BillRowButton(props: { id: string; partyName: string; poNumber: string; billDate?: string; total: string; onOpen: (id: string) => void }): ReactElement {
  return (
    <li className="q3-li">
      <button type="button" className="q3-li-btn" onClick={() => props.onOpen(props.id)}>
        <span className="q3-li-main">
          <span className="q3-li-title">{props.partyName || 'No name'}</span>
          <span className="q3-muted">{props.poNumber}{props.billDate ? ` · ${props.billDate}` : ''}</span>
        </span>
        <span className="q3-li-amount">{props.total}</span>
      </button>
    </li>
  )
}

/** Phone History (Phase 181): date-grouped list, search (party, PO number, item text, amount), range chips, Recently deleted entry. Read-only. */
export function History(props: { db: PhoneDb | null; now?: () => Date; onOpenBill: (id: string) => void; onOpenTrash: () => void }): ReactElement {
  const { db } = props
  const [candidates, setCandidates] = useState<SearchCandidate[] | null>(null)
  const [trashed, setTrashed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE)
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE)

  useEffect(() => {
    if (!db) return undefined
    let cancelled = false
    Promise.all([listSearchCandidates(db), countTrashed(db)]).then(
      ([c, t]) => { if (!cancelled) { setCandidates(c); setTrashed(t) } },
      (e: unknown) => { if (!cancelled) setError(`Could not read your bills: ${e instanceof Error ? e.message : String(e)}`) }
    )
    return () => { cancelled = true }
  }, [db])

  const today = localIsoDate(props.now ? props.now() : new Date())
  const result = useMemo(() => (candidates ? buildHistory(candidates, { query, range, today, limit }) : null), [candidates, query, range, today, limit])

  if (!db) return <p className="q3-note q3-note-warn" role="alert">Your bills could not be opened.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!result) return <p className="q3-muted" role="status">Loading</p>

  return (
    <div className="q3-history">
      <div className="q3-search">
        <MagnifyingGlass size={18} weight="light" aria-hidden="true" />
        <input type="search" aria-label="Search bills" placeholder="Party, PO number, item or amount" enterKeyHint="search" autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(HISTORY_PAGE_SIZE) }} />
      </div>
      {result.searching ? null : (
        <div className="q3-chips" role="group" aria-label="Show">
          {RANGES.map((r) => (
            <button key={r.key} type="button" className="q3-chip" aria-pressed={range === r.key} onClick={() => { setRange(r.key); setLimit(HISTORY_PAGE_SIZE) }}>{r.label}</button>
          ))}
        </div>
      )}

      {result.searching ? (
        result.items.length === 0 ? <p className="q3-muted">No bills match.</p> : (
          <ul className="q3-list" aria-label="Search results">
            {result.items.map((b) => <BillRowButton key={b.id} id={b.id} partyName={b.partyName} poNumber={b.poNumber} billDate={b.billDate} total={listTotal(b.grandTotal)} onOpen={props.onOpenBill} />)}
          </ul>
        )
      ) : result.groups.length === 0 ? (
        <p className="q3-muted">{candidates && candidates.length === 0 ? 'No bills yet. Tap New to make one.' : 'No bills in this range. Try All.'}</p>
      ) : (
        result.groups.map((g) => (
          <section key={g.date} aria-label={g.label}>
            <h2 className="q3-h2 q3-day"><span>{g.label}</span><span>{g.count} · {g.total}</span></h2>
            <ul className="q3-list">
              {g.items.map((b) => <BillRowButton key={b.id} id={b.id} partyName={b.partyName} poNumber={b.poNumber} total={listTotal(b.grandTotal)} onOpen={props.onOpenBill} />)}
            </ul>
          </section>
        ))
      )}

      {result.hiddenCount > 0 ? <button type="button" className="q3-btn" onClick={() => setLimit((n) => n + HISTORY_PAGE_SIZE)}>Show {Math.min(HISTORY_PAGE_SIZE, result.hiddenCount)} more ({result.hiddenCount} hidden)</button> : null}

      <button type="button" className="q3-btn q3-trash-link" onClick={props.onOpenTrash}>
        <Trash size={18} weight="light" aria-hidden="true" /> Recently deleted{trashed > 0 ? ` (${trashed})` : ''}
      </button>
    </div>
  )
}
