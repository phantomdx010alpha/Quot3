import { describe, expect, it } from 'vitest'
import { GST, NON_GST } from '../../__fixtures__/formats'
import { LEGACY_AMOUNTS, LEGACY_ITEMS_TOTAL, blankRow, legacyBill, row } from '../../__fixtures__/bills'
import { classifyRow } from '../classifyRow'
import { calcRow } from '../rowCalc'
import { computeBill } from '../billTotals'
import { getBillOptions, normalizeRoundOff, readRoundOffSetting, ROUND_OFF_SETTING_KEY } from '../billOptions'

describe('classifyRow', () => {
  it.each([
    ['blank', row('', null, null), 'blank'],
    ['blank with whitespace name/empty strings', row('  ', '', ' '), 'blank'],
    ['qty + rate', row('a', '2', '5'), 'item'],
    ['only qty', row('a', '2', null), 'item'],
    ['only rate', row('a', null, '5'), 'item'],
    ['nameless qty/rate is still an item (D-C1)', row('', '2', '5'), 'item'],
    ['qty with override is an item', row('a', '2', null, { total: '10' }), 'item'],
    ['name + total only = adjustment', row('discount', null, null, { total: '-50' }), 'adjustment'],
    ['name only = partial', row('hello', null, null), 'partial'],
    ['total with no name = partial', row('', null, null, { total: '10' }), 'partial']
  ])('%s', (_n, r, kind) => expect(classifyRow(r)).toBe(kind))
})

describe('calcRow (D-M2 / D-M3)', () => {
  it('qty × rate, 2dp', () => {
    expect(calcRow(NON_GST, row('a', '10', '90')).total).toBe('900.00')
    expect(calcRow(NON_GST, row('a', '1.5', '3.33')).total).toBe('5.00') // 4.995 → 5.00 HALF_UP
    expect(calcRow(NON_GST, row('a', '0.1', '0.2')).total).toBe('0.02')
  })
  it('only qty or only rate → blank total, with a warning', () => {
    for (const r of [row('a', '2', null), row('a', null, '5')]) {
      const c = calcRow(NON_GST, r)
      expect(c.total).toBeNull()
      expect(c.warnings).toContain('MISSING_QTY_OR_RATE')
    }
  })
  it('override wins and is flagged; override rounds to 2dp', () => {
    const c = calcRow(NON_GST, row('a', '10', '90', { total: '875.555' }))
    expect(c.total).toBe('875.56')
    expect(c.isOverride).toBe(true)
    expect(calcRow(NON_GST, row('a', '10', '90')).isOverride).toBe(false)
  })
  it('override supplies the total even if qty/rate are partial', () => {
    expect(calcRow(NON_GST, row('a', '2', null, { total: '40' })).total).toBe('40.00')
  })
  it('nameless item is flagged MISSING_NAME', () => {
    expect(calcRow(NON_GST, row('', '2', '5')).warnings).toContain('MISSING_NAME')
  })
  it('negative qty/rate computes but is flagged (rejected at input, D-M7)', () => {
    const c = calcRow(NON_GST, row('a', '-2', '5'))
    expect(c.total).toBe('-10.00')
    expect(c.warnings).toContain('NEGATIVE_QTY_RATE')
  })
  it('invalid text is treated as blank and flagged, never throws', () => {
    const c = calcRow(NON_GST, row('a', 'abc', '5'))
    expect(c.total).toBeNull()
    expect(c.warnings).toContain('INVALID_NUMBER')
  })
  it('non-GST formats have no gst/amount', () => {
    const c = calcRow(NON_GST, row('a', '2', '5', { gst: '18' }))
    expect([c.gstAmt, c.amount]).toEqual([null, null])
  })
  it('GST format: gst from total, amount = total + gst, 2dp', () => {
    const c = calcRow(GST, row('a', '10', '100', { gst: '18' }))
    expect(c).toMatchObject({ total: '1000.00', gstAmt: '180.00', amount: '1180.00' })
    expect(calcRow(GST, row('a', '3', '33.33', { gst: '5' }))).toMatchObject({ total: '99.99', gstAmt: '5.00', amount: '104.99' }) // 4.9995 → 5.00
  })
  it('GST is computed from the OVERRIDDEN total', () => {
    expect(calcRow(GST, row('a', '10', '100', { gst: '12', total: '900' }))).toMatchObject({ total: '900.00', gstAmt: '108.00', amount: '1008.00' })
  })
  it('blank GST % = 0%', () => {
    expect(calcRow(GST, row('a', '2', '50'))).toMatchObject({ gstAmt: '0.00', amount: '100.00' })
  })
  it('adjustments never carry GST (D-C2): amount = total, gstAmt null', () => {
    expect(calcRow(GST, row('discount', null, null, { total: '-100', gst: '18' }))).toMatchObject({ total: '-100.00', gstAmt: null, amount: '-100.00' })
  })
})

