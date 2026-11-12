import { describe, expect, it } from 'vitest'
import { parseSentence, type SentenceCustomer, type StructuredQuery } from '../sentenceQuery'

const TODAY = '2026-11-12' // a Thursday
const CUST: SentenceCustomer[] = [
  { id: 'c1', name: 'Sharma Traders' },
  { id: 'c2', name: 'Ruby Hardware' },
  { id: 'c3', name: 'Sharma Brothers' },
  { id: 'c4', name: 'Gupta & Sons' },
  { id: 'c5', name: 'Anil Kumar' }
]
const parse = (t: string, today = TODAY, customers: SentenceCustomer[] = CUST) => parseSentence(t, { today, customers })
const range = (from: string, to: string) => ({ dateRange: { from, to } })

// [sentence, expected slice of the StructuredQuery]
const TABLE: Array<[string, Partial<StructuredQuery>]> = [
  // relative dates
  ['hinge today', { itemText: 'hinge', ...range('2026-11-12', '2026-11-12') }],
  ['hinge yesterday', { itemText: 'hinge', ...range('2026-11-11', '2026-11-11') }],
  ['hinge this week', { itemText: 'hinge', ...range('2026-11-09', '2026-11-15') }],
  ['hinge last week', { itemText: 'hinge', ...range('2026-11-02', '2026-11-08') }],
  ['hinge this month', { itemText: 'hinge', ...range('2026-11-01', '2026-11-30') }],
  ['hinge last month', { itemText: 'hinge', ...range('2026-10-01', '2026-10-31') }],
  ['hinge this year', { itemText: 'hinge', ...range('2026-01-01', '2026-12-31') }],
  ['hinge last year', { itemText: 'hinge', ...range('2025-01-01', '2025-12-31') }],
  ['hinge last 7 days', { itemText: 'hinge', ...range('2026-11-06', '2026-11-12') }],
  ['hinge past 30 days', { itemText: 'hinge', ...range('2026-10-14', '2026-11-12') }],
  ['hinge last 2 weeks', { itemText: 'hinge', ...range('2026-10-30', '2026-11-12') }],
  ['hinge last 3 months', { itemText: 'hinge', ...range('2026-08-12', '2026-11-12') }],
  // month names
  ['hinge in october', { itemText: 'hinge', ...range('2026-10-01', '2026-10-31') }],
  ['hinge december', { itemText: 'hinge', ...range('2025-12-01', '2025-12-31') }],
  ['hinge november', { itemText: 'hinge', ...range('2026-11-01', '2026-11-30') }],
  ['hinge feb 2024', { itemText: 'hinge', ...range('2024-02-01', '2024-02-29') }],
  ['hinge sept 2025', { itemText: 'hinge', ...range('2025-09-01', '2025-09-30') }],
  ['may be a hinge', { itemText: 'may be a hinge' }],
  ['hinge in may', { itemText: 'hinge', ...range('2026-05-01', '2026-05-31') }],
  // exact dates, day-first
  ['hinge 5 oct', { itemText: 'hinge', ...range('2026-10-05', '2026-10-05') }],
  ['hinge oct 5th', { itemText: 'hinge', ...range('2026-10-05', '2026-10-05') }],
  ['hinge 05/10/2025', { itemText: 'hinge', ...range('2025-10-05', '2025-10-05') }],
  ['hinge 5-10-25', { itemText: 'hinge', ...range('2025-10-05', '2025-10-05') }],
  ['hinge 5/10', { itemText: 'hinge', ...range('2026-10-05', '2026-10-05') }],
  ['hinge 25/12', { itemText: 'hinge', ...range('2025-12-25', '2025-12-25') }],
  ['hinge 1/2', { itemText: 'hinge 1/2' }],
  ['hinge 3/4 inch', { itemText: 'hinge 3/4 inch' }],
  ['hinge 31/02/2026', { itemText: 'hinge 31/02/2026' }],
  // ranges
  ['hinge from 1/10 to 15/10', { itemText: 'hinge', ...range('2026-10-01', '2026-10-15') }],
  ['hinge 1 oct to 15 oct', { itemText: 'hinge', ...range('2026-10-01', '2026-10-15') }],
  ['hinge between 5-10 and 8-10', { itemText: 'hinge', ...range('2026-10-05', '2026-10-08') }],
  ['hinge 25/12 to 5/1', { itemText: 'hinge', ...range('2025-12-25', '2026-01-05') }],
  ['hinge 1/10/2025 - 31/10/2025', { itemText: 'hinge', ...range('2025-10-01', '2025-10-31') }],
  ['hinge from 10 oct to 2 oct', { itemText: 'hinge', ...range('2026-10-02', '2026-10-10') }],
  // amounts
  ['hinge above 5000', { itemText: 'hinge', amount: { op: 'gt', value: '5000' } }],
  ['hinge over 5,000', { itemText: 'hinge', amount: { op: 'gt', value: '5000' } }],
  ['hinge more than rs 1250.50', { itemText: 'hinge', amount: { op: 'gt', value: '1250.5' } }],
  ['hinge under 2k', { itemText: 'hinge', amount: { op: 'lt', value: '2000' } }],
  ['hinge below 2.5k', { itemText: 'hinge', amount: { op: 'lt', value: '2500' } }],
  ['hinge above 1.5 lakh', { itemText: 'hinge', amount: { op: 'gt', value: '150000' } }],
  ['hinge less than 2 lakhs', { itemText: 'hinge', amount: { op: 'lt', value: '200000' } }],
  ['hinge up to 10000', { itemText: 'hinge', amount: { op: 'lt', value: '10000' } }],
  ['hinge > 700', { itemText: 'hinge', amount: { op: 'gt', value: '700' } }],
  ['hinge 5000', { itemText: 'hinge 5000' }],
  // format
  ['hinge gst', { itemText: 'hinge', format: 'gst' }],
  ['hinge non gst', { itemText: 'hinge', format: 'nongst' }],
  ['hinge non-gst bills', { itemText: 'hinge', format: 'nongst' }],
  ['hinge without gst', { itemText: 'hinge', format: 'nongst' }],
  ['gst bills yesterday', { itemText: '', format: 'gst', ...range('2026-11-11', '2026-11-11') }],
  // party
  ['hinge to Ruby Hardware', { itemText: 'hinge', party: { id: 'c2', name: 'Ruby Hardware' } }],
  ['hinge for anil', { itemText: 'hinge', party: { id: 'c5', name: 'Anil Kumar' } }],
  ['Anil Kumar hinge', { itemText: 'hinge', party: { id: 'c5', name: 'Anil Kumar' } }],
  ['hinge to gupta bills', { itemText: 'hinge', party: { id: 'c4', name: 'Gupta & Sons' } }],
  ['hinge for customer ruby hardware', { itemText: 'hinge', party: { id: 'c2', name: 'Ruby Hardware' } }],
  ['ruby tomato to Ruby Hardware last month above 5000', {
    itemText: 'ruby tomato', party: { id: 'c2', name: 'Ruby Hardware' }, ...range('2026-10-01', '2026-10-31'), amount: { op: 'gt', value: '5000' }
  }],
  ['ruby tomato last month', { itemText: 'ruby tomato', ...range('2026-10-01', '2026-10-31') }],
  ['hinge to nobody', { itemText: 'hinge to nobody' }],
  // fillers and odd input
  ['show me all bills of hinge', { itemText: 'hinge' }],
  ['hinge 505 gst this month under 3k', { itemText: 'hinge 505', format: 'gst', amount: { op: 'lt', value: '3000' }, ...range('2026-11-01', '2026-11-30') }],
  ['', { itemText: '' }],
  ['   ', { itemText: '' }],
  ['only dates last week', { itemText: 'only dates', ...range('2026-11-02', '2026-11-08') }],
  ['last week', { itemText: '', ...range('2026-11-02', '2026-11-08') }]
]

