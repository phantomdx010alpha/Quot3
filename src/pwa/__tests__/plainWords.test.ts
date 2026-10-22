import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { listFormats } from '../../shared/format/registry'
import { plainLabel, plainText, PLAIN_TEXT } from '../ui/kit/plainWords'

// Phase 190 - the plain-word map is keyed by column key, never by format name, and the desktop registry labels stay as they are.
describe('plain words', () => {
  it('renames by column key', () => {
    expect(plainLabel('gstAmt', { hasGstAmtColumn: true })).toBe('GST')
    expect(plainLabel('amount', { hasGstAmtColumn: true })).toBe('Line total')
    expect(plainLabel('total', { hasGstAmtColumn: true })).toBe('Before GST')
    expect(plainLabel('name', { hasGstAmtColumn: true })).toBeUndefined()
  })
  it('"Before GST" only when the format also has a GST amount column; Non-GST keeps "Total"', () => {
    expect(plainLabel('total', { hasGstAmtColumn: false })).toBeUndefined()
  })
  it('works for every registered format from its columns alone (no format-name branching)', () => {
    const formats = listFormats()
    expect(formats.length).toBeGreaterThan(1)
    let withGst = 0
    let withoutGst = 0
    for (const f of formats) {
      const has = f.columns.some((c) => c.key === 'gstAmt')
      const total = f.columns.find((c) => c.key === 'total')
      if (!total) continue
      expect(plainLabel('total', { hasGstAmtColumn: has })).toBe(has ? 'Before GST' : undefined)
      if (has) withGst++; else withoutGst++
    }
    expect(withGst).toBeGreaterThan(0)
    expect(withoutGst).toBeGreaterThan(0)
  })
  it('the desktop registry labels are untouched (the map never edits the registry)', () => {
    const label = (formatKey: string, col: string): string | undefined => listFormats().find((f) => f.id === formatKey)?.columns.find((c) => c.key === col)?.label
    expect(label('gst', 'total')).toBe('Total')
    expect(label('gst', 'gstAmt')).toBe('GST Amt')
    expect(label('gst', 'amount')).toBe('Amount')
    // Finding (Phase 190): the Non-GST registry calls its `total` column "Amount", not "Total" as MILESTONE18_DESIGN.md section 7 says. The map leaves
    // it alone (undefined = keep the registry label), so a Non-GST bill shows exactly what the registry says.
    expect(label('non_gst', 'total')).toBe('Amount')
    expect(plainLabel('total', { hasGstAmtColumn: false })).toBeUndefined()
  })
  it('renames screen strings and leaves any other string alone', () => {
    expect(plainText('Total (typed)')).toBe('Set price yourself')
    expect(plainText('Last export')).toBe('Last backup')
    expect(plainText('Branch and sync')).toBe('Connect to your PC')
    expect(plainText('PO prefix')).toBe('Bill number letters')
    expect(plainText('Something else')).toBe('Something else')
    expect(Object.keys(PLAIN_TEXT)).toHaveLength(4)
  })
})
