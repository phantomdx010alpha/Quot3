import { describe, expect, it } from 'vitest'
import { printFixture } from '../../__fixtures__/printBills'
import { simplePaperDecision } from '../../paper/paperTypes'
import { headerLabelsFrom, resolvePrintSettings } from '../printFlow'
import { buildPrintModel, DEFAULT_PRINT_SETTINGS } from '../printModel'

const labels = (s = DEFAULT_PRINT_SETTINGS): string[] => buildPrintModel(printFixture('legacy'), 'rough', s, simplePaperDecision('A5')).columns.map((c) => c.label).slice(0, 5)

describe('0.1.13 - print / image column headers', () => {
  it('defaults: S.No and Qty (short), the rest keep the format label', () => {
    expect(labels()).toEqual(['S.No', 'Item Name', 'Qty', 'Rate', 'Amount'])
  })
  it('a custom header replaces the default; a blank one falls back', () => {
    expect(labels({ ...DEFAULT_PRINT_SETTINGS, headerLabels: { qty: 'Pcs', name: 'Particulars', rate: '  ' } })).toEqual(['S.No', 'Particulars', 'Pcs', 'Rate', 'Amount'])
  })
  it('the setting is read tolerantly', () => {
    expect(headerLabelsFrom('x')).toEqual({})
    expect(headerLabelsFrom({ qty: 5, rate: ' R ', name: '' })).toEqual({ rate: 'R' })
    expect(resolvePrintSettings({ 'print.headerLabels': { qty: 'Nos' } }).print.headerLabels).toEqual({ qty: 'Nos' })
    expect(resolvePrintSettings({}).print.headerLabels).toBeUndefined()
  })
})
