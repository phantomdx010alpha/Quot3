import { formatHistoryDate, formatHistoryTotal, HISTORY_PAGE_SIZE, type BillListItem } from '../../shared/history/historyList'
import { rankBills, type SearchCandidate } from '../../shared/history/historySearch'
import { addDays } from '../../shared/dashboard/dashboardStats'
import { fmtMoney, sum, toMoney, tryD, type Decimal } from '../../shared/money'

/** Pure History model for the phone (Phase 181): range filter, search, date groups. Search ranking is the shared desktop `rankBills`. */
export type RangeKey = 'today' | '7d' | '30d' | 'all'
export const RANGES: readonly { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All' }
]
/** Default range [A] (desktop default is 30 days, `history.defaultDays`). */
export const DEFAULT_RANGE: RangeKey = '30d'

/** First included bill date for a range, or null for "all". */
export function rangeStart(range: RangeKey, today: string): string | null {
  switch (range) {
    case 'today': return today
    case '7d': return addDays(today, -6)
    case '30d': return addDays(today, -29)
    default: return null
  }
}

export interface DateGroup {
  date: string
  /** "Today", "Yesterday" or dd-mm-yy. */
  label: string
  count: number
  /** Display total of the day, e.g. "₹1,250.00". */
  total: string
  items: BillListItem[]
}

export interface HistoryResult {
  /** Bills after the range / search, in display order (newest first, or best match first while searching). */
  items: BillListItem[]
  searching: boolean
  /** Bills hidden by the page cap. */
  hiddenCount: number
  groups: DateGroup[]
}

const dayLabel = (date: string, today: string): string => (date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : formatHistoryDate(date))

export function groupByDate(items: readonly BillListItem[], today: string): DateGroup[] {
  const groups: DateGroup[] = []
  const totals: Decimal[][] = []
  for (const it of items) {
    const last = groups[groups.length - 1]
    if (last && last.date === it.billDate) {
      last.items.push(it)
      last.count++
      const d = tryD(it.grandTotal)
      if (d) totals[totals.length - 1]!.push(d)
    } else {
      groups.push({ date: it.billDate, label: dayLabel(it.billDate, today), count: 1, total: '', items: [it] })
      const d = tryD(it.grandTotal)
      totals.push(d ? [d] : [])
    }
  }
  groups.forEach((g, i) => { g.total = fmtMoney(toMoney(sum(totals[i]!)), { indian: true, symbol: true }) })
  return groups
}

/** `candidates` must already be newest first (as `listBillHeads` returns). A non-empty query searches ALL dates (the range is ignored, as on desktop). */
export function buildHistory(candidates: readonly SearchCandidate[], o: { query: string; range: RangeKey; today: string; limit?: number }): HistoryResult {
  const limit = o.limit ?? HISTORY_PAGE_SIZE
  const query = o.query.trim()
  const searching = query !== ''
  let all: BillListItem[]
  if (searching) {
    all = rankBills(candidates, query, 1000).hits.map(({ score: _s, matchedOn: _m, ...item }) => item)
  } else {
    const start = rangeStart(o.range, o.today)
    all = candidates.filter((c) => start === null || (c.billDate >= start)).map(({ itemText: _t, ...item }) => item)
  }
  const items = all.slice(0, limit)
  return { items, searching, hiddenCount: all.length - items.length, groups: searching ? [] : groupByDate(items, o.today) }
}

export const listTotal = (grandTotal: string): string => formatHistoryTotal(grandTotal)
