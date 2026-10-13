import { describe, expect, it } from 'vitest'
import { createEmptyBill } from '../../billModel'
import { legacyGridBill } from '../../__fixtures__/gridBills'
import { parseTsv } from '../tsvCodec'
import { billHasContent, billToRows, billToTsv } from '../billTsv'
import type { Bill, BillRow } from '../../types'

const row = (id: string, i: number, name: string, qty: string | null, rate: string | null, over: Partial<BillRow> = {}): BillRow =>
  ({ id, idx: i, nameRuns: name ? [{ t: name }] : [], qty, rate, totalOverride: null, gstRate: null, extras: {}, ...over })

function sample(formatId: string): Bill {
  const b = createEmptyBill({ branchId: 'x', billDate: '2026-10-08', now: '2026-10-08T00:00:00.000Z', newId: () => 'bill', rowCount: 0 })
  b.formatId = formatId
  b.party = { name: 'Lakshmi Cloth', phone: '98450 12345', address: 'MG Road, Bengaluru', transport: 'VRL' }
  b.extraCols = [{ key: 'c1', header: 'ruby', kind: 'units' }]
  b.poNumber = 'Q3-0042'
  b.rows = [
    row('a', 0, '', '2', '100', { nameRuns: [{ t: 'Silk ' }, { t: 'saree', b: 1 }], gstRate: '18', extras: { c1: { text: '12-1' } } }),
    row('b', 1, 'Cotton\t"x"', '1.5', '33.33'),
    row('c', 2, 'Discount', null, null, { totalOverride: '-50' }),
    row('d', 3, '', null, null)
  ]
  return b
}

const T = (s: string): string => s.replace(/→/g, '\t').split('\n').join('\r\n')

describe('billToTsv golden output', () => {
  it('Non-GST bill with an adjustment and an extra column', () => {
    expect(billToTsv(sample('non_gst')).text).toBe(T([
      'Lakshmi Cloth', 'Phone→98450 12345', 'Transport→VRL', '',
      'Sl.No→Item Name→Rate→Quantity→Amount→ruby',
      '1→Silk saree→100→2→200.00→12-1',
      '2→"Cotton→""x"""→33.33→1.5→50.00→',
      '→Items total→→→250.00→',
      '→Discount→→→-50.00→',
      '→Adjustments total→→→-50.00→',
      '→Final total→→→200.00→'
    ].join('\n')))
  })

  it('GST bill: Total / GST Amt / Amount, adjustments in Amount only', () => {
    expect(billToTsv(sample('gst')).text).toBe(T([
      'Lakshmi Cloth', 'Phone→98450 12345', 'Transport→VRL', '',
      'Sl.No→Item Name→Quantity→Rate→Total→GST %→GST Amt→Amount→ruby',
      '1→Silk saree→2→100→200.00→18→36.00→236.00→12-1',
      '2→"Cotton→""x"""→1.5→33.33→50.00→→0.00→50.00→',
      '→Items total→→→250.00→→36.00→286.00→',
      '→Discount→→→→→→-50.00→',
      '→Adjustments total→→→→→→-50.00→',
      '→Final total→→→→→→236.00→'
    ].join('\n')))
  })

  it('no adjustments: one Total line; no company block, PO number or address anywhere', () => {
    const b = sample('non_gst'); b.rows = b.rows.slice(0, 2)
    const { text } = billToTsv(b)
    expect(text.endsWith('→Total→→→250.00→'.replace(/→/g, '\t'))).toBe(true)
    for (const bad of ['Q3-0042', 'MG Road', 'Bengaluru', '2026-10-08']) expect(text).not.toContain(bad)
  })

  it('party lines are only the filled ones; no party at all starts with the header row', () => {
    const b = sample('non_gst'); b.party = { name: 'Solo', phone: '', address: '', transport: '' }
    expect(billToRows(b).slice(0, 3)).toEqual([['Solo'], [], ['Sl.No', 'Item Name', 'Rate', 'Quantity', 'Amount', 'ruby']])
    b.party = { name: '', phone: '', address: '', transport: '' }
    expect(billToRows(b)[0]).toEqual(['Sl.No', 'Item Name', 'Rate', 'Quantity', 'Amount', 'ruby'])
  })

  it('round-trips through the TSV parser (quotes, tabs) and trailing blank rows are skipped', () => {
    const rows = parseTsv(billToTsv(sample('non_gst')).text)
    expect(rows[5]?.[1]).toBe('Silk saree')
    expect(rows[6]?.[1]).toBe('Cotton\t"x"')
    expect(rows).toHaveLength(11) // 3 party + spacer + header + 2 items + 4 footer rows
  })

  it('numbers are plain (no commas, no rupee sign) so Excel reads them as numbers', () => {
    const b = sample('non_gst'); b.rows = [row('z', 0, 'Big', '1', '1250000.5')]
    const t = billToTsv(b).text
    expect(t).toContain('1250000.50')
    expect(t).not.toMatch(/[₹,]\d/)
  })

  it('legacy screenshot bill: 18 items, ruby/tomato columns, total 17226.00', () => {
    const t = billToRows(legacyGridBill())
    const header = t.find((r) => r[0] === 'Sl.No') as string[]
    expect(header.slice(-2)).toEqual(['ruby', 'tomato'])
    const last = t[t.length - 1] as string[]
    expect(last[1]).toBe('Total')
    expect(last[4]).toBe('17226.00')
    expect(t.filter((r) => /^\d+$/.test(r[0] ?? '')).length).toBe(18)
  })

  it('HTML flavour is a table with escaped cells', () => {
    const { html } = billToTsv(sample('non_gst'))
    expect(html.startsWith('<table>') && html.endsWith('</table>')).toBe(true)
    expect(html).toContain('<td>Cotton\t&quot;x&quot;</td>')
    expect(html).not.toContain('<th>')
    expect(billToTsv({ ...sample('non_gst'), party: { name: 'A<b>&B', phone: '', address: '', transport: '' } }).html).toContain('A&lt;b&gt;&amp;B')
  })

  it('does not mutate the bill', () => {
    const b = sample('gst'); const s = JSON.stringify(b)
    billToTsv(b)
    expect(JSON.stringify(b)).toBe(s)
  })

  it('billHasContent: empty bill no, party name only yes, a row yes', () => {
    const e = createEmptyBill({ branchId: 'x', rowCount: 3 })
    expect(billHasContent(e)).toBe(false)
    e.party.name = 'A'
    expect(billHasContent(e)).toBe(true)
    expect(billHasContent(sample('gst'))).toBe(true)
  })
})
