import { describe, expect, it } from 'vitest'
import { getFormat, listFormats, resolveFormat, validateFormat } from '../registry'
import { computeBill } from '../../calc/billTotals'
import { calcRow, formatHasMoney } from '../../calc/rowCalc'
import { applyCellText } from '../../gridEdit'
import { buildGridColumns } from '../../gridModel'
import { createEmptyBill, deserializeBill, normalizeBill, serializeBill } from '../../billModel'
import { validateBillForSave } from '../../billSave'
import { saleLine } from '../../items/sales'
import { billToRows } from '../../tsv/billTsv'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS, printColumnShares } from '../../print/printModel'
import { renderPrintHtml } from '../../print/template/renderHtml'
import { simplePaperDecision } from '../../paper/paperTypes'
import { PRINT_WIDTH_TOTAL } from '../../print/printConstants'
import { allActions, matchShortcut, findShortcutConflicts } from '../../shortcuts'
import { row } from '../../__fixtures__/bills'
import type { Bill, BillRow } from '../../types'

const ST = () => getFormat('stock_transfer')
const col = (id: string, key: string) => buildGridColumns(getFormat(id), []).find((c) => c.key === key)!

function transferBill(rows: BillRow[], over: Partial<Bill> = {}): Bill {
  const b = createEmptyBill({ branchId: 'br1', formatId: 'stock_transfer' })
  return { ...b, party: { name: 'Hubli', phone: '', address: '', transport: '' }, rows, ...over }
}

describe('Phase 149 - Stock transfer registry entry', () => {
  it('is one registry entry: Item Name + Qty only, Alt+4, no totals, branch header', () => {
    const f = ST()
    expect(f.columns.map((c) => c.key)).toEqual(['name', 'qty'])
    expect(f).toMatchObject({ id: 'stock_transfer', label: 'Stock transfer', shortcut: 'Alt+4', footer: 'none', partyMode: 'branch', docTitle: 'Stock transfer' })
    expect(col('stock_transfer', 'qty').kind).toBe('text')
    expect(f.isDefault).toBeFalsy()
    expect(listFormats().map((x) => x.id)).toEqual(['non_gst', 'gst', 'stock_transfer'])
    expect(() => validateFormat(f)).not.toThrow()
    expect(formatHasMoney(f)).toBe(false)
    expect(formatHasMoney(getFormat('gst'))).toBe(true)
    expect(formatHasMoney(getFormat('non_gst'))).toBe(true)
  })
  it('Alt+4 and a palette entry come from the registry (no other shortcut change, no conflicts)', () => {
    expect(matchShortcut({ key: '4', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false })?.action).toBe('format.set.stock_transfer')
    expect(allActions().some((a) => a.id === 'format.set.stock_transfer' && a.label === 'Switch to Stock transfer')).toBe(true)
    expect(findShortcutConflicts()).toEqual([])
  })
  it('an unknown / stored id still falls back to the default; the new id resolves', () => {
    expect(resolveFormat('stock_transfer').id).toBe('stock_transfer')
    expect(resolveFormat('nope').id).toBe('non_gst')
  })
})

describe('Phase 149 - calc: no money, no totals', () => {
  const rows = [row('Ruby gold belt', 'two dozen', null), row('Talco 2044', '12', '90'), row('Needles', null, null)]
  it('calcRow does no maths and raises no number warning for a word qty', () => {
    const c = calcRow(ST(), rows[0]!)
    expect(c).toMatchObject({ total: null, gstAmt: null, amount: null, isOverride: false, auto: null })
    expect(c.warnings).toEqual([])
  })
  it('computeBill returns no footer row at all, zero amounts and item counts for paper', () => {
    const t = computeBill(ST(), rows)
    expect(t.display.map((d) => d.kind)).toEqual(['item', 'item', 'partial'])
    expect(t.grandTotal).toBe('0.00')
    expect(t.itemsTotal).toBe('0.00')
    expect(t.counts).toEqual({ itemRows: 2, adjustmentRows: 0, paperRows: 2 })
    expect(t.display[0]!.cells['qty']).toBe('two dozen')
    expect(t.display[1]!.cells['qty']).toBe('12')
    expect(t.warnings).toEqual([])
  })
  it('a leftover total override (from another format) is not an adjustment here: the row stays visible, nothing is totalled', () => {
    const t = computeBill(ST(), [row('Discount', null, null, { total: '-250' })])
    expect(t.display.map((d) => d.kind)).toEqual(['partial'])
    expect(t.adjustments).toEqual([])
    expect(t.grandTotal).toBe('0.00')
  })
  it('a nameless qty row is flagged MISSING_NAME only', () => {
    expect(computeBill(ST(), [row('', '5', null)]).warnings).toEqual([expect.stringMatching(/^MISSING_NAME:/)])
  })
  it('the other formats are unchanged: a word qty is flagged and not multiplied', () => {
    const t = computeBill(getFormat('non_gst'), [row('X', 'two dozen', '10')])
    expect(t.grandTotal).toBe('0.00')
    expect(t.warnings.some((w) => w.startsWith('INVALID_NUMBER'))).toBe(true)
    expect(t.display[0]!.cells['qty']).toBe('two dozen')
    expect(computeBill(getFormat('non_gst'), [row('X', '2', '10')]).grandTotal).toBe('20.00')
  })
})

