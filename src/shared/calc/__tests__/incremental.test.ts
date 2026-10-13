import { describe, it, expect } from 'vitest'
import { calcStats } from '../rowCalc'
import { computeBill } from '../billTotals'
import { getFormat } from '../../format/registry'
import { createEmptyRow } from '../../billModel'
import type { BillRow } from '../../types'

const fmt = getFormat('non_gst')
const mk = (i: number, qty: string, rate: string): BillRow => ({ ...createEmptyRow(i, () => `r${i}`), nameRuns: [{ t: `item ${i}` }], qty, rate })

describe('Phase 13 incremental calculation', () => {
  const rows = Array.from({ length: 80 }, (_, i) => mk(i, String(i + 1), '10'))
  it('first compute calcs every row; an identical recompute calcs none', () => {
    const before = calcStats.computed
    const a = computeBill(fmt, rows)
    expect(calcStats.computed - before).toBe(80)
    const b = computeBill(fmt, rows)
    expect(calcStats.computed - before).toBe(80)
    expect(b.grandTotal).toBe(a.grandTotal)
  })
  it('changing one row recalcs exactly that row; footer is correct', () => {
    computeBill(fmt, rows)
    const edited = rows.slice()
    edited[40] = { ...rows[40]!, qty: '100' }
    const before = calcStats.computed
    const t = computeBill(fmt, edited)
    expect(calcStats.computed - before).toBe(1)
    const full = rows.reduce((n, r, i) => n + (i === 40 ? 1000 : Number(r.qty) * 10), 0)
    expect(Number(t.grandTotal)).toBe(full)
  })
  it('a cached result is per format (GST rows are not served from the non-GST cache)', () => {
    const gst = getFormat('gst')
    const r = { ...rows[0]!, gstRate: '18' }
    expect(computeBill(fmt, [r]).display[0]!.cells.gstAmt).toBe('')
    expect(computeBill(gst, [r]).display[0]!.cells.gstAmt).toBe('1.80')
  })
  it('perf note: 80-row recompute after one edit (log only, not asserted)', () => {
    computeBill(fmt, rows)
    const edited = rows.slice(); edited[10] = { ...rows[10]!, rate: '11' }
    const N = 200
    const t0 = performance.now()
    let cur = edited
    for (let i = 0; i < N; i++) { cur = cur.slice(); cur[10] = { ...cur[10]!, rate: String(11 + (i % 2)) }; computeBill(fmt, cur) }
    // eslint-disable-next-line no-console
    console.log(`PERF phase13 computeBill 80 rows, 1 row edited: ${((performance.now() - t0) / N).toFixed(3)} ms/recompute`)
    expect(true).toBe(true)
  })
})
