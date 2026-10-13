import { describe, expect, it } from 'vitest'
import {
  DASH_HOSTS, DEFAULT_CITY, GOLD_URL, RATES_URL, REFRESH_MS, SILVER_URL, geocodeUrl, isAllowedUrl, isFresh, metalsInInr, normalizeCity, normalizeTiles,
  parseCityHits, parseMetalPrice, parseRates, parseWeather, sanitizeCache, weatherLabel, weatherUrl
} from '../live'
import { holidayTableExpired, upcomingHolidays } from '../holidays'

describe('Phase 125 - URLs and allow-list (privacy)', () => {
  it('every built URL is https on an allow-listed host', () => {
    for (const u of [weatherUrl(DEFAULT_CITY), geocodeUrl('Mysuru'), RATES_URL, GOLD_URL, SILVER_URL]) expect(isAllowedUrl(u)).toBe(true)
    expect(DASH_HOSTS).toHaveLength(4)
  })
  it('rejects other hosts, http, credentials, garbage', () => {
    for (const u of ['https://evil.example/x', 'http://open.er-api.com/v6/latest/USD', 'https://user:pw@open.er-api.com/', 'nope', 'https://open.er-api.com.evil.com/']) expect(isAllowedUrl(u)).toBe(false)
  })
  it('the weather URL carries only coordinates + fixed field names; the search URL only the typed name', () => {
    const w = new URL(weatherUrl(DEFAULT_CITY))
    expect([...w.searchParams.keys()].sort()).toEqual(['current', 'daily', 'forecast_days', 'latitude', 'longitude', 'timezone'])
    const g = new URL(geocodeUrl('  Pune '))
    expect(g.searchParams.get('name')).toBe('Pune')
  })
})

describe('Phase 125 - parsers', () => {
  const wx = { current: { temperature_2m: 24.6, relative_humidity_2m: 71, apparent_temperature: 26.2, weather_code: 3, wind_speed_10m: 9.4 }, daily: { temperature_2m_max: [28.4], temperature_2m_min: [20.1] } }
  it('weather', () => {
    expect(parseWeather(wx, 'Bangalore')).toEqual({ city: 'Bangalore', tempC: 25, feelsC: 26, humidity: 71, windKmh: 9, code: 3, label: 'Overcast', maxC: 28, minC: 20 })
    expect(parseWeather({ current: {} }, 'x')).toBeNull()
    expect(parseWeather(null, 'x')).toBeNull()
    expect(weatherLabel(999)).toBe('Unknown')
  })
  it('city hits drop malformed rows', () => {
    const hits = parseCityHits({ results: [{ id: 1, name: 'Mysuru', latitude: 12.3, longitude: 76.6, admin1: 'Karnataka', country: 'India' }, { name: '', latitude: 1, longitude: 1 }, { name: 'Bad', latitude: 99, longitude: 1 }, 5] })
    expect(hits).toEqual([{ id: '1', name: 'Mysuru', region: 'Karnataka', country: 'India', lat: 12.3, lon: 76.6 }])
    expect(parseCityHits({})).toEqual([])
  })
  const fx = { result: 'success', time_last_update_unix: 1_760_000_000, rates: { INR: 88.5, EUR: 0.85, GBP: 0.75, AED: 3.6725 } }
  it('rates: foreign per USD and INR per unit as decimal strings', () => {
    const r = parseRates(fx)!
    expect(r.inr.USD).toBe('88.5000')
    expect(r.inr.EUR).toBe('104.1176')
    expect(r.inr.GBP).toBe('118.0000')
    expect(r.perUsd.AED).toBe('3.6725')
    expect(r.asOf).toBe(new Date(1_760_000_000 * 1000).toISOString())
    expect(parseRates({ result: 'error' })).toBeNull()
    expect(parseRates({ result: 'success', rates: { EUR: 1 } })).toBeNull()
  })
  it('metals: USD/oz to INR per 10 g gold and per kg silver, whole rupees, no float drift', () => {
    expect(parseMetalPrice({ price: 2000.126, updatedAt: '2026-10-11T10:00:00Z' })).toEqual({ usdOz: '2000.13', asOf: '2026-10-11T10:00:00.000Z' })
    expect(parseMetalPrice({ price: 0 })).toBeNull()
    expect(parseMetalPrice({ price: 'abc' })).toBeNull()
    const m = metalsInInr({ usdOz: '2000', asOf: '2026-10-11T10:00:00.000Z' }, { usdOz: '25', asOf: null }, '88')
    // 2000 * 88 / 31.1034768 * 10 = 56585.0 (176000 / 31.1034768 = 5658.5) ; 25 * 88 / 31.1034768 * 1000 = 70732
    expect(m).toMatchObject({ goldPer10gInr: '56585', silverPerKgInr: '70732', goldUsdOz: '2000.00', silverUsdOz: '25.00', asOf: '2026-10-11T10:00:00.000Z' })
    expect(metalsInInr({ usdOz: '0', asOf: null }, { usdOz: '1', asOf: null }, '88')).toBeNull()
  })
})

