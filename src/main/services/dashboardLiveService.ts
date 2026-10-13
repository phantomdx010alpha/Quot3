import {
  DEFAULT_CITY, FETCH_TIMEOUT_MS, GOLD_URL, RATES_URL, SILVER_URL, geocodeUrl, isAllowedUrl, isFresh, metalsInInr, normalizeCity, normalizeTiles,
  parseCityHits, parseMetalPrice, parseRates, parseWeather, sanitizeCache, weatherUrl,
  type CityHit, type DashCity, type DashTileKey, type LiveCache, type LiveKind, type LiveResult, type MetalsData, type RatesData, type WeatherData
} from '../../shared/dashboard/live'
import { HOLIDAYS, upcomingHolidays, type UpcomingHoliday } from '../../shared/dashboard/holidays'
import { AppError } from '../ipc/envelope'

/**
 * Phase 125 - Dashboard live data (weather, forex, gold / silver) and offline holidays.
 * ALL network calls happen here, in the main process, through the injected `http` port (tests use a fake; there is no network in tests).
 * Only allow-listed https hosts are called. Only the city name / its coordinates and currency / metal codes leave the PC - never bills.
 * Each source is cached (in memory + the `dash.cache` setting). A fresh cache is served without a request; when a request fails the last good
 * value is returned with `offline: true` so the tile can show it dimmed. Nothing here ever throws to the renderer for a network problem.
 */
export interface DashHttp {
  /** GET `url` and return parsed JSON; reject on a network error, timeout or non-2xx. */
  getJson(url: string, timeoutMs: number): Promise<unknown>
}
export interface DashSettings { get(key: string): unknown; set(key: string, value: unknown): void }

export interface DashboardLiveService {
  weather(opts?: { force?: boolean }): Promise<LiveResult<WeatherData>>
  rates(opts?: { force?: boolean }): Promise<LiveResult<RatesData>>
  metals(opts?: { force?: boolean }): Promise<LiveResult<MetalsData>>
  holidays(count?: number): { items: UpcomingHoliday[]; expired: boolean }
  searchCities(query: string): Promise<CityHit[]>
  getCity(): DashCity
  setCity(city: unknown): DashCity
  getTiles(): Record<DashTileKey, boolean>
  setTiles(tiles: unknown): Record<DashTileKey, boolean>
}

export interface DashboardLiveDeps {
  http: DashHttp
  settings: DashSettings
  now?: () => Date
  today?: () => string
  log?: { warn(msg: string, extra?: unknown): void }
}

const SRC = { weather: 'Open-Meteo', rates: 'ExchangeRate-API', metals: 'gold-api.com (spot, indicative)' } as const

export function createDashboardLiveService(deps: DashboardLiveDeps): DashboardLiveService {
  const now = deps.now ?? (() => new Date())
  const todayFn = deps.today ?? (() => { const d = now(); const p = (n: number): string => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
  let cache: LiveCache | null = null
  const inflight = new Map<string, Promise<unknown>>()

  const loadCache = (): LiveCache => {
    if (cache === null) { try { cache = sanitizeCache(deps.settings.get('dash.cache')) } catch { cache = {} } }
    return cache
  }
  const saveCache = (): void => { try { deps.settings.set('dash.cache', loadCache()) } catch { /* read-only DB: the in-memory cache still works */ } }

  const http = async (url: string): Promise<unknown> => {
    if (!isAllowedUrl(url)) throw new Error('Host not allowed')
    return deps.http.getJson(url, FETCH_TIMEOUT_MS)
  }

  /** Cache-aware fetch. `key` ties an entry to what it was fetched for (e.g. the city). Concurrent calls share one request. */
  async function live<T>(kind: LiveKind, key: string, force: boolean, fetcher: () => Promise<T | null>): Promise<LiveResult<T>> {
    const c = loadCache()
    const entry = c[kind]
    if (!force && isFresh(entry, key, kind, now().getTime())) return { ok: true, data: entry!.data as T, fetchedAt: entry!.fetchedAt, offline: false, source: SRC[kind] }
    const id = `${kind}|${key}`
    let p = inflight.get(id) as Promise<T | null> | undefined
    if (!p) { p = fetcher().finally(() => inflight.delete(id)); inflight.set(id, p) }
    try {
      const data = await p
      if (data === null) throw new Error('Unexpected response')
      const fetchedAt = now().toISOString()
      c[kind] = { key, fetchedAt, data }
      saveCache()
      return { ok: true, data, fetchedAt, offline: false, source: SRC[kind] }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Request failed'
      deps.log?.warn(`Dashboard ${kind}: fetch failed`, { error }) // text only: no URLs with the city in logs
      // The last good value (same key) is still shown, dimmed. A value for another city is not.
      if (entry && entry.key === key) return { ok: true, data: entry.data as T, fetchedAt: entry.fetchedAt, offline: true, source: SRC[kind], error }
      return { ok: false, data: null, fetchedAt: null, offline: true, source: SRC[kind], error }
    }
  }

  const getCity = (): DashCity => { try { return normalizeCity(deps.settings.get('dash.city')) } catch { return DEFAULT_CITY } }

  const ratesNow = (force: boolean): Promise<LiveResult<RatesData>> =>
    live<RatesData>('rates', 'usd', force, async () => parseRates(await http(RATES_URL)))

  return {
    weather: (o) => { const c = getCity(); return live<WeatherData>('weather', `${c.lat.toFixed(4)},${c.lon.toFixed(4)}`, !!o?.force, async () => parseWeather(await http(weatherUrl(c)), c.name)) },
    rates: (o) => ratesNow(!!o?.force),
    async metals(o) {
      return live<MetalsData>('metals', 'xau-xag', !!o?.force, async () => {
        const fx = await ratesNow(false)
        const inr = fx.data?.inr.USD
        if (!inr) throw new Error('No USD/INR rate')
        const [g, s] = await Promise.all([http(GOLD_URL), http(SILVER_URL)])
        const gold = parseMetalPrice(g), silver = parseMetalPrice(s)
        return gold && silver ? metalsInInr(gold, silver, inr) : null
      })
    },
    holidays(count = 3) {
      const n = Math.min(Math.max(Math.trunc(count), 1), 10)
      const items = upcomingHolidays(todayFn(), n, HOLIDAYS)
      return { items, expired: items.length === 0 }
    },
    async searchCities(query) {
      const q = query.trim()
      if (q.length < 2 || q.length > 80) return []
      try { return parseCityHits(await http(geocodeUrl(q))) } catch (e) { deps.log?.warn('Dashboard city search failed', { error: e instanceof Error ? e.message : 'failed' }); return [] }
    },
    getCity,
    setCity(city) {
      const c = normalizeCity(city)
      if (c === DEFAULT_CITY && (typeof city !== 'object' || city === null || (city as { name?: unknown }).name !== DEFAULT_CITY.name)) throw new AppError('VALIDATION', 'Invalid city')
      deps.settings.set('dash.city', c)
      return c
    },
    getTiles() { try { return normalizeTiles(deps.settings.get('dash.tiles')) } catch { return normalizeTiles(undefined) } },
    setTiles(tiles) { const t = normalizeTiles(tiles); deps.settings.set('dash.tiles', t); return t }
  }
}
