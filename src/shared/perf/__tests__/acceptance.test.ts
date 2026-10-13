import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_BUDGETS, acceptanceRows, budgetFor, heapGrowthMbPerHour, meetsAcceptance, resultFromSamples } from '../acceptance'
import { createStartupMarks } from '../startupMarks'

describe('acceptance budgets and verdicts', () => {
  it('has one budget per scenario, all positive', () => {
    const ids = ACCEPTANCE_BUDGETS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ACCEPTANCE_BUDGETS.every((b) => b.budget > 0)).toBe(true)
    expect(() => budgetFor('nope' as never)).toThrow()
  })

  it('p95 at the budget passes, over fails, no samples never passes', () => {
    const b = budgetFor('history.firstPage').budget
    expect(meetsAcceptance(resultFromSamples('history.firstPage', [1, 2, b]))).toBe(true)
    expect(meetsAcceptance(resultFromSamples('history.firstPage', [1, 2, b + 1]))).toBe(false)
    expect(meetsAcceptance(resultFromSamples('history.firstPage', []))).toBe(false)
  })

  it('formats PHASE_STATUS table rows with the verdict and notes', () => {
    const rows = acceptanceRows([resultFromSamples('bill.save', [10, 20, 30], 'temp SQLite'), resultFromSamples('bill.save', [500])], '2026-10-10')
    expect(rows[0]).toMatch(/^\| 2026-10-10 \| 68 \| Save a 12-row bill/)
    expect(rows[0]).toContain('within budget')
    expect(rows[0]).toContain('temp SQLite')
    expect(rows[1]).toContain('OVER budget')
  })
})

describe('heapGrowthMbPerHour', () => {
  const at = (i: number): number => i * 60_000
  it('flat heap = 0, a steady climb = its slope, warm-up is ignored', () => {
    expect(heapGrowthMbPerHour(Array.from({ length: 20 }, (_, i) => ({ atMs: at(i), heapMb: 100 })))).toBe(0)
    const climb = Array.from({ length: 20 }, (_, i) => ({ atMs: at(i), heapMb: 100 + i }))
    expect(heapGrowthMbPerHour(climb)).toBeCloseTo(60, 5) // 1 MB per minute
    const warm = Array.from({ length: 20 }, (_, i) => ({ atMs: at(i), heapMb: i < 5 ? 50 + i * 20 : 150 }))
    expect(Math.abs(heapGrowthMbPerHour(warm))).toBeLessThan(1e-6)
  })
  it('too few samples or no time spread = 0', () => {
    expect(heapGrowthMbPerHour([{ atMs: 0, heapMb: 1 }, { atMs: 1, heapMb: 9 }])).toBe(0)
    expect(heapGrowthMbPerHour(Array.from({ length: 8 }, () => ({ atMs: 5, heapMb: 3 })))).toBe(0)
  })
})

describe('startup marks', () => {
  it('records in order, keeps the first time of a repeated name, rounds, survives a broken clock', () => {
    let t = 0
    const m = createStartupMarks(() => (t += 100.4))
    m.mark('a'); m.mark('b'); m.mark('a')
    expect(m.report()).toEqual({ a: 100, b: 201 })
    expect(Object.keys(m.report())).toEqual(['a', 'b'])
    const bad = createStartupMarks(() => { throw new Error('x') })
    expect(() => bad.mark('z')).not.toThrow()
    expect(bad.report()).toEqual({})
  })
})
