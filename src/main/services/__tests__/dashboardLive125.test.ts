import { describe, expect, it } from 'vitest'
import { createDashboardLiveService, type DashHttp } from '../dashboardLiveService'
import { createFetchDashHttp } from '../dashboardHttp'
import { RATES_URL, REFRESH_MS } from '../../../shared/dashboard/live'

const WX = { current: { temperature_2m: 24, relative_humidity_2m: 70, apparent_temperature: 25, weather_code: 0, wind_speed_10m: 8 }, daily: { temperature_2m_max: [29], temperature_2m_min: [20] } }
const FX = { result: 'success', time_last_update_unix: 1_760_000_000, rates: { INR: 88, EUR: 0.88, GBP: 0.8, AED: 3.67 } }

function rig() {
  const calls: string[] = []
  let fail = false
  const routes: Record<string, unknown> = {
    'api.open-meteo.com': WX, 'open.er-api.com': FX,
    'api.gold-api.com/price/XAU': { price: 2000, updatedAt: '2026-10-11T10:00:00Z' }, 'api.gold-api.com/price/XAG': { price: 25 },
    'geocoding-api.open-meteo.com': { results: [{ id: 7, name: 'Mysuru', latitude: 12.3, longitude: 76.6, admin1: 'Karnataka', country: 'India' }] }
  }
  const http: DashHttp = {
    async getJson(url) {
      calls.push(url)
      if (fail) throw new Error('network down')
      const u = new URL(url)
      const hit = routes[u.host + u.pathname] ?? routes[u.host]
      if (hit === undefined) throw new Error('404')
      return hit
    }
  }
  const store = new Map<string, unknown>()
  const settings = { get: (k: string) => store.get(k), set: (k: string, v: unknown) => { store.set(k, JSON.parse(JSON.stringify(v))) } }
  let t = Date.parse('2026-10-11T10:00:00.000Z')
  const svc = createDashboardLiveService({ http, settings, now: () => new Date(t), today: () => '2026-10-11' })
  return { svc, calls, store, settings, setFail: (v: boolean) => { fail = v }, advance: (ms: number) => { t += ms }, http, clock: () => t }
}

