import { describe, expect, it } from 'vitest'
import { UNMEASURED_ROWS, scrollTopFor, visibleRange } from '../windowing'
import { buildSalesTab, rateStats, saleLine, type SaleBillHead } from '../sales'
import { getFormat } from '../../format/registry'
import type { BillRow } from '../../types'

describe('Phase 117 - visibleRange / scrollTopFor (pure)', () => {
  it('covers the viewport plus overscan and clamps at both ends', () => {
    expect(visibleRange(1000, 26, 0, 260, 5)).toEqual({ start: 0, end: 15 })
    expect(visibleRange(1000, 26, 2600, 260, 5)).toEqual({ start: 95, end: 115 })
    const last = visibleRange(1000, 26, 1000 * 26 - 260, 260, 5)
    expect(last.end).toBe(1000)
    expect(last.start).toBeLessThan(990)
  })
  it('scrolled past the end (list shrank) still draws the last rows, never nothing', () => {
    const r = visibleRange(50, 26, 99999, 260, 5)
    expect(r.end).toBe(50)
    expect(r.end - r.start).toBeGreaterThan(0)
  })
  it('unmeasured viewport draws a first screenful instead of a blank list; empty list draws nothing', () => {
    expect(visibleRange(3000, 26, 0, 0, 5)).toEqual({ start: 0, end: UNMEASURED_ROWS })
    expect(visibleRange(10, 26, 0, 0, 5)).toEqual({ start: 0, end: 10 })
    expect(visibleRange(0, 26, 0, 300, 5)).toEqual({ start: 0, end: 0 })
  })
  it('every row index is inside some range for every scroll position (no gaps) over 3000 rows', () => {
    for (let top = 0; top <= 3000 * 26; top += 997) {
      const { start, end } = visibleRange(3000, 26, top, 300, 3)
      const firstVisible = Math.floor(top / 26)
      expect(start).toBeLessThanOrEqual(firstVisible)
      expect(end).toBeGreaterThanOrEqual(Math.min(3000, Math.ceil((top + 300) / 26)))
    }
  })
  it('scrollTopFor moves the least amount', () => {
    expect(scrollTopFor(5, 26, 0, 260, 100)).toBe(0)
    expect(scrollTopFor(20, 26, 0, 260, 100)).toBe(20 * 26 + 26 - 260)
    expect(scrollTopFor(2, 26, 520, 260, 100)).toBe(52)
    expect(scrollTopFor(-1, 26, 40, 260, 100)).toBe(40)
    expect(scrollTopFor(999, 26, 40, 260, 100)).toBe(40)
  })
})

const head: SaleBillHead = { billId: 'b1', poNumber: 'PO1', billDate: '2026-09-01', createdAt: '2026-09-01T09:00:00Z', partyId: null, partyName: 'Ravi', legacyRef: null }
const row = (o: Partial<BillRow>): BillRow => ({ id: 'r', idx: 0, nameRuns: [{ t: 'PIN' }], qty: null, rate: null, totalOverride: null, gstRate: null, extras: {}, ...o })

describe('Phase 117 - zero / empty rates are not prices', () => {
  const f = getFormat('non_gst')
  it('a rate of 0, 0.00, blank or text becomes no rate (the line itself stays a sale)', () => {
    for (const rate of ['0', '0.00', '', ' ', 'abc', null]) expect(saleLine(f, head, row({ qty: '2', rate, totalOverride: '10' }))).toMatchObject({ rate: null })
    expect(saleLine(f, head, row({ qty: '2', rate: '12.5' }))).toMatchObject({ rate: '12.5' })
  })
  it('min / median / flags ignore the zero lines', () => {
    const lines = ['0', '260', '255', '262', '258', '0'].map((rate, i) => saleLine(f, { ...head, billId: `b${i}`, billDate: `2026-09-0${i + 1}` }, row({ qty: '1', rate, totalOverride: '5' }))!)
    const s = rateStats(lines)
    expect(s).toMatchObject({ count: 6, priced: 4, minRate: '255', maxRate: '262' })
    const tab = buildSalesTab(lines)
    expect(tab.rows.every((r) => r.outlier === null)).toBe(true)
  })
})
