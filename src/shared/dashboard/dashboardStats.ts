import type { Decimal } from 'decimal.js'
import { sum, toMoney, tryD } from '../money'
import type { BillListItem } from '../history/historyList'

/** Phase 46 - pure helpers behind the Dashboard (stats, week, top customers, sparkline). No DOM, no Electron. */

export interface DayRow { billDate: string; grandTotal: string | number | null }
export interface DayTotal { date: string; count: number; total: string }
export interface TopCustomer { id: string; name: string; billCount: number; totalBilled: string }

export interface DashboardStats {
  today: DayTotal
  month: { month: string; count: number; total: string }
  /** Seven days, oldest first, today last; days without bills are zero. */
  week: DayTotal[]
  recent: BillListItem[]
  topCustomers: TopCustomer[]
  /** ISO time of the newest backup file, or null. */
  lastBackup: string | null
  syncStatus: 'off'
  /** Phase 251: the last `MONTH_BARS` calendar months, oldest first, this month last (months without bills are zero). Optional so an older payload still reads. */
  months?: MonthTotal[]
}

export interface MonthTotal { month: string; count: number; total: string }

export const RECENT_BILLS = 8
export const TOP_CUSTOMERS = 5
export const WEEK_DAYS = 7
/** Phase 251: bars in the small monthly graph. */
export const MONTH_BARS = 6

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` plus `n` days (calendar arithmetic in UTC, so DST never shifts a date). */
export function addDays(iso: string, n: number): string {
  const m = ISO.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n))
  return d.toISOString().slice(0, 10)
}

/** `2026-10-09` -> `2026-10`. */
export const monthKey = (iso: string): string => iso.slice(0, 7)

/** The first date a stats query must read: the earlier of the month start and the start of the 7-day window. */
export function statsWindowStart(today: string): string {
  const month = `${monthKey(today)}-01`
  const week = addDays(today, -(WEEK_DAYS - 1))
  return month < week ? month : week
}

function totalOf(rows: readonly DayRow[]): string {
  const ds: Decimal[] = []
  for (const r of rows) {
    const d = r.grandTotal === null ? null : tryD(String(r.grandTotal))
    if (d !== null) ds.push(d)
  }
  return toMoney(sum(ds))
}

/** Today / this month / the last seven days from the live bills since `statsWindowStart(today)`. Money is summed with decimal.js. */
export function buildDashboardStats(rows: readonly DayRow[], today: string): Pick<DashboardStats, 'today' | 'month' | 'week'> {
  const day = (date: string): DayTotal => {
    const r = rows.filter((x) => x.billDate === date)
    return { date, count: r.length, total: totalOf(r) }
  }
  const mk = monthKey(today)
  const inMonth = rows.filter((x) => monthKey(x.billDate) === mk && x.billDate <= today)
  const week: DayTotal[] = []
  for (let i = WEEK_DAYS - 1; i >= 0; i--) week.push(day(addDays(today, -i)))
  return { today: day(today), month: { month: mk, count: inMonth.length, total: totalOf(inMonth) }, week }
}

/** Customers with at least one bill, biggest total first (exact decimal compare), ties by name. */
export function topCustomers(rows: readonly { id: string; name: string; billCount: number; totalBilled: string }[], n = TOP_CUSTOMERS): TopCustomer[] {
  const val = (s: string): Decimal => tryD(s) ?? tryD('0')!
  return rows
    .filter((r) => r.billCount > 0)
    .slice()
    .sort((a, b) => val(b.totalBilled).comparedTo(val(a.totalBilled)) || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((r) => ({ id: r.id, name: r.name, billCount: r.billCount, totalBilled: r.totalBilled }))
}

/**
 * Sparkline coordinates for `values` (canonical money strings) in a `w` x `h` box: x spreads evenly, y is scaled to the largest
 * value (all-zero = a flat line on the bottom). Display coordinates only - the amounts themselves are never turned into numbers elsewhere.
 */
export function sparklinePoints(values: readonly string[], w: number, h: number): Array<{ x: number; y: number }> {
  const ds = values.map((v) => tryD(v) ?? tryD('0')!)
  const max = ds.reduce((m, d) => (d.greaterThan(m) ? d : m), tryD('0')!)
  return ds.map((d, i) => ({
    x: ds.length === 1 ? w / 2 : (w * i) / (ds.length - 1),
    y: max.isZero() ? h : h - d.dividedBy(max).times(h).toNumber()
  }))
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** `2026-10-09` -> `Fri`. */
export function weekdayLabel(iso: string): string {
  const m = ISO.exec(iso)
  return m ? (DAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] ?? '') : ''
}

/** "No backup yet" / "Today 14:05" / "Yesterday 09:10" / "03-10-26 18:30" (local time of `now`'s zone). */
export function formatBackupTime(iso: string | null, now: Date): string {
  if (iso === null) return 'No backup yet'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'No backup yet'
  const p = (n: number): string => String(n).padStart(2, '0')
  const ymd = (d: Date): string => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const hm = `${p(t.getHours())}:${p(t.getMinutes())}`
  const y = new Date(now); y.setDate(y.getDate() - 1)
  if (ymd(t) === ymd(now)) return `Today ${hm}`
  if (ymd(t) === ymd(y)) return `Yesterday ${hm}`
  return `${p(t.getDate())}-${p(t.getMonth() + 1)}-${String(t.getFullYear()).slice(2)} ${hm}`
}

/** `2026-10` shifted by `n` calendar months (`n` may be negative): `addMonths('2026-02', -3)` is `2025-11`. Anything that is not `YYYY-MM` comes back unchanged. */
export function addMonths(key: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return key
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + n
  const y = Math.floor(idx / 12)
  return `${String(y).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`
}

/** The first date the stats query must read once the monthly graph is shown: the start of the oldest bar's month (or `statsWindowStart`, if that is earlier). */
export function seriesWindowStart(today: string, bars: number = MONTH_BARS): string {
  const first = `${addMonths(monthKey(today), -(Math.max(1, bars) - 1))}-01`
  const base = statsWindowStart(today)
  return first < base ? first : base
}

/** Phase 251: totals per calendar month for the last `bars` months, oldest first, today's month last; bills dated after `today` are ignored. Money is summed with decimal.js. */
export function buildMonthlySeries(rows: readonly DayRow[], today: string, bars: number = MONTH_BARS): MonthTotal[] {
  const out: MonthTotal[] = []
  const n = Math.max(1, bars)
  for (let i = n - 1; i >= 0; i--) {
    const key = addMonths(monthKey(today), -i)
    const r = rows.filter((x) => monthKey(x.billDate) === key && x.billDate <= today)
    out.push({ month: key, count: r.length, total: totalOf(r) })
  }
  return out
}

/** Bar heights (display pixels) for canonical money strings scaled to the largest value in a box `h` high: zero is 0, any other value is at least 2 so it stays visible. */
export function barHeights(values: readonly string[], h: number): number[] {
  const ds = values.map((v) => tryD(v) ?? tryD('0')!)
  const max = ds.reduce((m, d) => (d.greaterThan(m) ? d : m), tryD('0')!)
  return ds.map((d) => (max.isZero() || d.lessThanOrEqualTo(0) ? 0 : Math.max(2, d.dividedBy(max).times(h).toNumber())))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `2026-10` -> `Oct`. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  return m ? (MONTHS[Number(m[2]) - 1] ?? '') : ''
}
