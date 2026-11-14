import { describe, expect, it } from 'vitest'
import { addDays, addMonths, barHeights, buildDashboardStats, buildMonthlySeries, formatBackupTime, monthKey, monthLabel, seriesWindowStart, sparklinePoints, statsWindowStart, topCustomers, weekdayLabel } from '../dashboardStats'

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

describe('monthly series (Phase 251)', () => {
  it('addMonths crosses year ends both ways and leaves junk alone', () => {
    expect(addMonths('2026-02', -3)).toBe('2025-11')
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('junk', 1)).toBe('junk')
  })
  it('seriesWindowStart is the first day of the oldest bar month (never later than statsWindowStart)', () => {
    expect(seriesWindowStart('2026-10-09')).toBe('2026-05-01')
    expect(seriesWindowStart('2026-02-03')).toBe('2025-09-01')
    expect(seriesWindowStart('2026-10-09', 1)).toBe('2026-10-01')
    expect(seriesWindowStart('2026-10-02', 1)).toBe(statsWindowStart('2026-10-02'))
  })
  it('buildMonthlySeries: six months oldest first, empty months are zero, later-than-today and older rows are ignored, money is exact', () => {
    const rows = [
      { billDate: '2026-10-09', grandTotal: '0.10' }, { billDate: '2026-10-01', grandTotal: '0.20' }, { billDate: '2026-10-20', grandTotal: '999' },
      { billDate: '2026-09-30', grandTotal: 500 }, { billDate: '2026-05-01', grandTotal: '25' }, { billDate: '2026-04-30', grandTotal: '999' }
    ]
    const m = buildMonthlySeries(rows, '2026-10-09')
    expect(m.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(m.map((x) => x.total)).toEqual(['25.00', '0.00', '0.00', '0.00', '500.00', '0.30'])
    expect(m.map((x) => x.count)).toEqual([1, 0, 0, 0, 1, 2])
    expect(buildMonthlySeries([], '2026-10-09', 3).map((x) => x.total)).toEqual(['0.00', '0.00', '0.00'])
  })
  it('barHeights: largest fills the box, zero is 0, a tiny non-zero value stays visible, all-zero is flat', () => {
    expect(barHeights(['0.00', '50.00', '100.00'], 40)).toEqual([0, 20, 40])
    expect(barHeights(['0.01', '100000'], 40)).toEqual([2, 40])
    expect(barHeights(['0.00', '0.00'], 40)).toEqual([0, 0])
  })
  it('monthLabel', () => {
    expect(monthLabel('2026-10')).toBe('Oct')
    expect(monthLabel('2026-01')).toBe('Jan')
    expect(monthLabel('x')).toBe('')
  })
})
