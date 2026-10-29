/**
 * Phase 125 (pure) - Dashboard live data: URL builders, response parsers, conversions, cache rules and the host allow-list.
 * No network, no Electron, no DOM. The main process does the fetching (`main/services/dashboardLiveService.ts`); the renderer never does.
 * PRIVACY: the only things that ever leave the PC are the city name (geocoding), its coordinates (weather) and currency / metal codes. Never bills.
 * Money-like values (rates, prices) are kept as canonical decimal STRINGS (decimal.js), never JS-number arithmetic (project rule 4.3).
 */
import Decimal from 'decimal.js'

/** The ONLY hosts the main process may call for the dashboard (checked before every request). */
export const DASH_HOSTS: readonly string[] = ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'open.er-api.com', 'api.gold-api.com']

/** Refresh periods (ms). Forex source updates once a day and rate-limits (HTTP 429, 20 min lock): never faster than hourly. */
export const REFRESH_MS = { weather: 20 * 60_000, rates: 60 * 60_000, metals: 30 * 60_000 } as const
/** A cached value older than this is shown dimmed as 'offline' when the network fails. */
export const FETCH_TIMEOUT_MS = 8_000

export type LiveKind = 'weather' | 'rates' | 'metals'

export interface DashCity { name: string; region: string; country: string; lat: number; lon: number }
export const DEFAULT_CITY: DashCity = { name: 'Bangalore', region: 'Karnataka', country: 'India', lat: 12.9719, lon: 77.5937 }

export const DASH_TILE_KEYS = ['weather', 'usd', 'majors', 'metals', 'clock', 'holidays', 'games'] as const
export type DashTileKey = (typeof DASH_TILE_KEYS)[number]
export const DEFAULT_DASH_TILES: Readonly<Record<DashTileKey, boolean>> = { weather: true, usd: true, majors: true, metals: true, clock: true, holidays: true, games: true }

/** What every live call returns: the value, when it was fetched, and whether it is a stale cache copy (network failed => show dimmed 'offline'). */
export interface LiveResult<T> {
  ok: boolean
  data: T | null
  /** ISO time the data was fetched from the source (or null when there never was a good fetch). */
  fetchedAt: string | null
  /** True when `data` is an older cached copy because the fetch failed. */
  offline: boolean
  /** Short human source name for the tile footer. */
  source: string
  /** Why the last attempt failed (only when offline / not ok). */
  error?: string
}

export interface WeatherData {
  city: string
  tempC: number
  feelsC: number
  humidity: number
  windKmh: number
  code: number
  label: string
  maxC: number | null
  minC: number | null
}
export interface RatesData {
  /** Foreign units per 1 USD as decimal strings, only the codes asked for. */
  perUsd: Record<string, string>
  /** 1 unit of the code in INR, 4 decimals. */
  inr: Record<string, string>
  /** Source's own last-update time (ISO). */
  asOf: string | null
}
export interface MetalsData {
  /** INR per 10 g gold and per 1 kg silver (spot, before any import duty / GST / making charges), whole rupees. */
  goldPer10gInr: string
  silverPerKgInr: string
  /** Spot in USD per troy ounce (as the source gave it). */
  goldUsdOz: string
  silverUsdOz: string
  asOf: string | null
}
export interface CityHit extends DashCity { id: string }

export const RATE_CODES = ['INR', 'EUR', 'GBP', 'AED'] as const
export const TROY_OZ_GRAMS = '31.1034768'

// ---------- URL builders ----------
export function weatherUrl(c: Pick<DashCity, 'lat' | 'lon'>): string {
  const q = new URLSearchParams({
    latitude: c.lat.toFixed(4), longitude: c.lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '1'
  })
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`
}
export function geocodeUrl(name: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: name.trim(), count: '6', language: 'en', format: 'json' }).toString()}`
}
export const RATES_URL = 'https://open.er-api.com/v6/latest/USD'
export const GOLD_URL = 'https://api.gold-api.com/price/XAU'
export const SILVER_URL = 'https://api.gold-api.com/price/XAG'

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.username === '' && u.password === '' && DASH_HOSTS.includes(u.hostname)
  } catch { return false }
}

