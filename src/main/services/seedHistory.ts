import type { BillService } from './billService'
import { historicalBills, HISTORICAL_BILL_COUNT } from '../../shared/__fixtures__/historicalBills'

/**
 * Phase 32 — dev/test only: saves the thirty deterministic historical bills THROUGH the real save path (PO numbers, parties,
 * revisions, totals cache all as in production). Refuses to touch a database that already has any bill (trashed ones included),
 * so it can never mix fixtures into the owner's real data. Returns how many bills were saved.
 */
export function seedHistoricalBills(
  svc: Pick<BillService, 'save'>,
  sqlite: { prepare(sql: string): { get(): unknown } },
  count: number = HISTORICAL_BILL_COUNT
): number {
  const existing = (sqlite.prepare('SELECT count(*) AS c FROM bills').get() as { c: number }).c
  if (existing > 0) return 0
  let n = 0
  for (const b of historicalBills(count)) {
    svc.save({ bill: { id: `hist-${String(n + 1).padStart(2, '0')}`, ...b } })
    n++
  }
  return n
}
