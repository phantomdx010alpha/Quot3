import { PERF_P95_BUDGET_MS } from '../constants'

/** Phase 24 — pure timing statistics for the grid perf harness. Timings are plain milliseconds (not money), so `number` is correct here. */

export interface PerfSummary {
  n: number
  mean: number
  p50: number
  p95: number
  max: number
}

/** Nearest-rank percentile of an ascending-sorted list (p in 0..100). Empty list → 0. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number
}

export function summarize(samples: readonly number[]): PerfSummary {
  const clean = samples.filter((x) => Number.isFinite(x) && x >= 0)
  if (clean.length === 0) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...clean].sort((a, b) => a - b)
  let sum = 0
  for (const x of sorted) sum += x
  return { n: sorted.length, mean: sum / sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] as number }
}

/** The gate: p95 at or under the budget. A summary with no samples never passes. */
export function meetsBudget(s: PerfSummary, budgetMs: number = PERF_P95_BUDGET_MS): boolean {
  return s.n > 0 && s.p95 <= budgetMs
}

export interface PerfRow {
  scenario: string
  /** `logic` = keydown dispatch → DOM updated (synchronous); `paint` = keydown → next frame painted. */
  metric: 'logic' | 'paint'
  summary: PerfSummary
  notes?: string
}

const f = (x: number): string => x.toFixed(2)

/** Rows in the `PHASE_STATUS.md` "Performance log" table format: Date | Phase | Scenario | p50 | p95 | max | Notes. */
export function perfRowsToMarkdown(rows: readonly PerfRow[], opts: { date: string; phase: number | string }): string {
  return rows
    .map((r) => {
      const verdict = meetsBudget(r.summary) ? `p95 ≤ ${PERF_P95_BUDGET_MS}` : `p95 > ${PERF_P95_BUDGET_MS}`
      const notes = [`${r.metric}, n=${r.summary.n}, ${verdict}`, r.notes].filter(Boolean).join('; ')
      return `| ${opts.date} | ${opts.phase} | ${r.scenario} | ${f(r.summary.p50)} | ${f(r.summary.p95)} | ${f(r.summary.max)} | ${notes} |`
    })
    .join('\n')
}
