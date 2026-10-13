import { describe, expect, it } from 'vitest'
import { autoDetectMapping, cleanCell, describeReport, detectHeaderRow, headerKey, phoneKey, planImport, summarizePlan, valueToText, emptyMapping } from '../partyImport'
import type { PartyLite } from '../../party/partyLite'

const party = (id: string, name: string, phone = '', address = '', transport = ''): PartyLite => ({ id, name, phone, address, transport })
const M = { name: 0, phone: 1, address: 2, transport: 3 }

describe('header spellings', () => {
  it('headerKey ignores case, spaces, punctuation', () => { expect(headerKey(' Party_Name. ')).toBe('partyname'); expect(headerKey('Mobile No.')).toBe('mobileno') })
  it('auto-detects the usual spellings, no column twice', () => {
    expect(autoDetectMapping(['S.No', 'Customer Name', 'Mobile No', 'Address', 'Transporter'])).toEqual({ name: 1, phone: 2, address: 3, transport: 4 })
    expect(autoDetectMapping(['PARTY', 'Contact', 'City'])).toEqual({ name: 0, phone: 1, address: 2, transport: null })
    expect(autoDetectMapping(['Foo', 'Bar'])).toEqual(emptyMapping())
  })
  it('finds the header row below a title block', () => {
    expect(detectHeaderRow([['Sharma Traders - party list'], [''], ['Sl', 'Party Name', 'Phone'], ['1', 'A', '1']])).toBe(3)
    expect(detectHeaderRow([['x', 'y'], ['1', '2']])).toBe(1)
    expect(detectHeaderRow([])).toBe(1)
  })
})

describe('cell text', () => {
  it('numbers, rich text, formulas, hyperlinks, dates', () => {
    expect(valueToText(9845011001)).toBe('9845011001')
    expect(valueToText(12.5)).toBe('12.5')
    expect(valueToText({ richText: [{ text: 'Ru' }, { text: 'by' }] })).toBe('Ruby')
    expect(valueToText({ formula: 'A1', result: 'Zed' })).toBe('Zed')
    expect(valueToText({ text: 'Mail', hyperlink: 'mailto:a@b' })).toBe('Mail')
    expect(valueToText(new Date('2026-10-09T00:00:00Z'))).toBe('2026-10-09')
    expect(valueToText(null)).toBe('')
    expect(valueToText({ error: '#N/A' })).toBe('')
  })
  it('cleans one-line fields and joins address lines', () => {
    expect(cleanCell('name', '  Ruby \n Traders ')).toBe('Ruby Traders')
    expect(cleanCell('address', '12 Main Rd\n  Bengaluru \n560001')).toBe('12 Main Rd, Bengaluru, 560001')
  })
  it('phoneKey compares digits, last 10', () => {
    expect(phoneKey('+91 98450-11001')).toBe('9845011001')
    expect(phoneKey('098450 11001')).toBe('9845011001')
    expect(phoneKey('12')).toBe('')
  })
})

describe('planImport', () => {
  const existing = [party('p1', 'Ruby Traders', '98450 11001', '1 Main Rd', 'VRL'), party('p2', 'Zed & Co', '', '', '')]
  const run = (rows: string[][], mode: 'skip' | 'update' = 'skip') => planImport({ rows, firstRowNumber: 2, mapping: M, existing, mode })

  it('new, blank, invalid, repeated, duplicate in skip mode', () => {
    const r = run([
      ['New Party', '99999 88888', 'Addr', 'SRS'],
      ['', '', '', ''],
      ['', '12345 67890', '', ''],
      ['new  party', '', '', ''],
      ['RUBY TRADERS', '+91 9845011001', '', '']
    ])
    expect(r.map((x) => x.status)).toEqual(['new', 'blank', 'invalid', 'repeated', 'duplicate'])
    expect(r.map((x) => x.row)).toEqual([2, 3, 4, 5, 6])
    expect(r[3]!.reason).toContain('row 2')
    expect(r[4]!.targetId).toBe('p1')
    expect(summarizePlan(r)).toEqual({ new: 1, update: 0, duplicate: 1, repeated: 1, invalid: 1, blank: 1 })
  })
  it('flags a different phone on an existing name, and a same phone on a new name, without blocking', () => {
    const r = run([['Ruby Traders', '70000 00000', '', ''], ['Brand New', '98450 11001', '', '']])
    expect(r[0]!.status).toBe('duplicate'); expect(r[0]!.reason).toContain('phone differs')
    expect(r[1]!.status).toBe('new'); expect(r[1]!.reason).toContain('Ruby Traders')
  })
  it('update mode: only non-blank, different values change; nothing new = duplicate', () => {
    const r = run([['Ruby Traders', '', '2 New Rd', ''], ['Zed & Co', '88888 77777', '', ''], ['Ruby Traders ', '98450 11001', '', '']].map((x, i) => (i === 2 ? ['Zed & Co', '88888 77777', '', ''] : x)), 'update')
    expect(r[0]).toMatchObject({ status: 'update', changes: ['address'] })
    expect(r[1]).toMatchObject({ status: 'update', changes: ['phone'] })
    expect(r[2]!.status).toBe('repeated')
    const same = run([['Ruby Traders', '98450 11001', '1 Main Rd', 'VRL']], 'update')
    expect(same[0]!.status).toBe('duplicate')
  })
  it('too-long fields are problems, not crashes', () => {
    const r = run([['x'.repeat(121), '', '', '']])
    expect(r[0]!.status).toBe('invalid'); expect(r[0]!.reason).toContain('too long')
  })
  it('short rows (missing trailing cells) are fine; describeReport wording', () => {
    expect(run([['Only Name']])[0]!.status).toBe('new')
    expect(describeReport({ created: 3, updated: 1, skipped: 2, invalid: 0 })).toBe('3 added, 1 updated, 2 skipped')
    expect(describeReport({ created: 0, updated: 0, skipped: 0, invalid: 2 })).toContain('2 with problems')
  })
})