describe('computeBill — legacy bill (screenshot fixture)', () => {
  const rows = legacyBill()
  const r = computeBill(NON_GST, rows)
  it('every row total matches the screenshot', () => {
    const items = r.display.filter((d) => d.kind === 'item')
    expect(items.map((d) => d.cells['total'])).toEqual(LEGACY_AMOUNTS)
  })
  it('items total 17226.00; no adjustments → single "Total" footer', () => {
    expect(r.itemsTotal).toBe(LEGACY_ITEMS_TOTAL)
    expect(r.grandTotal).toBe(LEGACY_ITEMS_TOTAL)
    const footer = r.display.slice(18)
    expect(footer).toHaveLength(1)
    expect(footer[0]).toMatchObject({ kind: 'grandTotal', cells: { name: 'Total', total: '17226.00' } })
  })
  it('Sl.No 1..18 in order; qty/rate trimmed in display', () => {
    expect(rows.map((x) => r.slNo[x.id])).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    expect(r.display[0]?.cells).toMatchObject({ slNo: '1', qty: '10', rate: '90', total: '900.00' })
  })
  it('counts', () => expect(r.counts).toEqual({ itemRows: 18, adjustmentRows: 0, paperRows: 18 }))
})

describe('computeBill — adjustments (owner rules)', () => {
  it('item + adjustment: footer order Items total → adjustment → Adjustments total → Final total', () => {
    const rows = [row('button', '10', '100'), row('discount', null, null, { total: '-50' }), row('freight', null, null, { total: '20' })]
    const r = computeBill(NON_GST, rows)
    expect(r.display.map((d) => d.kind)).toEqual(['item', 'itemsTotal', 'adjustment', 'adjustment', 'adjustmentsTotal', 'grandTotal'])
    expect(r.itemsTotal).toBe('1000.00')
    expect(r.adjustmentsTotal).toBe('-30.00')
    expect(r.grandTotal).toBe('970.00')
    expect(r.display.at(-1)?.cells).toMatchObject({ name: 'Final total', total: '970.00' })
    expect(r.counts).toEqual({ itemRows: 1, adjustmentRows: 2, paperRows: 3 }) // D-C3
  })
  it('an adjustment entered mid-list moves below the items total; Sl.No skips it', () => {
    const rows = [row('a', '1', '10'), row('disc', null, null, { total: '-1' }), row('b', '1', '20')]
    const r = computeBill(NON_GST, rows)
    expect(r.display.slice(0, 2).map((d) => d.cells['name'])).toEqual(['a', 'b'])
    expect([r.slNo[rows[0]!.id], r.slNo[rows[1]!.id], r.slNo[rows[2]!.id]]).toEqual([1, null, 2])
  })
  it('a row stops being an adjustment once qty/rate is added (moves back, gets a Sl.No)', () => {
    const adj = row('thing', null, null, { total: '-10' })
    expect(computeBill(NON_GST, [adj]).counts.adjustmentRows).toBe(1)
    const asItem = { ...adj, qty: '2' }
    const r = computeBill(NON_GST, [asItem])
    expect(r.counts).toEqual({ itemRows: 1, adjustmentRows: 0, paperRows: 1 })
    expect(r.slNo[asItem.id]).toBe(1)
    expect(r.itemsTotal).toBe('-10.00') // override still the effective total
  })
  it('negative adjustment larger than items gives a negative final total', () => {
    const r = computeBill(NON_GST, [row('a', '1', '10'), row('big discount', null, null, { total: '-25.50' })])
    expect(r.grandTotal).toBe('-15.50')
  })
  it('GST format: adjustments add to the Amount column only; no GST on them', () => {
    const rows = [row('a', '10', '100', { gst: '18' }), row('discount', null, null, { total: '-100' })]
    const r = computeBill(GST, rows)
    expect(r.itemsTotal).toBe('1000.00')
    expect(r.itemsGst).toBe('180.00')
    expect(r.itemsAmount).toBe('1180.00')
    expect(r.adjustmentsTotal).toBe('-100.00')
    expect(r.grandTotal).toBe('1080.00')
    const [itemsTotal, adj, adjTotal, grand] = r.display.slice(1)
    expect(itemsTotal?.cells).toMatchObject({ total: '1000.00', gstAmt: '180.00', amount: '1180.00' })
    expect(adj?.cells).toMatchObject({ amount: '-100.00', total: '' })
    expect(adjTotal?.cells['total']).toBeUndefined()
    expect(grand?.cells).toMatchObject({ amount: '1080.00' })
  })
  it('GST with no adjustments: single Total row shows total, gst and amount', () => {
    const r = computeBill(GST, [row('a', '1', '100', { gst: '5' }), row('b', '2', '50', { gst: '12' })])
    expect(r.display.at(-1)?.cells).toMatchObject({ name: 'Total', total: '200.00', gstAmt: '17.00', amount: '217.00' })
    expect(r.grandTotal).toBe('217.00')
  })
})

