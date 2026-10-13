import { describe, expect, it } from 'vitest'
import { parseUnits } from '../parseUnits'
import { summarizeUnits, unitsSummaryToText, UNLABELLED_MARK } from '../summarizeUnits'
import { EXPECTED, LEGACY_EXTRA_COLS, legacyRubyTomatoRows } from './fixtures/legacy_ruby_tomato'
import { row } from '../../__fixtures__/bills'
import type { BillRow, ExtraCell, ExtraColDef } from '../../types'

describe('parseUnits — §2 examples table', () => {
  const cases: [string, string | null, string, boolean][] = [
    ['(125-5)', '125', '5', true],
    ['11.5-1', '11.5', '1', true],
    ['25651-45', '25651', '45', true],
    ['5\u20144', '5', '4', true],
    ['8800=2', '8800', '2', true],
    ['25-B-3', '25-B', '3', true],
    ['idk bruhh', null, '0', false],
    ['', null, '0', false],
    ['12-', null, '0', false],
    ['7-x', null, '0', false],
    ['{125-5}', '125', '5', true]
  ]
  it.each(cases)('%j → code %j, units %s, parsed %s', (text, code, units, parsed) => {
    expect(parseUnits(text)).toEqual({ code, units, parsed })
  })
})

describe('parseUnits — more separators, brackets, fractions', () => {
  it('en dash and minus sign', () => {
    expect(parseUnits('9\u20132')).toMatchObject({ code: '9', units: '2', parsed: true })
    expect(parseUnits('9\u22123')).toMatchObject({ code: '9', units: '3', parsed: true })
  })
  it('spaces around separators and wrapping are ignored', () => {
    expect(parseUnits('  ( 125 - 5 )  ')).toMatchObject({ code: '125', units: '5', parsed: true })
  })
  it('square brackets', () => expect(parseUnits('[7-2]')).toMatchObject({ code: '7', units: '2', parsed: true }))
  it('stray trailing brackets (legacy "}" endings)', () => {
    expect(parseUnits('black-2}')).toMatchObject({ code: 'black', units: '2', parsed: true })
    expect(parseUnits('1163-2})')).toMatchObject({ code: '1163', units: '2', parsed: true })
    expect(parseUnits('(125-5')).toMatchObject({ code: '(125', units: '5', parsed: true }) // only trailing strays are stripped
  })
  it('mismatched wrapper is not stripped as a pair, trailing stray still goes', () => {
    expect(parseUnits('(125-5]')).toMatchObject({ code: '(125', units: '5', parsed: true })
  })
  it('fractional units, no trailing .0', () => {
    expect(parseUnits('12-0.5')).toMatchObject({ units: '0.5', parsed: true })
    expect(parseUnits('12-5.0')).toMatchObject({ units: '5', parsed: true })
    expect(parseUnits('12-2.50')).toMatchObject({ units: '2.5', parsed: true })
  })
  it('only the last separator counts', () => {
    expect(parseUnits('1-2-3-4')).toMatchObject({ code: '1-2-3', units: '4' })
  })
  it('non-numeric tails are not parsed: negative, exponent, ".5", "5.", words', () => {
    for (const t of ['A--5x', '5-1e3', '5-.5', '5-5.', '5-five', '-5', '=3', '()', '-']) {
      expect(parseUnits(t)).toEqual({ code: null, units: '0', parsed: false })
    }
  })
  it('null / undefined / whitespace are unparsed', () => {
    expect(parseUnits(null).parsed).toBe(false)
    expect(parseUnits(undefined).parsed).toBe(false)
    expect(parseUnits('   ').parsed).toBe(false)
  })
  it('units are exact decimals', () => {
    expect(parseUnits('x-0.1').units).toBe('0.1')
    expect(parseUnits('x-12345678901234567890.123').units).toBe('12345678901234567890.123')
  })
})