describe('parseSentence - table', () => {
  it('has at least 40 invented sentences', () => expect(TABLE.length).toBeGreaterThanOrEqual(40))
  for (const [text, want] of TABLE) {
    it(`"${text}"`, () => {
      const { query } = parse(text)
      expect(query).toMatchObject(want)
      if (!('dateRange' in want)) expect(query.dateRange).toBeUndefined()
      if (!('amount' in want)) expect(query.amount).toBeUndefined()
      if (!('format' in want)) expect(query.format).toBeUndefined()
      if (!('party' in want)) expect(query.party).toBeUndefined()
    })
  }
})

describe('parseSentence - today injection, boundaries, leap years', () => {
  it('last month from January goes to the previous year', () => {
    expect(parse('x last month', '2026-01-15').query.dateRange).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('last month from March in a leap year ends on 29 Feb', () => {
    expect(parse('x last month', '2024-03-10').query.dateRange).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(parse('x last month', '2026-03-10').query.dateRange).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('last 3 months clamps the day to a short month', () => {
    expect(parse('x last 3 months', '2026-05-31').query.dateRange).toEqual({ from: '2026-02-28', to: '2026-05-31' })
  })
  it('last 7 days crosses the year boundary', () => {
    expect(parse('x last 7 days', '2026-01-03').query.dateRange).toEqual({ from: '2025-12-28', to: '2026-01-03' })
  })
  it('weeks start on Monday, also when today is Monday or Sunday', () => {
    expect(parse('x this week', '2026-11-09').query.dateRange).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(parse('x this week', '2026-11-15').query.dateRange).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    expect(parse('x last week', '2026-01-01').query.dateRange).toEqual({ from: '2025-12-22', to: '2025-12-28' })
  })
  it('29 Feb: valid in a leap year, else the latest leap year [A]', () => {
    expect(parse('x 29/02/2024').query.dateRange).toEqual({ from: '2024-02-29', to: '2024-02-29' })
    expect(parse('x 29 feb').query.dateRange).toEqual({ from: '2024-02-29', to: '2024-02-29' })
    expect(parse('x 29/02/2025').query.itemText).toBe('x 29/02/2025')
  })
  it('a yearless date later than today means last year', () => {
    expect(parse('x 20/11', '2026-11-12').query.dateRange).toEqual({ from: '2025-11-20', to: '2025-11-20' })
    expect(parse('x 12/11', '2026-11-12').query.dateRange).toEqual({ from: '2026-11-12', to: '2026-11-12' })
  })
  it('a bad or missing today never throws and understands no dates', () => {
    expect(parse('hinge last week', 'nonsense').query).toEqual({ itemText: 'hinge last week' })
    expect(parse('hinge last week', '2026-13-40').query.itemText).toBe('hinge last week')
  })
})

describe('parseSentence - party', () => {
  it('an ambiguous name returns the top choices as candidates', () => {
    const { query, chips } = parse('hinge to sharma')
    expect(query.party?.candidates?.map((c) => c.id).sort()).toEqual(['c1', 'c3'])
    expect(query.itemText).toBe('hinge')
    const chip = chips.find((c) => c.kind === 'party')!
    expect(chip.candidates).toHaveLength(2)
    expect(chip.label).toContain('pick one')
  })
  it('a more specific name is not ambiguous', () => {
    const { query } = parse('hinge to sharma brothers')
    expect(query.party).toEqual({ id: 'c3', name: 'Sharma Brothers' })
  })
  it('two customers with the same name are both candidates', () => {
    const { query } = parse('hinge to Anil Kumar', TODAY, [...CUST, { id: 'c9', name: 'anil  kumar' }])
    expect(query.party?.candidates).toHaveLength(2)
  })
  it('no customers: the party words stay in the item text', () => {
    expect(parse('hinge to sharma', TODAY, []).query).toEqual({ itemText: 'hinge to sharma' })
  })
  it('an item word never steals a party without a marker', () => {
    expect(parse('ruby tomato').query.party).toBeUndefined()
    expect(parse('ruby tomato').query.itemText).toBe('ruby tomato')
  })
  it('a one-letter typo in a long word still finds the party', () => {
    expect(parse('hinge to hardwar').query.party?.id).toBe('c2')
    expect(parse('hinge to harware').query.party?.id).toBe('c2')
  })
})

describe('parseSentence - chips', () => {
  it('each chip carries its source span and a readable label', () => {
    const text = 'ruby tomato to Ruby Hardware last month above 5000'
    const { chips } = parse(text)
    const by = Object.fromEntries(chips.map((c) => [c.kind, c]))
    expect(by.party!.label).toBe('Party: Ruby Hardware')
    expect(text.slice(by.party!.span.start, by.party!.span.end)).toBe('to Ruby Hardware')
    expect(by.date!.label).toBe('Date: 1-31 Oct')
    expect(text.slice(by.date!.span.start, by.date!.span.end)).toBe('last month')
    expect(by.amount!.label).toBe('Amount: above 5000')
    expect(text.slice(by.amount!.span.start, by.amount!.span.end)).toBe('above 5000')
    expect(by.item!.label).toBe('Item: ruby tomato')
    expect(by.item!.removable).toBe(false)
    expect(chips.filter((c) => c.kind !== 'item').every((c) => c.removable)).toBe(true)
    // chips are in text order and never overlap
    for (let i = 1; i < chips.length; i++) expect(chips[i]!.span.start).toBeGreaterThanOrEqual(chips[i - 1]!.span.end)
  })
  it('date labels show the year only when it is not the current one', () => {
    expect(parse('x 5 oct 2025').chips.find((c) => c.kind === 'date')!.label).toBe('Date: 5 Oct 2025')
    expect(parse('x 5 oct').chips.find((c) => c.kind === 'date')!.label).toBe('Date: 5 Oct')
    expect(parse('x 25/12 to 5/1').chips.find((c) => c.kind === 'date')!.label).toBe('Date: 25 Dec 2025 - 5 Jan 2026')
  })
  it('amounts stay decimal strings (no float drift)', () => {
    expect(parse('x above 0.1k').query.amount).toEqual({ op: 'gt', value: '100' })
    expect(parse('x over 1.1 lakh').query.amount).toEqual({ op: 'gt', value: '110000' })
    expect(parse('x above 99999999999999999999').query.amount?.value).toBe('99999999999999999999')
  })
  it('never throws on hostile text', () => {
    const nasty = ['\u0000', '(((', '\\', 'a'.repeat(5000), '9'.repeat(400) + ' over ' + '9'.repeat(30), '😀 hinge', '//-- 99/99/99999']
    for (const t of nasty) expect(() => parse(t)).not.toThrow()
    expect(parse('a'.repeat(5000)).query.itemText.length).toBeLessThanOrEqual(400)
  })
})
