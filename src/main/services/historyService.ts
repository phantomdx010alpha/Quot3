import type { HistoryRepo, SourceArgs } from '../db/historyRepo'
import { decodeCursor, encodeCursor, HISTORY_PAGE_MAX, HISTORY_PAGE_SIZE } from '../../shared/history/historyList'
import type { BillListItem, HistoryBranch, HistoryDate } from '../../shared/history/historyList'
import { rankBills, SEARCH_LIMIT_DEFAULT, type SearchHit } from '../../shared/history/historySearch'
import { AppError } from '../ipc/envelope'

export interface RangeInput { from?: string; to?: string; source?: 'all' | 'created' | 'imported'; batch?: string }
export interface ListBillsInput extends RangeInput { date?: string; branch?: string; cursor?: string; limit?: number }
export interface SearchInput extends RangeInput { query: string; branch?: string; limit?: number }
export interface SearchResult { items: SearchHit[]; truncated: boolean }
export interface ListBillsResult { items: BillListItem[]; next?: string }

export interface HistoryService {
  listDates(input: RangeInput & { branch?: string }): HistoryDate[]
  listBills(input: ListBillsInput): ListBillsResult
  /** Phase 42: ranked search over party, PO number, item text and amount (optionally inside a date range). */
  search(input: SearchInput): SearchResult
  branches(): HistoryBranch[]
}

const checkRange = ({ from, to }: RangeInput): void => {
  if (from !== undefined && to !== undefined && from > to) throw new AppError('VALIDATION', 'The From date is after the To date')
}

/** Phase 86: `batch` only means something for imported bills (it implies the Imported filter). */
const sourceArgs = (i: RangeInput): SourceArgs => {
  if (i.batch) return { source: 'imported', batch: i.batch }
  return { source: i.source === 'created' || i.source === 'imported' ? i.source : null, batch: null }
}

const branchFilter = (b: string | undefined): string | null => (b === undefined || b === 'all' ? null : b)

/** Phase 41 — read-only History queries (no write path, so it works on a read-only database too). */
export function createHistoryService(repo: HistoryRepo): HistoryService {
  return {
    listDates(i) {
      checkRange(i)
      return repo.listDates(branchFilter(i.branch), i.from ?? null, i.to ?? null, sourceArgs(i))
    },

    listBills({ date, branch, cursor, limit, from, to, source, batch }) {
      checkRange({ from, to })
      const size = Math.min(HISTORY_PAGE_MAX, Math.max(1, Math.floor(limit ?? HISTORY_PAGE_SIZE)))
      const decoded = cursor === undefined ? null : decodeCursor(cursor)
      if (cursor !== undefined && decoded === null) throw new AppError('VALIDATION', 'Invalid page cursor')
      const rows = repo.listBills({ date: date ?? null, branch: branchFilter(branch), from: from ?? null, to: to ?? null, cursor: decoded, limit: size + 1, src: sourceArgs({ source, batch }) })
      const page = rows.slice(0, size)
      const items: BillListItem[] = page.map(({ createdAt: _c, ...item }) => item)
      const result: ListBillsResult = { items }
      if (rows.length > size) {
        const last = page[page.length - 1]!
        result.next = encodeCursor({ date: last.billDate, createdAt: last.createdAt, id: last.id })
      }
      return result
    },

    search(i) {
      checkRange(i)
      const candidates = repo.searchCandidates({ branch: branchFilter(i.branch), from: i.from ?? null, to: i.to ?? null, src: sourceArgs(i) })
      const { hits, truncated } = rankBills(candidates, i.query, i.limit ?? SEARCH_LIMIT_DEFAULT)
      return { items: hits, truncated }
    },

    branches: () => repo.branches()
  }
}