describe('Phase 149 - free-text qty is for this format only', () => {
  const r0 = row('Ruby', null, null)
  it('Stock transfer qty accepts words and numbers as typed (trimmed)', () => {
    expect(applyCellText(r0, col('stock_transfer', 'qty'), '  two dozen ')).toEqual({ qty: 'two dozen' })
    expect(applyCellText(r0, col('stock_transfer', 'qty'), '12')).toEqual({ qty: '12' })
    expect(applyCellText(row('R', '12', null), col('stock_transfer', 'qty'), '')).toEqual({ qty: null })
    expect(applyCellText(row('R', '12', null), col('stock_transfer', 'qty'), '12')).toBeNull()
    expect(applyCellText(r0, col('stock_transfer', 'qty'), 'x'.repeat(300))!.qty).toHaveLength(200)
  })
  it('GST and Non-GST qty still reject words', () => {
    for (const id of ['gst', 'non_gst']) {
      expect(applyCellText(r0, col(id, 'qty'), 'two dozen')).toBeNull()
      expect(applyCellText(r0, col(id, 'qty'), '12')).toEqual({ qty: '12' })
    }
  })
  it('the Stock transfer qty column is a text cell for the keyboard (not numeric)', async () => {
    const { isNumericColumn } = await import('../../gridEdit')
    expect(isNumericColumn(col('stock_transfer', 'qty'))).toBe(false)
    expect(isNumericColumn(col('non_gst', 'qty'))).toBe(true)
  })
})

describe('Phase 149 - save / load and format switching never lose data', () => {
  it('normalizeBill keeps a word qty and still cleans numbers as before', () => {
    const b = normalizeBill(transferBill([row('A', ' two dozen ', null), row('B', '12.', null), row('C', '+3', null), row('D', '  ', null)]))
    expect(b.rows.map((r) => r.qty)).toEqual(['two dozen', '12', '3', null])
  })
  it('serialize -> deserialize round trip keeps the qty text, the branch name and the format', () => {
    const src = normalizeBill(transferBill([row('Ruby gold belt', 'two dozen', null), row('Talco', '12', null)]))
    const s = serializeBill(src)
    const back = deserializeBill(s.bill, s.rows)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.data.formatId).toBe('stock_transfer')
    expect(back.data.party.name).toBe('Hubli')
    expect(back.data.rows.map((r) => r.qty)).toEqual(['two dozen', '12'])
  })
  it('switching format back and forth changes nothing in the rows (rate / GST / override survive a visit to Stock transfer)', () => {
    const rows = [row('Pen', '2', '10', { gst: '18', total: '25' }), row('Ink', 'two dozen', '5')]
    const before = JSON.stringify(rows)
    for (const id of ['stock_transfer', 'gst', 'stock_transfer', 'non_gst']) {
      computeBill(resolveFormat(id), rows)
      buildGridColumns(resolveFormat(id), [])
    }
    expect(JSON.stringify(rows)).toBe(before)
    expect(computeBill(getFormat('non_gst'), [rows[0]!]).grandTotal).toBe('25.00') // the override is still there
  })
  it('a Stock transfer bill survives the same row-level clean-up as any bill (extras kept)', () => {
    const r = row('Pen', '5 boxes', null, { extras: { c1: { text: '3 cartons' } } })
    const b = normalizeBill(transferBill([r], { extraCols: [{ key: 'c1', header: 'Col 1', kind: 'units' }] }))
    expect(b.rows[0]!.extras['c1']!.text).toBe('3 cartons')
    expect(b.rows[0]!.qty).toBe('5 boxes')
  })
})

