import { z } from 'zod'
import type { HistoryService } from '../services/historyService'
import { HISTORY_PAGE_MAX } from '../../shared/history/historyList'
import { SEARCH_LIMIT_MAX, SEARCH_QUERY_MAX } from '../../shared/history/historySearch'
import { wrapHandler } from './envelope'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const branch = z.string().min(1).max(64)
const empty = z.object({}).strict()
const srcFields = { source: z.enum(['all', 'created', 'imported']).optional(), batch: z.string().min(1).max(64).optional() }
const datesInput = z.object({ branch: branch.optional(), from: isoDate.optional(), to: isoDate.optional(), ...srcFields }).strict()
const billsInput = z
  .object({
    date: isoDate.optional(),
    branch: branch.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    ...srcFields,
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(HISTORY_PAGE_MAX).optional()
  })
  .strict()

const searchInput = z
  .object({ query: z.string().max(SEARCH_QUERY_MAX), branch: branch.optional(), from: isoDate.optional(), to: isoDate.optional(), ...srcFields, limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional() })
  .strict()

/** `history:*` handlers (Phase 41 lists, Phase 42 search + date range). IPC calls the service only. */
export function historyHandlers(svc: HistoryService): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'history:listDates': wrapHandler(datesInput, (i) => svc.listDates(i)),
    'history:listBills': wrapHandler(billsInput, (i) => svc.listBills(i)),
    'history:search': wrapHandler(searchInput, (i) => svc.search(i)),
    'history:branches': wrapHandler(empty, () => svc.branches())
  }
}
