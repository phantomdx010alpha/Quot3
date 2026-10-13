import { describe, it, expect } from 'vitest'
import { applyCellText, cellRawText, isTypable, isValidNumericDraft, sanitizeNumericPaste, setPlainName, allowsNegative, runsToPlain } from '../gridEdit'
import { createEmptyRow } from '../billModel'
import { buildGridColumns } from '../gridModel'
import { getFormat } from '../format/registry'
import type { BillRow } from '../types'

const cols = buildGridColumns(getFormat('non_gst'), [{ key: 'x1', header: 'ruby', kind: 'units' }])
const col = (k: string) => cols.find((c) => c.key === k)!
const row = (p: Partial<BillRow> = {}): BillRow => ({ ...createEmptyRow(0, () => 'r1'), ...p })

describe('gridEdit', () => {
  it('numeric draft validator', () => {
    for (const ok of ['', '1', '12.5', '.5', '12.', '-', '-1.5']) expect(isValidNumericDraft(ok, true)).toBe(true)
    for (const bad of ['a', '1.2.3', '1-', '--1', '1e3', ' 1']) expect(isValidNumericDraft(bad, true)).toBe(false)
    expect(isValidNumericDraft('-1', false)).toBe(false)
    expect(allowsNegative('total')).toBe(true)
    expect(allowsNegative('qty')).toBe(false)
  })
  it('typable: Sl.No/derived read-only; Total is typable (Phase 13 override)', () => {
    expect(isTypable(col('slNo'))).toBe(false)
    expect(isTypable(col('total'))).toBe(true)
    expect(isTypable(col('name'))).toBe(true)
    expect(isTypable(col('x1'))).toBe(true)
  })
  it('registry-editable columns are the navigable ones', () => {
    expect(cols.filter((c) => c.editable).map((c) => c.key)).toEqual(['name', 'rate', 'qty', 'total', 'x1'])
  })
  it('setPlainName keeps style when appending, truncates on delete, flattens otherwise', () => {
    const runs = [{ t: 'ruby ' }, { t: 'gold', r: 1 as const, b: 1 as const }]
    expect(setPlainName(runs, 'ruby gold')).toBe(runs)
    expect(setPlainName(runs, 'ruby gold!')).toEqual([{ t: 'ruby ' }, { t: 'gold!', r: 1, b: 1 }])
    expect(setPlainName(runs, 'ruby go')).toEqual([{ t: 'ruby ' }, { t: 'go', r: 1, b: 1 }])
    expect(setPlainName(runs, 'rub')).toEqual([{ t: 'rub' }])
    expect(setPlainName(runs, 'xruby gold')).toEqual([{ t: 'xruby gold' }])
    expect(setPlainName(runs, '')).toEqual([])
    expect(runsToPlain(setPlainName([], 'new'))).toBe('new')
  })
  it('applyCellText: numbers normalise, blank clears, invalid draft reverts (null patch)', () => {
    const r = row({ qty: '10', rate: '90' })
    expect(applyCellText(r, col('qty'), '12.')).toEqual({ qty: '12' })
    expect(applyCellText(r, col('qty'), '.5')).toEqual({ qty: '0.5' })
    expect(applyCellText(r, col('qty'), '')).toEqual({ qty: null })
    expect(applyCellText(r, col('qty'), '-')).toBeNull()
    expect(applyCellText(r, col('qty'), '.')).toBeNull()
    expect(applyCellText(r, col('qty'), '-5')).toBeNull() // D-M7
    expect(applyCellText(r, col('qty'), '10')).toBeNull() // unchanged
    expect(applyCellText(r, col('slNo'), '5')).toBeNull()
  })
  it('applyCellText: name and extras (extras keep the mark)', () => {
    const r = row({ extras: { x1: { text: '5-4', marked: true } } })
    expect(applyCellText(r, col('name'), 'abc')).toEqual({ nameRuns: [{ t: 'abc' }] })
    expect(applyCellText(r, col('x1'), '7')).toEqual({ extras: { x1: { text: '7', marked: true } } })
    expect(applyCellText(row(), col('x1'), '7')).toEqual({ extras: { x1: { text: '7' } } })
    expect(cellRawText(r, 'x1', 'shown')).toBe('5-4')
    expect(cellRawText(row(), 'x1', 'shown')).toBe('shown')
  })
})

