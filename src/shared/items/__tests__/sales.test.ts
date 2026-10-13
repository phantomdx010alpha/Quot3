import { describe, expect, it } from 'vitest'
import { buildSalesTab, outlierOf, partyKeyOf, rateStats, saleLine, type SaleBillHead, type SaleLine } from '../sales'
import { getFormat } from '../../format/registry'
import type { BillRow } from '../../types'

const head = (over: Partial<SaleBillHead> = {}): SaleBillHead => ({ billId: 'b1', poNumber: 'PO1', billDate: '2026-09-01', createdAt: '2026-09-01T09:00:00Z', partyId: null, partyName: 'Ravi  Traders', legacyRef: null, ...over })
const row = (o: Partial<BillRow> & { name?: string }): BillRow => ({ id: 'r', idx: 0, nameRuns: o.name === undefined ? [{ t: 'PIN' }] : [{ t: o.name }], qty: null, rate: null, totalOverride: null, gstRate: null, extras: {}, ...o })
const line = (rate: string | null, over: Partial<SaleLine> = {}): SaleLine => ({
  billId: 'b', rowIdx: 0, poNumber: 'P', billDate: '2026-09-01', createdAt: 'c', partyKey: 'name:A', partyName: 'A', name: 'PIN', qty: '1', rate, gst: false, gstPct: null, lineTotal: rate, gstAmt: null, amount: null, ...over
})

describe('Phase 110 - sales lines (pure)', () => {
  it('party key: saved id wins, else the typed name normalised', () => {
    expect(partyKeyOf('p1', 'X')).toBe('id:p1')
    expect(partyKeyOf(null, ' Ravi   traders ')).toBe('name:RAVI TRADERS')
  })

  it('non-GST format: total from qty x rate, no GST fields, even when the row keeps a GST %', () => {
    const l = saleLine(getFormat('non_gst'), head(), row({ qty: '3', rate: '12.50', gstRate: '18' }))!
    expect(l).toMatchObject({ gst: false, lineTotal: '37.50', gstPct: null, gstAmt: null, amount: null, qty: '3', rate: '12.50' })
  })

  it('GST format: tax and amount from the row GST %; blank GST % = 0 tax', () => {
    const f = getFormat('gst')
    expect(saleLine(f, head(), row({ qty: '2', rate: '100', gstRate: '18' }))).toMatchObject({ gst: true, gstPct: '18', lineTotal: '200.00', gstAmt: '36.00', amount: '236.00' })
    expect(saleLine(f, head(), row({ qty: '2', rate: '100' }))).toMatchObject({ gst: true, gstPct: null, gstAmt: '0.00', amount: '200.00' })
  })

  it('a typed total (no qty / rate) is kept; nameless and name-only rows are not sales', () => {
    expect(saleLine(getFormat('non_gst'), head(), row({ totalOverride: '99' }))).toMatchObject({ lineTotal: '99.00', qty: null, rate: null })
    expect(saleLine(getFormat('non_gst'), head(), row({ name: '', qty: '1', rate: '1' }))).toBeNull()
    expect(saleLine(getFormat('non_gst'), head(), row({ name: 'HEADING' }))).toBeNull()
  })

  it('stats are decimal-exact and order-independent', () => {
    const ls = [line('0.1'), line('0.2', { billDate: '2026-09-02' }), line('0.3', { billDate: '2026-09-03' })]
    const a = rateStats(ls)
    expect(a).toMatchObject({ medianRate: '0.2', minRate: '0.1', maxRate: '0.3', latestRate: '0.3', totalQty: '3' })
    expect(rateStats([...ls].reverse())).toEqual(a)
    expect(rateStats([])).toMatchObject({ count: 0, minRate: null, medianRate: null, totalQty: '0' })
  })

  it('outlier rule: needs 5 priced sales and a median above 0; boundary is not flagged', () => {
    expect(outlierOf('130', '100', 5)).toBeNull() // exactly +30%
    expect(outlierOf('130.01', '100', 5)).toBe('high')
    expect(outlierOf('69.99', '100', 5)).toBe('low')
    expect(outlierOf('500', '100', 4)).toBeNull()
    expect(outlierOf('5', '0', 9)).toBeNull()
    expect(outlierOf(null, '100', 9)).toBeNull()
  })

  it('last rate per party skips an unpriced newest sale; rows are newest first and capped flag is false for small tabs', () => {
    const tab = buildSalesTab([
      line('50', { billId: 'b1', billDate: '2026-09-01' }),
      line(null, { billId: 'b2', billDate: '2026-09-05' }),
      line('60', { billId: 'b3', billDate: '2026-09-03', partyKey: 'name:B', partyName: 'B' })
    ])
    expect(tab.rows.map((r) => r.billId)).toEqual(['b2', 'b3', 'b1'])
    expect(tab.lastByParty.map((p) => [p.partyName, p.rate, p.sales])).toEqual([['B', '60', 1], ['A', '50', 2]])
    expect(tab.truncated).toBe(false)
  })
})
