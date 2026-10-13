/**
 * Phase 125 (pure, OFFLINE) - Indian holidays table for the dashboard tile. No network.
 * `approx: true` = a lunar / moon-sighting festival whose date can move by a day (the gazette decides). The table covers 2026-2027 only and is a
 * convenience list of widely observed days, NOT an official gazette: the tile shows 'dates may vary' for approx ones. [A] Extend each year.
 */
export interface Holiday { date: string; name: string; approx?: boolean }

export const HOLIDAYS: readonly Holiday[] = [
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-03-04', name: 'Holi', approx: true },
  { date: '2026-03-21', name: 'Id-ul-Fitr', approx: true },
  { date: '2026-03-26', name: 'Ram Navami', approx: true },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-01', name: 'Labour Day / May Day' },
  { date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)', approx: true },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-09-04', name: 'Janmashtami', approx: true },
  { date: '2026-09-14', name: 'Ganesh Chaturthi', approx: true },
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra', approx: true },
  { date: '2026-11-08', name: 'Diwali', approx: true },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti', approx: true },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-26', name: 'Republic Day' },
  { date: '2027-03-22', name: 'Holi', approx: true },
  { date: '2027-05-01', name: 'Labour Day / May Day' },
  { date: '2027-08-15', name: 'Independence Day' },
  { date: '2027-10-02', name: 'Gandhi Jayanti' },
  { date: '2027-10-29', name: 'Diwali', approx: true },
  { date: '2027-12-25', name: 'Christmas' }
]

export interface UpcomingHoliday extends Holiday { daysAway: number }

const dayNo = (iso: string): number => { const [y, m, d] = iso.split('-').map(Number) as [number, number, number]; return Math.round(Date.UTC(y, m - 1, d) / 86_400_000) }

/** The next `count` holidays on or after `today` (local `YYYY-MM-DD`), soonest first; `daysAway` 0 = today. Empty once the table runs out. */
export function upcomingHolidays(today: string, count = 3, table: readonly Holiday[] = HOLIDAYS): UpcomingHoliday[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return []
  const t = dayNo(today)
  return table
    .map((h) => ({ ...h, daysAway: dayNo(h.date) - t }))
    .filter((h) => h.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway)
    .slice(0, Math.max(0, count))
}
/** True when the table has no holiday left after `today` (the owner should extend it). */
export function holidayTableExpired(today: string, table: readonly Holiday[] = HOLIDAYS): boolean {
  return upcomingHolidays(today, 1, table).length === 0
}