describe('Phase 12 numeric paste sanitiser', () => {
  it('strips commas, spaces, currency prefix and trailing /-', () => {
    expect(sanitizeNumericPaste('1,25,000.50', '', 0, 0, false)).toBe('125000.50')
    expect(sanitizeNumericPaste(' 90 ', '', 0, 0, false)).toBe('90')
    expect(sanitizeNumericPaste('₹ 1,250', '', 0, 0, false)).toBe('1250')
    expect(sanitizeNumericPaste('Rs. 500/-', '', 0, 0, false)).toBe('500')
    expect(sanitizeNumericPaste('INR75', '', 0, 0, false)).toBe('75')
  })
  it('rejects anything not a number, whole', () => {
    for (const bad of ['1e3', '12abc', '1.2.3', '(5)', '', '   ', 'NaN', '0x10']) {
      expect(sanitizeNumericPaste(bad, '', 0, 0, true)).toBeNull()
    }
  })
  it('judges the RESULTING cell text (one dot, leading minus only)', () => {
    expect(sanitizeNumericPaste('.5', '1', 1, 1, false)).toBe('.5') // 1.5
    expect(sanitizeNumericPaste('.5', '1.2', 3, 3, false)).toBeNull() // 1.2.5
    expect(sanitizeNumericPaste('3', '1.2', 0, 3, false)).toBe('3') // replaces selection
    expect(sanitizeNumericPaste('5', '-2', 0, 0, true)).toBeNull() // digit before a leading minus
    expect(sanitizeNumericPaste('5', '-2', 1, 1, true)).toBe('5')
  })
  it('negatives only where allowed (Total), including the unicode minus', () => {
    expect(sanitizeNumericPaste('-50', '', 0, 0, true)).toBe('-50')
    expect(sanitizeNumericPaste('\u221250', '', 0, 0, true)).toBe('-50')
    expect(sanitizeNumericPaste('-50', '', 0, 0, false)).toBeNull() // qty / rate / GST % (D-M7)
    expect(sanitizeNumericPaste('5-0', '', 0, 0, true)).toBeNull()
  })
})

describe('Phase 13 Total override text', () => {
  const c = col('total')
  const r = row({ qty: '10', rate: '90' })
  it('typing a different value sets the override; blank resets; invalid reverts', () => {
    expect(applyCellText(r, c, '875.5', { display: '900.00' })).toEqual({ totalOverride: '875.5' })
    expect(applyCellText(r, c, '-50', { display: '900.00' })).toEqual({ totalOverride: '-50' })
    expect(applyCellText(r, c, '12.', { display: '900.00' })).toEqual({ totalOverride: '12' })
    expect(applyCellText(r, c, '.5', { display: '900.00' })).toEqual({ totalOverride: '0.5' })
    expect(applyCellText(r, c, '-', { display: '900.00' })).toBeNull()
    expect(applyCellText(r, c, '.', { display: '900.00' })).toBeNull()
    expect(applyCellText(row({ totalOverride: '5' }), c, '', { display: '5.00' })).toEqual({ totalOverride: null })
    expect(applyCellText(r, c, '', { display: '900.00' })).toBeNull() // nothing to reset
  })
  it('merely visiting (text equals what the cell showed) never creates an override', () => {
    expect(applyCellText(r, c, '900.00', { display: '900.00' })).toBeNull()
    expect(applyCellText(r, c, '900', { display: '900.00' })).toBeNull()
    expect(applyCellText(row({ totalOverride: '875.5' }), c, '875.50', { display: '875.50' })).toBeNull()
  })
})
