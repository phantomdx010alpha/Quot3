import { MagnifyingGlass, Trash } from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { HISTORY_PAGE_SIZE } from '../../../../shared/history/historyList'
import type { SearchCandidate } from '../../../../shared/history/historySearch'
import { countTrashed, listSearchCandidates } from '../../../data/historyRepo'
import { localIsoDate } from '../../dashboardModel'
import { buildHistory, DEFAULT_RANGE, listTotal, RANGES, type RangeKey } from '../../historyModel'
import { BillRow } from './TidyRows'
import { SegmentedControl } from '../../kit/SegmentedControl'
import { Button } from '../../kit/Button'
import type { ScreenProps } from '../types'

/** Tidy Bills (Phase 192): the History model (search, range, date groups) with two-line rows; party names wrap. Read-only. */
export function TidyBills(props: ScreenProps): ReactElement {
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
  const open = (id: string): void => props.onNavigate('billview', id)

  if (!db) return <p className="q3-note q3-note-warn" role="alert">Your bills could not be opened.</p>
  if (error) return <p className="q3-note q3-note-warn" role="alert">{error}</p>
  if (!result) return <p className="q3-muted" role="status">Loading</p>

  return (
    <div className="q3x-tidy-page">
      <div className="q3x-tidy-search">
        <MagnifyingGlass size={20} weight="light" aria-hidden="true" />
        <input type="search" className="q3x-tidy-search-input" aria-label="Search bills" placeholder="Party, PO number, item or amount" enterKeyHint="search" autoComplete="off" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(HISTORY_PAGE_SIZE) }} />
      </div>
      {result.searching ? null : (
        <SegmentedControl ariaLabel="Show" value={range} onChange={(r) => { setRange(r); setLimit(HISTORY_PAGE_SIZE) }} options={RANGES.map((r) => ({ id: r.key, label: r.label }))} />
      )}
      {result.searching ? (
        result.items.length === 0 ? <p className="q3-muted">No bills match.</p> : (
          <ul className="q3x-tidy-list" aria-label="Search results">
            {result.items.map((b) => <BillRow key={b.id} id={b.id} party={b.partyName} sub={`${b.poNumber} \u00b7 ${b.billDate}`} total={listTotal(b.grandTotal)} onOpen={open} />)}
          </ul>
        )
      ) : result.groups.length === 0 ? (
        <p className="q3-muted">{candidates && candidates.length === 0 ? 'No bills yet. Tap the + button to make one.' : 'No bills in this range. Try All.'}</p>
      ) : (
        result.groups.map((g) => (
          <section key={g.date} aria-label={g.label}>
            <h2 className="q3x-tidy-h2 q3x-tidy-day"><span>{g.label}</span><span>{g.count} {'\u00b7'} {g.total}</span></h2>
            <ul className="q3x-tidy-list">
              {g.items.map((b) => <BillRow key={b.id} id={b.id} party={b.partyName} sub={b.poNumber} total={listTotal(b.grandTotal)} onOpen={open} />)}
            </ul>
          </section>
        ))
      )}
      {result.hiddenCount > 0 ? <Button label={`Show ${Math.min(HISTORY_PAGE_SIZE, result.hiddenCount)} more (${result.hiddenCount} hidden)`} onClick={() => setLimit((n) => n + HISTORY_PAGE_SIZE)} /> : null}
      <Button label={`Recently deleted${trashed > 0 ? ` (${trashed})` : ''}`} variant="text" icon={<Trash size={20} weight="light" />} onClick={() => props.onNavigate('trash')} />
    </div>
  )
}
