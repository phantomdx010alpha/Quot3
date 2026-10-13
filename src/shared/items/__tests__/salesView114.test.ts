import { describe, expect, it } from 'vitest'
import type { GroupSales } from '../api'
import type { SaleRow, SalesTab } from '../sales'
import { buildSalesListRows, dateText, defaultTab, flagText, partyOfRow, saleCells, saleKey, saleRowIndex, salesColumns, salesToTsv, statsText, tabOf } from '../salesView'

const row = (o: Partial<SaleRow> & { billId: string; rowIdx: number }): SaleRow => ({
  poNumber: 'A1', billDate: '2026-10-03', createdAt: '2026-10-03T10:00:00Z', partyKey: 'name:RAVI', partyName: 'Ravi', name: 'AMETO SMALL',
  qty: '10', rate: '82', gst: false, gstPct: null, lineTotal: '820', gstAmt: null, amount: null, outlier: null, ...o
})
const stats = (count: number, extra: Partial<SalesTab['stats']> = {}): SalesTab['stats'] => ({ count, priced: count, minRate: '75', medianRate: '82', maxRate: '90', latestRate: '84', latestDate: '2026-10-03', totalQty: '640', parties: 3, ...extra })
const tab = (rows: SaleRow[], extra: Partial<SalesTab> = {}): SalesTab => ({ stats: stats(rows.length), groupMedianRate: '82', rows, lastByParty: [], truncated: false, ...extra })
const sales = (nonGst: SalesTab, gst: SalesTab): GroupSales => ({ groupId: 'AMETO SMALL', display: 'AMETO SMALL', nonGst, gst })

describe('Phase 114 salesView', () => {
  it('columns: GST tab adds GST %, tax and line total', () => {
    expect(salesColumns('nonGst')).toEqual(['Date', 'Party', 'Bill', 'Qty', 'Rate'])
    expect(salesColumns('gst')).toEqual(['Date', 'Party', 'Bill', 'Qty', 'Rate', 'GST %', 'Tax', 'Line total'])
  })

  it('cells use the strings of the read model unchanged; GST line total = amount with tax', () => {
    expect(saleCells(row({ billId: 'b1', rowIdx: 0 }), 'nonGst')).toEqual(['03-10-26', 'Ravi', 'A1', '10', '82'])
    const g = row({ billId: 'b2', rowIdx: 1, gst: true, gstPct: '18', gstAmt: '147.60', amount: '967.60', lineTotal: '820' })
    expect(saleCells(g, 'gst')).toEqual(['03-10-26', 'Ravi', 'A1', '10', '82', '18', '147.60', '967.60'])
    expect(saleCells(row({ billId: 'b3', rowIdx: 0, qty: null, rate: null }), 'nonGst').slice(3)).toEqual(['', ''])
  })

  it('tabs: Non-GST by default, GST only when it is the only one with sales', () => {
    const none = tab([], { stats: stats(0) })
    const some = tab([row({ billId: 'b', rowIdx: 0 })])
    expect(defaultTab(sales(some, some))).toBe('nonGst')
    expect(defaultTab(sales(none, some))).toBe('gst')
    expect(defaultTab(sales(none, none))).toBe('nonGst')
    expect(tabOf(sales(none, some), 'gst')).toBe(some)
  })

  it('keys and index lookup', () => {
    const rows = [row({ billId: 'b1', rowIdx: 0 }), row({ billId: 'b1', rowIdx: 2 })]
    expect(saleKey(rows[1]!)).toBe('b1:2')
    expect(saleRowIndex(rows, 'b1:2')).toBe(1)
    expect(saleRowIndex(rows, 'zz:0')).toBe(-1)
    expect(saleRowIndex(rows, null)).toBe(-1)
    expect(partyOfRow(rows, 1)).toBe('name:RAVI')
    expect(partyOfRow(rows, 5)).toBeNull()
  })

  it('TSV: header + one line per row of the current list, flag last, tabs and newlines in text cleaned', () => {
    const t = tab([row({ billId: 'b1', rowIdx: 0, partyName: 'Ra\tvi\nKumar', outlier: 'high', rate: '120' }), row({ billId: 'b2', rowIdx: 0 })])
    const lines = salesToTsv(t, 'nonGst').split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('Date\tParty\tBill\tQty\tRate\tFlag')
    expect(lines[1]).toBe('03-10-26\tRa vi Kumar\tA1\t10\t120\tHigh')
    expect(lines[2]).toBe('03-10-26\tRavi\tA1\t10\t82\t')
    const g = tab([row({ billId: 'b', rowIdx: 0, gst: true, gstPct: '5', gstAmt: '41', amount: '861' })])
    expect(salesToTsv(g, 'gst').split('\r\n')[0]).toBe('Date\tParty\tBill\tQty\tRate\tGST %\tTax\tLine total\tFlag')
    expect(salesToTsv(g, 'gst').split('\r\n')[1]).toBe('03-10-26\tRavi\tA1\t10\t82\t5\t41\t861\t')
  })

  it('summary text', () => {
    expect(statsText(stats(118))).toBe('118 sales, rate 75 - 90 (median 82), latest 84 on 03-10-26, qty 640, 3 parties')
    expect(statsText(stats(1, { minRate: '82', maxRate: '82', medianRate: '82', parties: 1 }))).toBe('1 sale, rate 82 (median 82), latest 84 on 03-10-26, qty 640, 1 party')
    expect(statsText(stats(2, { priced: 0, minRate: null, medianRate: null, maxRate: null, latestRate: null, latestDate: null }))).toBe('2 sales, no rates, qty 640, 3 parties')
    expect(statsText(stats(0))).toBe('No sales')
  })

  it('list rows: sales first (cursor index), then the who-paid-what block; none when no party has a rate', () => {
    const rows = [row({ billId: 'b1', rowIdx: 0 }), row({ billId: 'b2', rowIdx: 0 })]
    const party = { partyKey: 'name:RAVI', partyName: 'Ravi', rate: '82', date: '2026-10-03', billId: 'b1', poNumber: 'A1', sales: 2, outlier: null }
    const list = buildSalesListRows(tab(rows, { lastByParty: [party] }))
    expect(list.map((r) => r.kind)).toEqual(['sale', 'sale', 'sub', 'party'])
    expect(list.map((r) => (r.kind === 'sale' ? r.index : -1))).toEqual([0, 1, -1, -1])
    expect(buildSalesListRows(tab(rows)).map((r) => r.kind)).toEqual(['sale', 'sale'])
    expect(new Set(list.map((r) => r.key)).size).toBe(list.length)
  })

  it('small helpers', () => {
    expect(flagText('high')).toBe('High'); expect(flagText('low')).toBe('Low'); expect(flagText(null)).toBe('')
    expect(dateText('2026-01-09')).toBe('09-01-26'); expect(dateText('bad')).toBe('bad')
  })
})
