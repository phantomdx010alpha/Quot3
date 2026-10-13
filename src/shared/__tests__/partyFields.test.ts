import { describe, expect, it } from 'vitest'
import { PARTY_FIELD_MAX, atEndEdge, finalizePartyField, isValidBillDate, sanitizePartyField, withPartyField } from '../partyFields'
import { EMPTY_PARTY } from '../billModel'

describe('party field rules (Phase 25)', () => {
  it('single-line fields turn line breaks and tabs into one space; the address keeps lines', () => {
    expect(sanitizePartyField('name', 'Ruby\r\nTraders\tLtd')).toBe('Ruby Traders Ltd')
    expect(sanitizePartyField('phone', '98\n76')).toBe('98 76')
    expect(sanitizePartyField('address', '12 Main St\r\nBengaluru\rKA')).toBe('12 Main St\nBengaluru\nKA')
  })
  it('caps by grapheme-safe code points (emoji are not cut in half) and keeps typing spaces', () => {
    const long = '😀'.repeat(PARTY_FIELD_MAX.name + 10)
    const out = sanitizePartyField('name', long)
    expect(Array.from(out)).toHaveLength(PARTY_FIELD_MAX.name)
    expect(out.endsWith('😀')).toBe(true)
    expect(sanitizePartyField('name', 'Ruby ')).toBe('Ruby ')
  })
  it('finalize trims; address lines trimmed and blank edges dropped', () => {
    expect(finalizePartyField('name', '  Ruby  ')).toBe('Ruby')
    expect(finalizePartyField('address', '\n  12 Main St  \n  KA \n\n')).toBe('12 Main St\nKA')
  })
  it('withPartyField returns the SAME object when unchanged, a new one otherwise (never mutates)', () => {
    const p = { ...EMPTY_PARTY }
    expect(withPartyField(p, 'name', '')).toBe(p)
    const n = withPartyField(p, 'name', 'Ruby')
    expect(n).not.toBe(p)
    expect(n.name).toBe('Ruby')
    expect(p.name).toBe('')
    expect(withPartyField(n, 'name', 'Ruby')).toBe(n)
  })
  it('isValidBillDate: real calendar dates only, leap years by hand', () => {
    for (const ok of ['2026-10-08', '2024-02-29', '2000-02-29', '2026-12-31']) expect(isValidBillDate(ok), ok).toBe(true)
    for (const bad of ['', '2026-13-01', '2026-00-10', '2026-02-29', '1900-02-29', '2026-04-31', '2026-1-1', '26-10-08', '2026-10-8x']) expect(isValidBillDate(bad), bad).toBe(false)
  })
  it('atEndEdge: caret at the end with no selection', () => {
    expect(atEndEdge('abc', 3, 3)).toBe(true)
    expect(atEndEdge('abc', 2, 2)).toBe(false)
    expect(atEndEdge('abc', 0, 3)).toBe(false)
    expect(atEndEdge('', 0, 0)).toBe(true)
    expect(atEndEdge('abc', null, null)).toBe(false)
  })
})
