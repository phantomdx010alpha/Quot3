import { describe, expect, it } from 'vitest'
import { addDays, buildDashboardStats, formatBackupTime, monthKey, sparklinePoints, statsWindowStart, topCustomers, weekdayLabel } from '../dashboardStats'

describe('dates', () => {
  it('addDays crosses month / year / leap boundaries', () => {
    expect(addDays('2026-10-09', -6)).toBe('2026-10-03')
    expect(addDays('2026-10-02', -6)).toBe('2026-09-26')
    expect(addDays('2026-01-03', -6)).toBe('2025-12-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDays('garbage', 1)).toBe('garbage')
  })
  it('statsWindowStart is the earlier of month start and 6 days back', () => {
    expect(statsWindowStart('2026-10-20')).toBe('2026-10-01')
    expect(statsWindowStart('2026-10-02')).toBe('2026-09-26')
  })
  it('monthKey / weekdayLabel', () => {
    expect(monthKey('2026-10-09')).toBe('2026-10')
    expect(weekdayLabel('2026-10-09')).toBe('Fri')
    expect(weekdayLabel('x')).toBe('')
  })
})

describe('buildDashboardStats', () => {
  const rows = [
    { billDate: '2026-10-09', grandTotal: '0.10' },
    { billDate: '2026-10-09', grandTotal: '0.20' },
    { billDate: '2026-10-08', grandTotal: '1250.50' },
    { billDate: '2026-10-03', grandTotal: '10' },
    { billDate: '2026-10-02', grandTotal: '5' },
    { billDate: '2026-09-30', grandTotal: '999' },
    { billDate: '2026-10-10', grandTotal: '7' } // a future-dated bill is not part of "this month so far"
  ]
  const s = buildDashboardStats(rows, '2026-10-09')
  it('today and month are exact decimal sums', () => {
    expect(s.today).toEqual({ date: '2026-10-09', count: 2, total: '0.30' })
    expect(s.month).toEqual({ month: '2026-10', count: 5, total: '1265.80' })
  })
  it('week has seven days, oldest first, zero days included', () => {
    expect(s.week.map((d) => d.date)).toEqual(['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'])
    expect(s.week.map((d) => d.total)).toEqual(['10.00', '0.00', '0.00', '0.00', '0.00', '1250.50', '0.30'])
    expect(s.week.map((d) => d.count)).toEqual([1, 0, 0, 0, 0, 1, 2])
  })
  it('an unreadable total counts the bill and adds nothing; empty input is all zero', () => {
    expect(buildDashboardStats([{ billDate: '2026-10-09', grandTotal: null }, { billDate: '2026-10-09', grandTotal: 'x' }], '2026-10-09').today).toEqual({ date: '2026-10-09', count: 2, total: '0.00' })
    expect(buildDashboardStats([], '2026-10-09').month).toEqual({ month: '2026-10', count: 0, total: '0.00' })
  })
})

describe('topCustomers', () => {
  const c = (id: string, name: string, billCount: number, totalBilled: string) => ({ id, name, billCount, totalBilled })
  it('sorts by exact total desc, ties by name, skips bill-less, caps at n', () => {
    const rows = [c('a', 'Beta', 1, '100.00'), c('b', 'Alpha', 2, '100.00'), c('c', 'Zed', 0, '0.00'), c('d', 'Big', 3, '12345678.90'), c('e', 'Small', 1, '9.99')]
    expect(topCustomers(rows, 3).map((r) => r.id)).toEqual(['d', 'b', 'a'])
    expect(topCustomers(rows).map((r) => r.id)).toEqual(['d', 'b', 'a', 'e'])
  })
})

describe('sparklinePoints', () => {
  it('scales to the largest value, spreads x evenly', () => {
    const p = sparklinePoints(['0.00', '50.00', '100.00'], 100, 40)
    expect(p).toEqual([{ x: 0, y: 40 }, { x: 50, y: 20 }, { x: 100, y: 0 }])
  })
  it('all-zero is a flat bottom line; a single value is centred', () => {
    expect(sparklinePoints(['0.00', '0.00'], 10, 10)).toEqual([{ x: 0, y: 10 }, { x: 10, y: 10 }])
    expect(sparklinePoints(['5.00'], 10, 10)).toEqual([{ x: 5, y: 0 }])
  })
})

describe('formatBackupTime', () => {
  const now = new Date(2026, 9, 9, 15, 0)
  it('says none / today / yesterday / a date', () => {
    expect(formatBackupTime(null, now)).toBe('No backup yet')
    expect(formatBackupTime('bad', now)).toBe('No backup yet')
    expect(formatBackupTime(new Date(2026, 9, 9, 9, 5).toISOString(), now)).toBe('Today 09:05')
    expect(formatBackupTime(new Date(2026, 9, 8, 23, 30).toISOString(), now)).toBe('Yesterday 23:30')
    expect(formatBackupTime(new Date(2026, 8, 3, 18, 30).toISOString(), now)).toBe('03-09-26 18:30')
  })
})
