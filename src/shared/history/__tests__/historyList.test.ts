import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, formatHistoryDate, formatHistoryTotal, isListKey, moveListIndex } from '../historyList'

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
