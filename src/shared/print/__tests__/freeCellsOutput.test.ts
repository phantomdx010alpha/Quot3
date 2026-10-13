import { describe, expect, it } from 'vitest'
import { printFixture } from '../../__fixtures__/printBills'
import { decideForBill, printRowCount } from '../printFlow'
import { simplePaperDecision } from '../../paper/paperTypes'
import { A5_MAX_ROWS } from '../../paper/paperConstants'
import { billToRows, billToTsv } from '../../tsv/billTsv'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../printModel'
import { renderPrintHtml } from '../template/renderHtml'
import type { Bill } from '../../types'

/** Phase 81 - footer extras and tail rows in print model / HTML (print, PDF, image share it) / TSV / paper count. */
const withFree = (): Bill => {
  const b = printFixture('extraCols') // columns c1 'ruby', c2 'tomato'
  b.footerExtras = { grandTotal: { c1: { text: '125 units' } }, itemsTotal: { c2: { text: '7 boxes' } } }
  b.tailRows = [{ extras: { c1: { text: 'tail one' } } }, { extras: {} }, { extras: { c2: { text: 'tail three' } } }]
  return b
}
const model = (b: Bill, mode: 'rough' | 'professional' = 'rough') => buildPrintModel(b, mode, DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'))

describe('Phase 81 - print model', () => {
  it('a bill with no free cells has an empty tail and unchanged footer', () => {
    const m = model(printFixture('extraCols'))
    expect(m.tail).toEqual([])
    for (const r of m.footer) for (const c of m.columns.filter((x) => x.isExtra)) expect(r.cells[c.key]).toBeUndefined()
  })
  it('footer extras land on their own total row only, never with the rupee sign', () => {
    const m = model(withFree())
    const grand = m.footer.find((r) => r.kind === 'grandTotal')!
    const items = m.footer.find((r) => r.kind === 'itemsTotal')
    expect(grand.cells['c1']?.text).toBe('125 units')
    expect(grand.cells['c2']).toBeUndefined()
    if (items) expect(items.cells['c2']?.text).toBe('7 boxes')
    const lastValue = grand.cells['amount'] ?? grand.cells['total']
    expect(lastValue?.text.startsWith('\u20B9')).toBe(true)
  })
  it('tail rows: one print row per paper row, blank rows between kept, only extra columns carry text', () => {
    const m = model(withFree())
    expect(m.tail).toHaveLength(3)
    expect(m.tail.every((r) => r.kind === 'tail')).toBe(true)
    expect(m.tail[0]!.cells['c1']?.text).toBe('tail one')
    expect(m.tail[1]!.cells['c1']?.text).toBe('')
    expect(m.tail[2]!.cells['c2']?.text).toBe('tail three')
    expect(m.tail[0]!.cells['name']?.text).toBe('')
    expect(Object.keys(m.tail[0]!.cells)).toEqual(m.columns.map((c) => c.key))
  })
  it('free cells of a total row that is not shown are not printed', () => {
    const b = printFixture('extraCols')
    b.footerExtras = { adjustmentsTotal: { c1: { text: 'hidden' } } } // no adjustments -> that row is not shown
    const m = model(b)
    expect(JSON.stringify(m.footer)).not.toContain('hidden')
  })
  it('rowCount includes the tail rows, so the paper engine sees them', () => {
    const plain = model(printFixture('extraCols')).rowCount
    expect(model(withFree()).rowCount).toBe(plain + 3)
    expect(printRowCount(withFree(), 'rough')).toBe(plain + 3)
  })
})

describe('Phase 81 - paper decision with tail rows', () => {
  it('tail rows can push a bill over the A5 limit, and only up to the last non-empty row', () => {
    const b = printFixture('rows30')
    const items = printRowCount(b, 'rough')
    expect(items).toBeLessThanOrEqual(A5_MAX_ROWS.rough)
    expect(decideForBill(b, 'rough', { forced: 'auto' }).size).toBe('A5')
    b.extraCols = [{ key: 'c1', header: 'x', kind: 'units' }]
    const room = A5_MAX_ROWS.rough - items
    b.tailRows = Array.from({ length: room }, () => ({ extras: {} }))
    b.tailRows.push({ extras: { c1: { text: 'last' } } })
    expect(printRowCount(b, 'rough')).toBe(items + room + 1)
    expect(decideForBill(b, 'rough', { forced: 'auto' }).size).toBe('A4')
    b.tailRows = [{ extras: { c1: { text: 'one' } } }]
    expect(printRowCount(b, 'rough')).toBe(items + 1)
  })
})

describe('Phase 81 - HTML (print / PDF / image)', () => {
  it('renders the footer extras inside the total row and tail rows in their own group after the totals', () => {
    const html = renderPrintHtml(model(withFree()))
    expect(html).toContain('125 units')
    expect(html).toContain('<tbody class="q3p-tail">')
    expect(html.indexOf('q3p-tail')).toBeGreaterThan(html.indexOf('q3p-foot'))
    expect((html.match(/class="q3p-tailrow"/g) ?? []).length).toBe(3)
    expect(html).toContain('tail three')
  })
  it('no tail group when there are no tail rows; escapes text', () => {
    expect(renderPrintHtml(model(printFixture('extraCols')))).not.toContain('<tbody class="q3p-tail">')
    const b = withFree(); b.tailRows = [{ extras: { c1: { text: '<b>x</b>' } } }]
    const html = renderPrintHtml(model(b))
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
  it('professional mode prints them too', () => {
    expect(renderPrintHtml(model(withFree(), 'professional'))).toContain('tail one')
  })
})

describe('Phase 81 - TSV', () => {
  it('footer extras sit in the extra columns of the total rows; tail rows follow the final total', () => {
    const rows = billToRows(withFree())
    const head = rows.findIndex((r) => r.includes('ruby'))
    const cols = rows[head]!
    const c1 = cols.indexOf('ruby'), c2 = cols.indexOf('tomato')
    const tailStart = rows.length - 3
    expect(rows[tailStart]![c1]).toBe('tail one')
    expect(rows[tailStart + 1]!.every((c) => c === '')).toBe(true)
    expect(rows[tailStart + 2]![c2]).toBe('tail three')
    expect(rows[tailStart]).toHaveLength(cols.length)
    expect(rows[tailStart - 1]![c1]).toBe('125 units') // final total row is the last row before the tail
  })
  it('text and html carry them; no free cells = identical rows to before', () => {
    const t = billToTsv(withFree())
    expect(t.text).toContain('tail three')
    expect(t.html).toContain('<td>tail one</td>')
    const plain = printFixture('extraCols')
    const withEmpty = printFixture('extraCols'); withEmpty.footerExtras = {}; withEmpty.tailRows = []
    expect(billToRows(withEmpty)).toEqual(billToRows(plain))
  })
})
