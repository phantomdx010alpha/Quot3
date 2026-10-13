import { describe, expect, it } from 'vitest'
import { meetsBudget, percentile, perfRowsToMarkdown, summarize } from '../stats'
import { PERF_KEY_HZ, PERF_P95_BUDGET_MS } from '../../constants'

describe('perf stats (Phase 24)', () => {
  it('budget constants: 240 Hz frame is ~4.17 ms and the gate is 4.2', () => {
    expect(PERF_KEY_HZ).toBe(240)
    expect(PERF_P95_BUDGET_MS).toBe(4.2)
    expect(1000 / PERF_KEY_HZ).toBeLessThan(PERF_P95_BUDGET_MS)
  })
  it('percentile is nearest-rank and clamps', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(s, 50)).toBe(5)
    expect(percentile(s, 95)).toBe(10)
    expect(percentile(s, 0)).toBe(1)
    expect(percentile(s, 100)).toBe(10)
    expect(percentile(s, 150)).toBe(10)
    expect(percentile([], 95)).toBe(0)
    expect(percentile([7], 50)).toBe(7)
  })
  it('summarize sorts, ignores NaN/negative, and reports mean/p50/p95/max', () => {
    const r = summarize([10, 1, Number.NaN, 2, -3, 3, 4])
    expect(r).toEqual({ n: 5, mean: 4, p50: 3, p95: 10, max: 10 })
    expect(summarize([])).toEqual({ n: 0, mean: 0, p50: 0, p95: 0, max: 0 })
  })
  it('the p95 rule: 19 fast samples + 1 slow outlier passes, 2 slow outliers fail', () => {
    const fast = Array.from({ length: 18 }, () => 1)
    expect(meetsBudget(summarize([...fast, 1, 50]))).toBe(true) // 20 samples, 1 outlier → rank 19 is fast
    expect(meetsBudget(summarize([...fast, 50, 50]))).toBe(false)
    expect(meetsBudget(summarize([]))).toBe(false)
    expect(meetsBudget(summarize([5]), 6)).toBe(true)
  })
  it('markdown rows match the Performance-log table (7 cells)', () => {
    const md = perfRowsToMarkdown([{ scenario: 'holdDown', metric: 'logic', summary: summarize([1, 2, 3]), notes: 'grids=0' }], { date: '2026-10-08', phase: 24 })
    expect(md).toBe('| 2026-10-08 | 24 | holdDown | 2.00 | 3.00 | 3.00 | logic, n=3, p95 ≤ 4.2; grids=0 |')
    expect(md.split('|').length - 2).toBe(7)
  })
})