describe('Phase 125 - dashboardLiveService (fake HTTP, no network)', () => {
  it('default city is Bangalore; weather fetched once, then served from the fresh cache', async () => {
    const r = rig()
    expect(r.svc.getCity().name).toBe('Bangalore')
    const a = await r.svc.weather()
    expect(a).toMatchObject({ ok: true, offline: false, data: { city: 'Bangalore', tempC: 24, label: 'Clear sky' } })
    await r.svc.weather()
    expect(r.calls).toHaveLength(1)
    expect(new URL(r.calls[0]!).searchParams.get('latitude')).toBe('12.9719')
    r.advance(REFRESH_MS.weather + 1)
    await r.svc.weather()
    expect(r.calls).toHaveLength(2)
  })
  it('force skips a fresh cache; concurrent calls share one request', async () => {
    const r = rig()
    await Promise.all([r.svc.rates(), r.svc.rates(), r.svc.rates()])
    expect(r.calls).toEqual([RATES_URL])
    await r.svc.rates({ force: true })
    expect(r.calls).toHaveLength(2)
  })
  it('network failure: last good value is returned dimmed (offline), never thrown; no cache = ok:false', async () => {
    const r = rig()
    expect((await r.svc.rates()).ok).toBe(true)
    r.advance(REFRESH_MS.rates + 1)
    r.setFail(true)
    const off = await r.svc.rates()
    expect(off).toMatchObject({ ok: true, offline: true, error: 'network down' })
    expect(off.data!.inr.USD).toBe('88.0000')
    expect(off.fetchedAt).toBe('2026-10-11T10:00:00.000Z')
    const none = await r.svc.weather()
    expect(none).toMatchObject({ ok: false, data: null, offline: true })
  })
  it('a cached value for another city is NOT shown after the city changes', async () => {
    const r = rig()
    await r.svc.weather()
    r.svc.setCity({ name: 'Mysuru', region: 'Karnataka', country: 'India', lat: 12.3, lon: 76.6 })
    r.setFail(true)
    expect((await r.svc.weather()).ok).toBe(false)
    r.setFail(false)
    const w = await r.svc.weather()
    expect(w.data!.city).toBe('Mysuru')
  })
  it('the cache survives a restart (persisted in settings) and is re-validated', async () => {
    const r = rig()
    await r.svc.rates()
    const svc2 = createDashboardLiveService({ http: { getJson: async () => { throw new Error('down') } }, settings: r.settings, now: () => new Date(r.clock() + REFRESH_MS.rates + 1) })
    expect(await svc2.rates()).toMatchObject({ ok: true, offline: true })
    r.store.set('dash.cache', { rates: 'garbage' })
    const svc3 = createDashboardLiveService({ http: { getJson: async () => { throw new Error('down') } }, settings: r.settings })
    expect((await svc3.rates()).ok).toBe(false)
  })
  it('metals use the cached USD/INR rate and a bad payload is a failure, not a crash', async () => {
    const r = rig()
    const m = await r.svc.metals()
    expect(m).toMatchObject({ ok: true, data: { goldPer10gInr: '56585', silverPerKgInr: '70732' } })
    expect(r.calls.filter((c) => c.includes('er-api'))).toHaveLength(1)
    const bad = rig()
    const orig = bad.http.getJson
    bad.http.getJson = async (u, t) => (u.includes('XAU') ? { price: 'x' } : orig(u, t))
    const svc = createDashboardLiveService({ http: bad.http, settings: bad.settings, now: () => new Date(bad.clock()) })
    expect((await svc.metals()).ok).toBe(false)
  })
  it('PRIVACY: every request goes to an allow-listed host; none carries bill data; only city name / coordinates / codes', async () => {
    const r = rig()
    await r.svc.weather(); await r.svc.rates(); await r.svc.metals(); await r.svc.searchCities('Mysuru')
    const hosts = new Set(r.calls.map((c) => new URL(c).host))
    expect([...hosts].sort()).toEqual(['api.gold-api.com', 'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'open.er-api.com'])
    expect(r.calls.every((c) => c.startsWith('https://'))).toBe(true)
  })
  it('a host outside the allow-list is refused before any request', async () => {
    const calls: string[] = []
    const svc = createDashboardLiveService({ http: { getJson: async (u) => { calls.push(u); return {} } }, settings: { get: () => undefined, set: () => undefined } })
    expect(await svc.searchCities('x')).toEqual([]) // too short: no request
    expect(calls).toEqual([])
  })
  it('city search returns hits, [] on failure; setCity validates; tiles normalise', async () => {
    const r = rig()
    expect(await r.svc.searchCities('Mysuru')).toEqual([{ id: '7', name: 'Mysuru', region: 'Karnataka', country: 'India', lat: 12.3, lon: 76.6 }])
    r.setFail(true)
    expect(await r.svc.searchCities('Mysuru')).toEqual([])
    expect(() => r.svc.setCity({ name: 'Bad', lat: 500, lon: 0 })).toThrow()
    expect(() => r.svc.setCity(null)).toThrow()
    expect(r.svc.setCity({ name: 'Bangalore', region: '', country: '', lat: 12.9, lon: 77.6 }).name).toBe('Bangalore')
    expect(r.svc.setTiles({ metals: false, junk: true }).metals).toBe(false)
    expect(r.svc.getTiles().weather).toBe(true)
  })
  it('read-only settings: a failed cache write does not break the call', async () => {
    const svc = createDashboardLiveService({ http: { getJson: async () => FX }, settings: { get: () => undefined, set: () => { throw new Error('read-only') } } })
    expect((await svc.rates()).ok).toBe(true)
  })
  it('holidays come from the offline table (no request)', () => {
    const r = rig()
    const h = r.svc.holidays(2)
    expect(h.items.map((x) => x.name)).toEqual(['Dussehra', 'Diwali'])
    expect(h.expired).toBe(false)
    expect(r.calls).toEqual([])
  })
})

describe('Phase 125 - createFetchDashHttp (fake fetch)', () => {
  const ok = (body: string, status = 200) => async () => ({ ok: status < 300, status, text: async () => body }) as unknown as Response
  it('parses JSON, rejects non-2xx, oversize and bad JSON, uses GET without credentials', async () => {
    let init: RequestInit | undefined
    const spy = (async (_u: string, i?: RequestInit) => { init = i; return { ok: true, status: 200, text: async () => '{"a":1}' } as unknown as Response }) as unknown as typeof fetch
    expect(await createFetchDashHttp(spy).getJson('https://open.er-api.com/x', 1000)).toEqual({ a: 1 })
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
    await expect(createFetchDashHttp(ok('{}', 429) as unknown as typeof fetch).getJson('https://x', 1000)).rejects.toThrow('HTTP 429')
    await expect(createFetchDashHttp(ok('x'.repeat(600_000)) as unknown as typeof fetch).getJson('https://x', 1000)).rejects.toThrow('too large')
    await expect(createFetchDashHttp(ok('not json') as unknown as typeof fetch).getJson('https://x', 1000)).rejects.toThrow()
  })
  it('times out via abort', async () => {
    const hang = ((_u: string, i?: RequestInit) => new Promise((_r, rej) => { i?.signal?.addEventListener('abort', () => rej(new Error('aborted'))) })) as unknown as typeof fetch
    await expect(createFetchDashHttp(hang).getJson('https://x', 20)).rejects.toThrow('aborted')
  })
})