describe('computeBill — Sl.No, partial rows, blanks, warnings', () => {
  it('Sl.No only for named items with qty or rate; partial/blank/nameless get none', () => {
    const rows = [row('a', '1', '1'), row('', '2', '3'), row('only name', null, null), blankRow(), row('c', null, '4')]
    const r = computeBill(NON_GST, rows)
    expect(rows.map((x) => r.slNo[x.id])).toEqual([1, null, null, null, 2])
  })
  it('partial rows are shown but never totalled; nameless item IS totalled (flagged)', () => {
    const rows = [row('a', '1', '10'), row('', null, null, { total: '999' }), row('', '2', '5'), row('note', null, null)]
    const r = computeBill(NON_GST, rows)
    expect(r.itemsTotal).toBe('20.00')
    expect(r.display.filter((d) => d.kind === 'partial')).toHaveLength(2)
    expect(r.warnings).toContain(`MISSING_NAME:${rows[2]!.id}`)
  })
  it('an empty bill totals zero with a single Total', () => {
    const r = computeBill(NON_GST, [blankRow(), blankRow()])
    expect(r.grandTotal).toBe('0.00')
    expect(r.display.at(-1)).toMatchObject({ kind: 'grandTotal', cells: { total: '0.00' } })
    expect(r.counts.paperRows).toBe(0)
  })
  it('extra-column text flows into display cells', () => {
    const r = computeBill(NON_GST, [row('a', '1', '1', { extras: { c1: { text: '11.5-1' } } })])
    expect(r.display[0]?.cells['c1']).toBe('11.5-1')
  })
})

describe('computeBill — round-off (D-M5, optional)', () => {
  const rows = [row('a', '1', '100.40')]
  it('off by default: no round-off line', () => {
    const r = computeBill(NON_GST, rows)
    expect(r.roundOff).toBe('0.00')
    expect(r.display.some((d) => d.kind === 'roundOff')).toBe(false)
  })
  it('on: explicit line, grand total is a whole rupee', () => {
    const r = computeBill(NON_GST, rows, { roundOff: true })
    expect(r.roundOff).toBe('-0.40')
    expect(r.grandTotal).toBe('100.00')
    expect(r.display.map((d) => d.kind)).toEqual(['item', 'itemsTotal', 'roundOff', 'grandTotal'])
  })
  it('on, .50 rounds up; already whole adds no line', () => {
    expect(computeBill(NON_GST, [row('a', '1', '100.50')], { roundOff: true }).grandTotal).toBe('101.00')
    expect(computeBill(NON_GST, [row('a', '1', '100')], { roundOff: true }).display.some((d) => d.kind === 'roundOff')).toBe(false)
  })
})

describe('computeBill — decimal edge cases', () => {
  it('0.1 + 0.2 style sums are exact', () => {
    const r = computeBill(NON_GST, [row('a', '1', '0.1'), row('b', '1', '0.2')])
    expect(r.itemsTotal).toBe('0.30')
    expect(r.grandTotal).toBe('0.30')
  })
  it('sums of rounded row values (no re-rounding of unrounded sums): 3 × (0.335 → 0.34) = 1.02', () => {
    const r = computeBill(NON_GST, [row('a', '1', '0.335'), row('b', '1', '0.335'), row('c', '1', '0.335')])
    expect(r.itemsTotal).toBe('1.02') // not round2(1.005) = 1.01
  })
  it('a hundred thousand 0.01 rows sum exactly (the 1e6 sum is in money.test)', () => {
    const rows = Array.from({ length: 100_000 }, (_, i) => ({ id: String(i), idx: i, nameRuns: [{ t: 'x' }], qty: '1', rate: '0.01', totalOverride: null, gstRate: null, extras: {} }))
    const r = computeBill(NON_GST, rows)
    expect(r.itemsTotal).toBe('1000.00')
    expect(r.counts.itemRows).toBe(100_000)
  }, 60_000)
})