// ---------- weather ----------
const WMO: ReadonlyArray<[number[], string]> = [
  [[0], 'Clear sky'], [[1], 'Mainly clear'], [[2], 'Partly cloudy'], [[3], 'Overcast'], [[45, 48], 'Fog'],
  [[51, 53, 55, 56, 57], 'Drizzle'], [[61, 63, 65, 66, 67], 'Rain'], [[71, 73, 75, 77], 'Snow'], [[80, 81, 82], 'Rain showers'],
  [[85, 86], 'Snow showers'], [[95, 96, 99], 'Thunderstorm']
]
export function weatherLabel(code: number): string {
  return WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'Unknown'
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export function parseWeather(json: unknown, city: string): WeatherData | null {
  const cur = rec(rec(json)?.current)
  if (!cur) return null
  const t = num(cur.temperature_2m)
  const code = num(cur.weather_code)
  if (t === null || code === null) return null
  const daily = rec(rec(json)?.daily)
  const first = (k: string): number | null => (Array.isArray(daily?.[k]) ? num((daily?.[k] as unknown[])[0]) : null)
  return {
    city, tempC: Math.round(t), feelsC: Math.round(num(cur.apparent_temperature) ?? t), humidity: Math.round(num(cur.relative_humidity_2m) ?? 0),
    windKmh: Math.round(num(cur.wind_speed_10m) ?? 0), code, label: weatherLabel(code),
    maxC: first('temperature_2m_max') === null ? null : Math.round(first('temperature_2m_max') as number),
    minC: first('temperature_2m_min') === null ? null : Math.round(first('temperature_2m_min') as number)
  }
}

export function parseCityHits(json: unknown): CityHit[] {
  const results = rec(json)?.results
  if (!Array.isArray(results)) return []
  const out: CityHit[] = []
  for (const r of results) {
    const o = rec(r)
    if (!o) continue
    const lat = num(o.latitude), lon = num(o.longitude)
    if (typeof o.name !== 'string' || o.name === '' || lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    out.push({ id: String(o.id ?? `${lat},${lon}`), name: o.name, region: typeof o.admin1 === 'string' ? o.admin1 : '', country: typeof o.country === 'string' ? o.country : '', lat, lon })
  }
  return out
}

/** Validate a stored / incoming `dash.city`; falls back to Bangalore. */
export function normalizeCity(v: unknown): DashCity {
  const o = rec(v)
  if (!o || typeof o.name !== 'string' || o.name.trim() === '' || o.name.length > 80) return DEFAULT_CITY
  const lat = num(o.lat), lon = num(o.lon)
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return DEFAULT_CITY
  return { name: o.name.trim(), region: typeof o.region === 'string' ? o.region.slice(0, 80) : '', country: typeof o.country === 'string' ? o.country.slice(0, 80) : '', lat, lon }
}
export function normalizeTiles(v: unknown): Record<DashTileKey, boolean> {
  const o = rec(v) ?? {}
  const out = { ...DEFAULT_DASH_TILES }
  for (const k of DASH_TILE_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean
  return out
}

// ---------- rates ----------
const dec = (v: unknown): Decimal | null => {
  try {
    const d = typeof v === 'string' || typeof v === 'number' ? new Decimal(v) : null
    return d && d.isFinite() && d.gt(0) ? d : null
  } catch { return null }
}
export function parseRates(json: unknown, codes: readonly string[] = RATE_CODES): RatesData | null {
  const o = rec(json)
  if (!o || o.result !== 'success') return null
  const rates = rec(o.rates)
  if (!rates) return null
  const inrPerUsd = dec(rates.INR)
  if (!inrPerUsd) return null
  const perUsd: Record<string, string> = {}
  const inr: Record<string, string> = {}
  for (const c of codes) {
    const r = c === 'USD' ? new Decimal(1) : dec(rates[c])
    if (!r) continue
    perUsd[c] = r.toDecimalPlaces(6).toString()
    inr[c] = inrPerUsd.div(r).toDecimalPlaces(4).toFixed(4)
  }
  inr.USD = inrPerUsd.toDecimalPlaces(4).toFixed(4)
  const unix = num(o.time_last_update_unix)
  return { perUsd, inr, asOf: unix === null ? null : new Date(unix * 1000).toISOString() }
}

// ---------- metals ----------
/** `{ price: <USD per troy oz>, updatedAt?: ISO }` as returned by the metals source. */
export function parseMetalPrice(json: unknown): { usdOz: string; asOf: string | null } | null {
  const o = rec(json)
  const p = dec(o?.price)
  if (!o || !p) return null
  const at = typeof o.updatedAt === 'string' && !Number.isNaN(Date.parse(o.updatedAt)) ? new Date(o.updatedAt).toISOString() : null
  return { usdOz: p.toDecimalPlaces(2).toString(), asOf: at }
}
/** Spot USD/oz -> INR per 10 g gold and per kg silver, using the USD->INR rate. Whole rupees (ROUND_HALF_UP). */
export function metalsInInr(gold: { usdOz: string; asOf: string | null }, silver: { usdOz: string; asOf: string | null }, inrPerUsd: string): MetalsData | null {
  const fx = dec(inrPerUsd)
  const g = dec(gold.usdOz), s = dec(silver.usdOz)
  if (!fx || !g || !s) return null
  const oz = new Decimal(TROY_OZ_GRAMS)
  const whole = (d: Decimal): string => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)
  const times = [gold.asOf, silver.asOf].filter((x): x is string => x !== null).sort()
  return {
    goldPer10gInr: whole(g.times(fx).div(oz).times(10)), silverPerKgInr: whole(s.times(fx).div(oz).times(1000)),
    goldUsdOz: g.toFixed(2), silverUsdOz: s.toFixed(2), asOf: times[0] ?? null
  }
}

// ---------- cache ----------
export interface CacheEntry<T = unknown> { data: T; fetchedAt: string; key: string }
export type LiveCache = Partial<Record<LiveKind, CacheEntry>>

/** True when a cached entry is still fresh enough to serve without calling the network (and the key - e.g. the city - is unchanged). */
export function isFresh(entry: CacheEntry | undefined, key: string, kind: LiveKind, nowMs: number): boolean {
  if (!entry || entry.key !== key) return false
  const t = Date.parse(entry.fetchedAt)
  return Number.isFinite(t) && nowMs - t >= 0 && nowMs - t < REFRESH_MS[kind]
}
/** Keep only well-formed entries when reading the persisted cache back (never trust the stored JSON). */
export function sanitizeCache(v: unknown): LiveCache {
  const o = rec(v) ?? {}
  const out: LiveCache = {}
  for (const k of ['weather', 'rates', 'metals'] as const) {
    const e = rec(o[k])
    if (e && typeof e.key === 'string' && typeof e.fetchedAt === 'string' && Number.isFinite(Date.parse(e.fetchedAt)) && e.data !== undefined) out[k] = { key: e.key, fetchedAt: e.fetchedAt, data: e.data }
  }
  return out
}
