import { describe, expect, it } from 'vitest'
import { GST, NON_GST } from '../../__fixtures__/formats'
import { sum } from '../../money'
import type { BillRow } from '../../types'
import { classifyRow } from '../classifyRow'
import { calcRow } from '../rowCalc'
import { computeBill } from '../billTotals'

// Seeded PRNG (mulberry32) — deterministic property tests without extra dependencies.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
const num = (r: () => number, maxInt: number, dp: number): string => {
  const whole = Math.floor(r() * maxInt)
  const frac = dp ? String(Math.floor(r() * 10 ** dp)).padStart(dp, '0') : ''
  return frac ? `${whole}.${frac}` : String(whole)
}

function randomRow(r: () => number, i: number): BillRow {
  const named = r() < 0.85
  const kind = pick(r, ['item', 'item', 'item', 'adj', 'blank', 'partial'] as const)
  const base: BillRow = { id: `p${i}`, idx: i, nameRuns: named ? [{ t: `n${i}` }] : [], qty: null, rate: null, totalOverride: null, gstRate: r() < 0.7 ? pick(r, ['0', '5', '12', '18', '28']) : null, extras: {} }
  if (kind === 'item') {
    base.qty = r() < 0.9 ? num(r, 100, 2) : null
    base.rate = r() < 0.9 ? num(r, 1000, 2) : null
    if (r() < 0.1) base.totalOverride = num(r, 5000, 3)
  } else if (kind === 'adj') {
    base.nameRuns = [{ t: `adj${i}` }]
    base.totalOverride = (r() < 0.6 ? '-' : '') + num(r, 500, 2)
  } else if (kind === 'partial') base.totalOverride = r() < 0.5 ? num(r, 100, 0) : null
  return base
}
const randomBill = (r: () => number, n: number): BillRow[] => Array.from({ length: n }, (_, i) => randomRow(r, i))

describe('property tests', () => {
  for (const fmt of [NON_GST, GST]) {
    it(`${fmt.id}: footer = sum of rows; grand = items + adjustments (200 random bills)`, () => {
      const r = rng(1234)
      for (let k = 0; k < 200; k++) {
        const rows = randomBill(r, 1 + Math.floor(r() * 40))
        const out = computeBill(fmt, rows)
        const calcs = rows.map((x) => ({ x, c: calcRow(fmt, x), kind: classifyRow(x) }))
        const items = calcs.filter((e) => e.kind === 'item' && e.c.total !== null)
        const adjs = calcs.filter((e) => e.kind === 'adjustment')
        expect(out.itemsTotal).toBe(sum(items.map((e) => e.c.total!)).toFixed(2))
        expect(out.adjustmentsTotal).toBe(sum(adjs.map((e) => e.c.total ?? '0')).toFixed(2))
        const base = fmt.footer === 'total_gst_amount' ? sum(items.map((e) => e.c.amount ?? e.c.total!)) : sum(items.map((e) => e.c.total!))
        expect(out.grandTotal).toBe(base.plus(sum(adjs.map((e) => e.c.total ?? '0'))).toFixed(2))
        expect(out.counts.paperRows).toBe(out.counts.itemRows + out.counts.adjustmentRows)
        // Sl.No is a gapless 1..n over exactly the numbered rows
        const nums = Object.values(out.slNo).filter((v): v is number => v !== null).sort((a, b) => a - b)
        expect(nums).toEqual(nums.map((_, i) => i + 1))
      }
    })

    it(`${fmt.id}: totals are order-independent (rows shuffled)`, () => {
      const r = rng(99)
      for (let k = 0; k < 100; k++) {
        const rows = randomBill(r, 2 + Math.floor(r() * 30))
        const shuffled = [...rows].sort(() => r() - 0.5)
        const a = computeBill(fmt, rows)
        const b = computeBill(fmt, shuffled)
        expect([b.itemsTotal, b.itemsGst, b.itemsAmount, b.adjustmentsTotal, b.grandTotal, b.counts]).toEqual([a.itemsTotal, a.itemsGst, a.itemsAmount, a.adjustmentsTotal, a.grandTotal, a.counts])
      }
    })
  }

  it('switching format never changes the rows and the non-GST total equals the GST items total', () => {
    const r = rng(7)
    for (let k = 0; k < 100; k++) {
      const rows = randomBill(r, 20)
      const before = JSON.stringify(rows)
      const n = computeBill(NON_GST, rows)
      const g = computeBill(GST, rows)
      expect(JSON.stringify(rows)).toBe(before)
      expect(g.itemsTotal).toBe(n.itemsTotal)
      expect(g.adjustmentsTotal).toBe(n.adjustmentsTotal)
    }
  })

  it('round-off: grand total is always a whole number and |roundOff| ≤ 0.5', () => {
    const r = rng(5)
    for (let k = 0; k < 100; k++) {
      const out = computeBill(NON_GST, randomBill(r, 15), { roundOff: true })
      expect(out.grandTotal).toMatch(/^-?\d+\.00$/)
      expect(Math.abs(Number(out.roundOff))).toBeLessThanOrEqual(0.5) // test-only float check on a small value
    }
  })

  it('never throws on garbage cell text', () => {
    const rows: BillRow[] = ['abc', '1e3', '--', '1,5', ' ', '9'.repeat(40)].map((t, i) => ({ id: `g${i}`, idx: i, nameRuns: [{ t: 'x' }], qty: t, rate: '2', totalOverride: i % 2 ? t : null, gstRate: t, extras: {} }))
    expect(() => computeBill(GST, rows)).not.toThrow()
  })
})