describe('Phase 76 - roundGrand (round-off without a displayed line) and getBillOptions', () => {
  const g = (rows: ReturnType<typeof row>[], fmt = NON_GST, o = { roundGrand: true }) => computeBill(fmt, rows, o)
  it('nearest rupee: 100.40 -> 100, 100.60 -> 101; the difference is kept in roundOff', () => {
    expect(g([row('a', '1', '100.40')]).grandTotal).toBe('100.00')
    expect(g([row('a', '1', '100.40')]).roundOff).toBe('-0.40')
    expect(g([row('a', '1', '100.60')]).grandTotal).toBe('101.00')
    expect(g([row('a', '1', '100.60')]).roundOff).toBe('0.40')
  })
  it('.50 boundary rounds half up (away from zero)', () => {
    expect(g([row('a', '1', '100.50')]).grandTotal).toBe('101.00')
    expect(g([row('a', '1', '100.49')]).grandTotal).toBe('100.00')
  })
  it('negatives (adjustment / override): -2.50 -> -3, -2.40 -> -2', () => {
    expect(g([row('adj', null, null, { total: '-2.50' })]).grandTotal).toBe('-3.00')
    expect(g([row('adj', null, null, { total: '-2.40' })]).grandTotal).toBe('-2.00')
  })
  it('NO displayed round-off line: the footer is the single Total and the rounded value', () => {
    const r = g([row('a', '1', '100.40')])
    expect(r.display.some((d) => d.kind === 'roundOff')).toBe(false)
    expect(r.display.map((d) => d.kind)).toEqual(['item', 'grandTotal'])
    expect(r.display.at(-1)!.cells['total']).toBe('100.00')
    const withAdj = g([row('a', '1', '100.40'), row('less', null, null, { total: '-0.10' })])
    expect(withAdj.display.some((d) => d.kind === 'roundOff')).toBe(false)
    expect(withAdj.grandTotal).toBe('100.00') // 100.30 -> 100
  })
  it('flag 0 / option absent: totals are exactly as before', () => {
    const rows = [row('a', '1', '100.40')]
    expect(computeBill(NON_GST, rows)).toEqual(computeBill(NON_GST, rows, getBillOptions({ roundOff: 0 })))
    expect(computeBill(NON_GST, rows, getBillOptions({})).grandTotal).toBe('100.40')
    expect(computeBill(NON_GST, rows, getBillOptions(undefined)).roundOff).toBe('0.00')
  })
  it('GST format: the rounded value is the Amount footer, items GST is not touched', () => {
    const rows = [row('a', '1', '99.99', { gst: '18' })]
    const exact = computeBill(GST, rows)
    const r = computeBill(GST, rows, { roundGrand: true })
    expect(r.itemsGst).toBe(exact.itemsGst)
    expect(r.grandTotal).toBe(String(Math.round(Number(exact.grandTotal))) + '.00')
    expect(r.display.some((d) => d.kind === 'roundOff')).toBe(false)
  })
  it('the legacy roundOff option still shows its line; roundGrand wins when both are set', () => {
    const rows = [row('a', '1', '100.40')]
    expect(computeBill(NON_GST, rows, { roundOff: true }).display.some((d) => d.kind === 'roundOff')).toBe(true)
    expect(computeBill(NON_GST, rows, { roundOff: true, roundGrand: true }).display.some((d) => d.kind === 'roundOff')).toBe(false)
  })
  it('getBillOptions: only a flag of 1 / true turns it on; setting reader defaults ON', () => {
    expect(getBillOptions({ roundOff: 1 })).toEqual({ roundGrand: true })
    expect(getBillOptions({ roundOff: true })).toEqual({ roundGrand: true })
    for (const v of [0, false, null, undefined, '1', 2, 'yes']) expect(getBillOptions({ roundOff: v })).toEqual({})
    expect(normalizeRoundOff(1)).toBe(1)
    expect(ROUND_OFF_SETTING_KEY).toBe('calc.roundOff')
    expect(readRoundOffSetting({})).toBe(true)
    expect(readRoundOffSetting({ 'calc.roundOff': false })).toBe(false)
  })
})
