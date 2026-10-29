import { DASH_TILE_KEYS, type DashTileKey } from './live'

/** Phase 126: the Dashboard "Today" grid is 12 columns wide; every tile spans a whole number of them. */
export const TILE_GRID_COLUMNS = 12
/** Below this window width (px) six tiles go 2 x 3 instead of 3 x 2. The layout is only specified for windows >= MIN_TILE_WIDTH. */
export const WIDE_TILE_WIDTH = 1280
export const MIN_TILE_WIDTH = 1024

/**
 * Rows of column spans for `count` tiles (1-7; the seventh is the Phase 203 "(?)" Games tile). Every row adds up to exactly 12, so no row is ever left part-empty (no orphan tile):
 * 1 -> 12 | 2 -> 6+6 | 3 -> 4+4+4 | 4 -> 2 x (6+6) | 5 -> 4+4+4 then 6+6 | 6 -> 3 x 2 (wide) or 2 x 3 (narrow) | 7 -> 4+4+4 then 3+3+3+3 (wide) or 6+6, 6+6, 4+4+4 (narrow) [A].
 */
export function tileRows(count: number, windowWidth: number): number[][] {
  const n = Math.max(0, Math.min(DASH_TILE_KEYS.length, Math.floor(count)))
  switch (n) {
    case 0: return []
    case 1: return [[12]]
    case 2: return [[6, 6]]
    case 3: return [[4, 4, 4]]
    case 4: return [[6, 6], [6, 6]]
    case 5: return [[4, 4, 4], [6, 6]]
    case 6: return windowWidth >= WIDE_TILE_WIDTH ? [[4, 4, 4], [4, 4, 4]] : [[6, 6], [6, 6], [6, 6]]
    default: return windowWidth >= WIDE_TILE_WIDTH ? [[4, 4, 4], [3, 3, 3, 3]] : [[6, 6], [6, 6], [4, 4, 4]]
  }
}

/** The span of each tile in display order (flattened `tileRows`). */
export function tileSpans(count: number, windowWidth: number): number[] {
  return tileRows(count, windowWidth).flat()
}

/** The enabled tiles in their fixed display order. */
export function enabledTiles(flags: Readonly<Record<DashTileKey, boolean>>): DashTileKey[] {
  return DASH_TILE_KEYS.filter((k) => flags[k])
}

export const TILE_LABELS: Readonly<Record<DashTileKey, string>> = {
  weather: 'Weather',
  usd: 'USD / INR',
  majors: 'EUR, GBP, AED / INR',
  metals: 'Gold and silver',
  clock: 'Clock and date',
  holidays: 'Upcoming holidays',
  /** Phase 203: the visible name is exactly "(?)" and nothing else. */
  games: '(?)'
}

/** Local `YYYY-MM-DD` for a Date (no UTC shift). */
export function localIsoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** '5 min ago' style age of an ISO fetch time; '' when unknown. */
export function ageLabel(iso: string | null, nowMs: number): string {
  if (iso === null) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const m = Math.max(0, Math.round((nowMs - t) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** 'Today' / 'Tomorrow' / 'In N days' for a holiday. */
export function daysAwayLabel(n: number): string {
  return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`
}