describe('Phase 149 - save rules', () => {
  const ok = [row('Pen', 'two dozen', null)]
  it('needs the branch (message says so) and at least one item with a qty', () => {
    const noBranch = validateBillForSave({ party: { name: '  ', phone: '', address: '', transport: '' }, rows: ok, formatId: 'stock_transfer' })
    expect(noBranch?.code).toBe('PARTY_NAME_REQUIRED')
    expect(noBranch?.message).toMatch(/branch/i)
    expect(validateBillForSave({ party: { name: 'Hubli', phone: '', address: '', transport: '' }, rows: ok, formatId: 'stock_transfer' })).toBeNull()
    expect(validateBillForSave({ party: { name: 'Hubli', phone: '', address: '', transport: '' }, rows: [row('Pen', null, null)], formatId: 'stock_transfer' })?.code).toBe('NO_ROWS')
    // an adjustment-looking row does not count here
    expect(validateBillForSave({ party: { name: 'Hubli', phone: '', address: '', transport: '' }, rows: [row('Disc', null, null, { total: '-5' })], formatId: 'stock_transfer' })?.code).toBe('NO_ROWS')
  })
  it('other formats keep the party wording and the adjustment rule', () => {
    expect(validateBillForSave({ party: { name: '', phone: '', address: '', transport: '' }, rows: [], formatId: 'non_gst' })?.message).toMatch(/party/i)
    expect(validateBillForSave({ party: { name: 'P', phone: '', address: '', transport: '' }, rows: [row('Disc', null, null, { total: '-5' })], formatId: 'non_gst' })).toBeNull()
    expect(validateBillForSave({ party: { name: 'P', phone: '', address: '', transport: '' }, rows: ok })).toBeNull() // no formatId = default format, as before
  })
})

describe('Phase 149 - not a sale, and print', () => {
  it('Items sales ignore Stock transfer rows', () => {
    const head = { billId: 'b', poNumber: 'Q3-1', billDate: '2026-10-14', createdAt: '2026-10-14T00:00:00Z', partyId: null, partyName: 'Hubli', legacyRef: null }
    expect(saleLine(ST(), head, row('Pen', '12', null))).toBeNull()
    expect(saleLine(getFormat('non_gst'), head, row('Pen', '12', '5'))).not.toBeNull()
  })
  it('print columns: widths still total exactly 100% with 0..4 extra columns', () => {
    for (let n = 0; n <= 4; n++) {
      const s = printColumnShares(ST(), n)
      expect(s).toHaveLength(2 + n)
      expect(s.reduce((a, b) => a + b, 0)).toBe(PRINT_WIDTH_TOTAL)
    }
  })
  const bill = transferBill([row('Ruby gold belt', 'two dozen', null), row('Talco', '12', null)], { poNumber: 'Q3-0007' })
  it('rough: titled Stock transfer with the branch, two columns, no totals, qty text printed', () => {
    const m = buildPrintModel(bill, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5'))
    expect(m.formatId).toBe('stock_transfer')
    expect(m.columns.map((c) => c.key)).toEqual(['name', 'qty'])
    expect(m.footer).toEqual([])
    expect(m.body.map((r) => r.cells['qty']?.text)).toEqual(['two dozen', '12'])
    const html = renderPrintHtml(m)
    expect(html).toContain('Stock transfer')
    expect(html).toContain('From branch:')
    expect(html).toContain('Hubli')
    expect(html).not.toContain('Quotation')
    expect(html).not.toMatch(/Total/)
  })
  it('professional: "Stock transfer from <branch>", PO and date kept, no party phone / address lines', () => {
    const m = buildPrintModel({ ...bill, party: { name: 'Hubli', phone: '999', address: 'Old address', transport: 'Old transport' } }, 'professional', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A4'))
    const html = renderPrintHtml(m)
    expect(html).toContain('Stock transfer from')
    expect(html).toContain('Hubli')
    expect(html).toContain('Q3-0007')
    expect(html).not.toContain('Old address')
    expect(html).not.toContain('Old transport')
    expect(html).not.toContain('999')
    expect(m.footer).toEqual([])
  })
  it('copy as TSV: title, branch line, two-column table, no total row', () => {
    const rows = billToRows(bill)
    expect(rows.slice(0, 3)).toEqual([['Stock transfer'], ['From branch', 'Hubli'], []])
    expect(rows.slice(3)).toEqual([['Item Name', 'Qty'], ['Ruby gold belt', 'two dozen'], ['Talco', '12']])
  })
  it('a quotation bill prints exactly as before (title is the party, "Quotation for")', () => {
    const q = { ...bill, formatId: 'non_gst', rows: [row('Pen', '2', '10')] }
    expect(renderPrintHtml(buildPrintModel(q, 'professional', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5')))).toContain('Quotation for')
    expect(renderPrintHtml(buildPrintModel(q, 'rough', DEFAULT_PRINT_SETTINGS, simplePaperDecision('A5')))).not.toContain('From branch:')
  })
})