describe('Phase 125 - settings + cache rules', () => {
  it('city and tiles fall back safely', () => {
    expect(normalizeCity(undefined)).toEqual(DEFAULT_CITY)
    expect(normalizeCity({ name: 'X', lat: 200, lon: 0 })).toEqual(DEFAULT_CITY)
    expect(normalizeCity({ name: ' Pune ', lat: 18.5, lon: 73.8 })).toMatchObject({ name: 'Pune', region: '', country: '' })
    expect(normalizeTiles({ weather: false, nope: true, usd: 'x' })).toEqual({ weather: false, usd: true, majors: true, metals: true, clock: true, holidays: true })
  })
  it('freshness: same key and younger than the refresh period only', () => {
    const e = { key: 'k', fetchedAt: '2026-10-11T10:00:00.000Z', data: 1 }
    const t = Date.parse(e.fetchedAt)
    expect(isFresh(e, 'k', 'weather', t + REFRESH_MS.weather - 1)).toBe(true)
    expect(isFresh(e, 'k', 'weather', t + REFRESH_MS.weather)).toBe(false)
    expect(isFresh(e, 'other', 'weather', t + 1)).toBe(false)
    expect(isFresh(undefined, 'k', 'weather', t)).toBe(false)
    expect(isFresh(e, 'k', 'weather', t - 5)).toBe(false)
    expect(REFRESH_MS.rates).toBeGreaterThanOrEqual(60 * 60_000)
  })
  it('sanitizeCache drops malformed entries', () => {
    expect(sanitizeCache({ weather: { key: 'a', fetchedAt: '2026-10-11T10:00:00Z', data: { t: 1 } }, rates: { key: 1 }, metals: 'x' })).toEqual({ weather: { key: 'a', fetchedAt: '2026-10-11T10:00:00Z', data: { t: 1 } } })
    expect(sanitizeCache('junk')).toEqual({})
  })
})

describe('Phase 125 - offline holidays', () => {
  it('next holidays, soonest first, today counts as 0 days', () => {
    const u = upcomingHolidays('2026-10-11', 3)
    expect(u.map((h) => h.name)).toEqual(['Dussehra', 'Diwali', 'Guru Nanak Jayanti'])
    expect(u[0]!.daysAway).toBe(9)
    expect(upcomingHolidays('2026-10-02', 1)[0]).toMatchObject({ name: 'Gandhi Jayanti', daysAway: 0 })
  })
  it('rolls into next year; empty and expired after the table; bad input', () => {
    expect(upcomingHolidays('2026-12-26', 1)[0]!.date).toBe('2027-01-26')
    expect(holidayTableExpired('2028-01-01')).toBe(true)
    expect(holidayTableExpired('2026-10-11')).toBe(false)
    expect(upcomingHolidays('bad')).toEqual([])
  })
})
