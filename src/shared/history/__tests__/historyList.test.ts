import { describe, expect, it } from 'vitest'
import { compareByInvoiceNumber, parseInvoiceNumber, sortBillsByInvoiceNumber, decodeCursor, encodeCursor, formatHistoryDate, formatHistoryTotal, isListKey, moveListIndex } from '../historyList'

describe('historyList (pure)', () => {
  it('formats dates as DD-MM-YY and leaves non-dates alone', () => {
    expect(formatHistoryDate('2026-10-06')).toBe('06-10-26')
    expect(formatHistoryDate('2031-01-09')).toBe('09-01-31')
    expect(formatHistoryDate('')).toBe('')
    expect(formatHistoryDate('6/10/26')).toBe('6/10/26')
  })

  it('formats totals with the rupee sign and Indian grouping; unreadable values show a dash', () => {
    expect(formatHistoryTotal('7150')).toBe('₹7,150.00')
    expect(formatHistoryTotal('107500')).toBe('₹1,07,500.00')
    expect(formatHistoryTotal('1234567.5')).toBe('₹12,34,567.50')
    expect(formatHistoryTotal('-400')).toBe('-₹400.00')
    expect(formatHistoryTotal('')).toBe('—')
    expect(formatHistoryTotal('abc')).toBe('—')
  })

  it('cursor round-trips, including ids with a bar and non-ASCII text, and rejects garbage', () => {
    const c = { date: '2026-10-06', createdAt: '2026-10-06T10:00:00.000Z', id: 'a|b-é' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
    expect(decodeCursor('!!!')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(encodeCursor({ date: 'nope', createdAt: 'x', id: 'y' }))).toBeNull()
  })

  it('moves the highlight with clamping and no wrap', () => {
    expect(moveListIndex(-1, 0, 'ArrowDown')).toBe(-1)
    expect(moveListIndex(-1, 5, 'ArrowDown')).toBe(0)
    expect(moveListIndex(0, 5, 'ArrowUp')).toBe(0)
    expect(moveListIndex(4, 5, 'ArrowDown')).toBe(4)
    expect(moveListIndex(2, 5, 'Home')).toBe(0)
    expect(moveListIndex(2, 5, 'End')).toBe(4)
    expect(moveListIndex(2, 50, 'PageDown', 10)).toBe(12)
    expect(moveListIndex(45, 50, 'PageDown', 10)).toBe(49)
    expect(moveListIndex(3, 50, 'PageUp', 10)).toBe(0)
    expect(isListKey('PageUp')).toBe(true)
    expect(isListKey('Enter')).toBe(false)
  })
})

describe('Phase 146 — invoice number order', () => {
  const b = (id: string, poNumber: string, billDate = '2026-10-01') => ({ id, poNumber, billDate })
  const order = (xs: ReturnType<typeof b>[]): string[] => sortBillsByInvoiceNumber(xs).map((x) => x.id)

  it('parses prefix and numeric part; no digits is malformed', () => {
    expect(parseInvoiceNumber('AV-0748')).toEqual({ prefix: 'AV-', num: '748' })
    expect(parseInvoiceNumber('9')).toEqual({ prefix: '', num: '9' })
    expect(parseInvoiceNumber('Q3-0000')).toEqual({ prefix: 'Q3-', num: '0' })
    expect(parseInvoiceNumber('').num).toBeNull()
    expect(parseInvoiceNumber('abc').num).toBeNull()
  })
  it('highest number first; widths compare numerically (10 before 9)', () => {
    expect(order([b('a', '9'), b('b', '10'), b('c', '100'), b('d', '1')])).toEqual(['c', 'b', 'a', 'd'])
    expect(order([b('a', 'AV-0748'), b('b', 'AV-0749'), b('c', 'AV-0100')])).toEqual(['b', 'a', 'c'])
  })
  it('same number, different prefix: prefix A-Z, then newer date first', () => {
    expect(order([b('x', 'BR-0748'), b('y', 'AV-0748'), b('z', 'AV-0749')])).toEqual(['z', 'y', 'x'])
    expect(order([b('old', 'AV-0748', '2026-09-01'), b('new', 'AV-0748', '2026-10-01')])).toEqual(['new', 'old'])
  })
  it('malformed numbers go last (newest date first among them); result is deterministic and the input is not mutated', () => {
    const input = [b('m1', 'none', '2026-01-01'), b('ok', 'AV-1'), b('m2', '', '2026-05-01')]
    const copy = [...input]
    expect(order(input)).toEqual(['ok', 'm2', 'm1'])
    expect(input).toEqual(copy)
    expect(compareByInvoiceNumber(b('a', 'AV-5'), b('a', 'AV-5'))).toBe(0)
  })
  it('huge numbers do not lose precision (no float maths)', () => {
    expect(order([b('a', 'X-9007199254740993'), b('b', 'X-9007199254740992')])).toEqual(['a', 'b'])
  })
})