describe('summarizeUnits — legacy ruby/tomato fixture', () => {
  const s = summarizeUnits(legacyRubyTomatoRows(), LEGACY_EXTRA_COLS)
  it('ruby = 12, marked "idk bruhh" = 55, tomato = 7', () => {
    const [ruby, tomato] = s.byColumn
    expect(ruby?.base).toEqual({ label: 'ruby', units: EXPECTED.ruby })
    expect(ruby?.marked.map((m) => [m.label, m.units])).toEqual([['idk bruhh', EXPECTED.idkBruhh]])
    expect(tomato?.base).toEqual({ label: 'tomato', units: EXPECTED.tomato })
    expect(tomato?.marked).toEqual([])
  })
  it('text output for both views', () => {
    expect(unitsSummaryToText(s, 'units')).toBe('Column: ruby\n  ruby = 12\nColumn: tomato\n  tomato = 7')
    expect(unitsSummaryToText(s, 'marked')).toBe('Column: ruby\n  idk bruhh = 55')
  })
  it('the marked cell’s own trailing number is not counted (D-X1)', () => {
    const rows = legacyRubyTomatoRows()
    rows[13]!.extras.ruby = { text: 'idk bruhh-99', marked: true }
    expect(summarizeUnits(rows, LEGACY_EXTRA_COLS).byColumn[0]?.marked[0]?.units).toBe('55')
  })
  it('unmarking merges the segment back into the base', () => {
    const rows = legacyRubyTomatoRows()
    rows[13]!.extras.ruby = { text: 'idk bruhh' }
    const ruby = summarizeUnits(rows, LEGACY_EXTRA_COLS).byColumn[0]!
    expect(ruby.base.units).toBe('67')
    expect(ruby.marked).toEqual([])
  })
  it('the marked rowId is the marked row', () => {
    const rows = legacyRubyTomatoRows()
    expect(summarizeUnits(rows, LEGACY_EXTRA_COLS).byColumn[0]?.marked[0]?.rowId).toBe(rows[13]!.id)
  })
})

describe('summarizeUnits — segments and edge cases', () => {
  const cols: ExtraColDef[] = [{ key: 'a', header: 'Col 1', kind: 'units' }]
  const mk = (cells: (string | ExtraCell | undefined)[]): BillRow[] =>
    cells.map((c) => {
      const r = row('x', '1', '1')
      if (c !== undefined) r.extras.a = typeof c === 'string' ? { text: c } : c
      return r
    })

  it('no rows / no columns', () => {
    expect(summarizeUnits([], cols).byColumn[0]).toMatchObject({ base: { label: 'Col 1', units: '0' }, marked: [] })
    expect(summarizeUnits(mk(['1-1']), []).byColumn).toEqual([])
  })
  it('a header with nothing parsed is still listed with 0', () => {
    expect(summarizeUnits(mk(['abc', '', undefined]), cols).byColumn[0]?.base.units).toBe('0')
  })
  it('marked first row: base is 0, segment starts at row 1', () => {
    const c = summarizeUnits(mk([{ text: 'Top', marked: true }, '1-3', '1-4']), cols).byColumn[0]!
    expect(c.base.units).toBe('0')
    expect(c.marked).toEqual([expect.objectContaining({ label: 'Top', units: '7' })])
  })
  it('several marks: each segment runs to the next mark', () => {
    const c = summarizeUnits(mk(['1-1', { text: 'B', marked: true }, '2-2', '2-3', { text: 'C', marked: true }, '3-4']), cols).byColumn[0]!
    expect(c.base.units).toBe('1')
    expect(c.marked.map((m) => [m.label, m.units])).toEqual([['B', '5'], ['C', '4']])
  })
  it('adjacent marks give a 0 segment that is still listed', () => {
    const c = summarizeUnits(mk([{ text: 'A', marked: true }, { text: 'B', marked: true }]), cols).byColumn[0]!
    expect(c.marked.map((m) => m.units)).toEqual(['0', '0'])
  })
  it('empty mark text gets a placeholder label', () => {
    expect(summarizeUnits(mk([{ text: '  ', marked: true }]), cols).byColumn[0]?.marked[0]?.label).toBe(UNLABELLED_MARK)
  })
  it('fractional units sum exactly (0.1 × 10 = 1)', () => {
    expect(summarizeUnits(mk(Array(10).fill('c-0.1')), cols).byColumn[0]?.base.units).toBe('1')
  })
  it('a mark in one column does not affect another', () => {
    const two: ExtraColDef[] = [...cols, { key: 'b', header: 'B', kind: 'units' }]
    const rows = mk([{ text: 'M', marked: true }, '1-2'])
    rows.forEach((r) => (r.extras.b = { text: '9-1' }))
    const [a, b] = summarizeUnits(rows, two).byColumn
    expect(a?.base.units).toBe('0')
    expect(b?.base.units).toBe('2')
    expect(b?.marked).toEqual([])
  })
  it('does not mutate its input', () => {
    const rows = legacyRubyTomatoRows()
    const snap = JSON.stringify(rows)
    summarizeUnits(rows, LEGACY_EXTRA_COLS)
    expect(JSON.stringify(rows)).toBe(snap)
  })
})
