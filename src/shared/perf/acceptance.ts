import { summarize, type PerfSummary } from './stats'

/**
 * Phase 68 - performance acceptance: the budgets, the verdict and the report rows. Pure (timings and memory are plain
 * numbers, not money). The measurements themselves live in `src/main/perf/__tests__/acceptance.test.ts` (run with
 * `npm run perf:acceptance`); this file only decides pass / fail and formats the rows for `PHASE_STATUS.md`.
 *
 * The budgets below are PROPOSED by Phase 68 (the owner never stated numbers for these scenarios); each one is a p95 in
 * milliseconds unless the unit says otherwise. They are deliberately generous for a mid-range office PC; the keystroke
 * budget (4.2 ms) stays in `shared/constants.ts` and is not repeated here.
 */
export type AcceptanceId =
  | 'startup.dbOpenEmpty'
  | 'startup.dbOpenLarge'
  | 'startup.windowShown'
  | 'history.listDates'
  | 'history.firstPage'
  | 'history.pageDeep'
  | 'history.search'
  | 'customers.list'
  | 'customers.partyIndexBuild'
  | 'customers.partySearch'
  | 'customers.pageFilter'
  | 'bill.save'
  | 'print.buildHtml'
  | 'print.pdf'
  | 'image.capture'
  | 'memory.soakGrowth'

export interface AcceptanceBudget {
  id: AcceptanceId
  label: string
  /** ms for timings; MB per hour for `memory.soakGrowth`. */
  budget: number
  unit: 'ms' | 'MB/h'
}

export const ACCEPTANCE_BUDGETS: readonly AcceptanceBudget[] = [
  { id: 'startup.dbOpenEmpty', label: 'Startup: open + migrate a new database', budget: 1500, unit: 'ms' },
  { id: 'startup.dbOpenLarge', label: 'Startup: reopen a database with 5 000 bills / 2 000 parties', budget: 500, unit: 'ms' },
  { id: 'startup.windowShown', label: 'Startup: process start to window shown (real app only)', budget: 3000, unit: 'ms' },
  { id: 'history.listDates', label: 'History: dates list, 5 000 bills', budget: 50, unit: 'ms' },
  { id: 'history.firstPage', label: 'History: first page of bills, 5 000 bills', budget: 50, unit: 'ms' },
  { id: 'history.pageDeep', label: 'History: a page far down the list (keyset cursor)', budget: 50, unit: 'ms' },
  { id: 'history.search', label: 'History: search over 5 000 bills (party / PO / item / amount)', budget: 250, unit: 'ms' },
  { id: 'customers.list', label: 'Customers: list + bill stats, 2 000 parties', budget: 150, unit: 'ms' },
  { id: 'customers.partyIndexBuild', label: 'Create: party autocomplete index build, 2 000 parties', budget: 200, unit: 'ms' },
  { id: 'customers.partySearch', label: 'Create: party autocomplete per keystroke, 2 000 parties', budget: 16, unit: 'ms' },
  { id: 'customers.pageFilter', label: 'Customers: page search box per keystroke, 2 000 rows', budget: 16, unit: 'ms' },
  { id: 'bill.save', label: 'Save a 12-row bill into a 5 000-bill database', budget: 100, unit: 'ms' },
  { id: 'print.buildHtml', label: 'Print: build the HTML for an 80-row bill', budget: 100, unit: 'ms' },
  { id: 'print.pdf', label: 'Print: HTML to PDF (one real Chromium run, includes browser start)', budget: 4000, unit: 'ms' },
  { id: 'image.capture', label: 'Image: HTML to PNG (one real Chromium run, includes browser start)', budget: 4000, unit: 'ms' },
  { id: 'memory.soakGrowth', label: 'Memory: heap growth after warm-up during a soak', budget: 50, unit: 'MB/h' }
]

export const budgetFor = (id: AcceptanceId): AcceptanceBudget => {
  const b = ACCEPTANCE_BUDGETS.find((x) => x.id === id)
  if (!b) throw new Error(`No acceptance budget for ${id}`)
  return b
}

export interface AcceptanceResult {
  id: AcceptanceId
  summary: PerfSummary
  notes?: string
}

/** p95 at or under the budget; an empty summary never passes (same rule as the Phase 24 gate). */
export function meetsAcceptance(r: AcceptanceResult): boolean {
  return r.summary.n > 0 && r.summary.p95 <= budgetFor(r.id).budget
}

const fix = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(2))

/** Rows for the Performance log table in `PHASE_STATUS.md` (`| Date | Phase | Scenario | p50 | p95 | max | Notes |`). */
export function acceptanceRows(results: readonly AcceptanceResult[], date: string, phase = 68): string[] {
  return results.map((r) => {
    const b = budgetFor(r.id)
    const verdict = meetsAcceptance(r) ? 'within budget' : 'OVER budget'
    const note = `n=${r.summary.n}; budget p95 ${b.budget} ${b.unit}: ${verdict}.${r.notes ? ' ' + r.notes : ''}`
    return `| ${date} | ${phase} | ${b.label} | ${fix(r.summary.p50)} | ${fix(r.summary.p95)} | ${fix(r.summary.max)} | ${note} |`
  })
}

export const resultFromSamples = (id: AcceptanceId, samples: readonly number[], notes?: string): AcceptanceResult => ({ id, summary: summarize(samples), ...(notes ? { notes } : {}) })

export interface HeapSample { atMs: number; heapMb: number }

/**
 * Least-squares slope of heap size over time, in MB per hour. The first `warmupFraction` of the samples is dropped (caches
 * and JIT fill up at the start of every run and are not a leak). Fewer than 4 samples left = 0 (cannot tell).
 */
export function heapGrowthMbPerHour(samples: readonly HeapSample[], warmupFraction = 0.25): number {
  const kept = samples.slice(Math.floor(samples.length * warmupFraction))
  if (kept.length < 4) return 0
  const n = kept.length
  const mx = kept.reduce((a, s) => a + s.atMs, 0) / n
  const my = kept.reduce((a, s) => a + s.heapMb, 0) / n
  let num = 0
  let den = 0
  for (const s of kept) { num += (s.atMs - mx) * (s.heapMb - my); den += (s.atMs - mx) ** 2 }
  if (den === 0) return 0
  return (num / den) * 3_600_000
}
