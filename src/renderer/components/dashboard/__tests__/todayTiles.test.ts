// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayTiles } from '../TodayTiles'
import { DashboardSection } from '../../settings/DashboardSection'
import { DASH_TILE_KEYS, DEFAULT_DASH_TILES, type DashTileKey } from '@shared/dashboard/live'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const iso = new Date().toISOString()
const ok = <T,>(data: T, offline = false) => ({ ok: true as const, data: { ok: true, data, fetchedAt: iso, offline, source: 'Test source' } })

function bridge(flags: Partial<Record<DashTileKey, boolean>> = {}, over: Record<string, unknown> = {}): void {
  ;(window as unknown as { quot3: unknown }).quot3 = {
    dashboard: {
      getTiles: vi.fn(async () => ({ ok: true as const, data: { ...DEFAULT_DASH_TILES, ...flags } })),
      weather: vi.fn(async () => ok({ city: 'Bangalore', tempC: 24.4, feelsC: 25, humidity: 70, windKmh: 9, code: 1, label: 'Mainly clear', maxC: 28, minC: 20 })),
      rates: vi.fn(async () => ok({ perUsd: {}, inr: { USD: '83.1234', EUR: '90.5', GBP: '105.25', AED: '22.6' }, asOf: iso })),
      metals: vi.fn(async () => ok({ goldPer10gInr: '123456', silverPerKgInr: '98765', goldUsdOz: '2000', silverUsdOz: '25', asOf: iso })),
      ...over
    }
  }
}
async function mount(): Promise<void> { await act(async () => { root.render(createElement(TodayTiles)) }); await flush() }
const tiles = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-tile]')]
const spanOf = (el: HTMLElement): number => Number(/span (\d+)/.exec(el.style.gridColumn)![1])

beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true })
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3; vi.restoreAllMocks() })

describe('Today tiles (Phase 126)', () => {
  it('shows nothing when the bridge is missing (old Dashboard tests stay valid)', async () => {
    await mount()
    expect(host.querySelector('[data-testid="dash-today"]')).toBeNull()
  })

  it('shows the six live tiles (no games installed, so "(?)" stays hidden) in order with their data, INR in Indian grouping, and the forex attribution', async () => {
    bridge(); await mount()
    expect(tiles().map((t) => t.dataset.tile)).toEqual(DASH_TILE_KEYS.filter((k) => k !== 'games'))
    const txt = (k: string): string => host.querySelector(`[data-tile="${k}"]`)!.textContent!
    expect(txt('weather')).toContain('24°C')
    expect(txt('usd')).toContain('₹83.12')
    expect(txt('usd')).toContain('Rates By Exchange Rate API')
    expect(txt('majors')).toContain('₹105.25')
    expect(txt('metals')).toContain('₹1,23,456.00')
    expect(txt('metals')).toContain('Indicative')
    expect(host.querySelector('[data-testid="tile-clock-time"]')!.textContent).not.toBe('')
    expect(tiles().every((t) => t.dataset.offline === 'false')).toBe(true)
  })

  for (const width of [1024, 1280, 1920]) {
    for (let n = 1; n <= 6; n++) {
      it(`${n} enabled at ${width}px: rows are full, no orphan`, async () => {
        Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
        const flags: Partial<Record<DashTileKey, boolean>> = {}
        DASH_TILE_KEYS.forEach((k, i) => { flags[k] = i < n })
        bridge(flags); await mount()
        const spans = tiles().map(spanOf)
        expect(spans).toHaveLength(n)
        // walk the 12-column rows: each must close exactly at 12
        let col = 0
        for (const s of spans) { col += s; expect(col).toBeLessThanOrEqual(12); if (col === 12) col = 0 }
        expect(col).toBe(0)
      })
    }
  }

  it('hides the whole section when every tile is off', async () => {
    bridge(Object.fromEntries(DASH_TILE_KEYS.map((k) => [k, false]))); await mount()
    expect(host.querySelector('[data-testid="dash-today"]')).toBeNull()
  })

  it('dims a tile and says offline when the data is a stale copy; a failed fetch with no cache says not available', async () => {
    bridge({}, { weather: vi.fn(async () => ok({ city: 'Bangalore', tempC: 20, feelsC: 20, humidity: 50, windKmh: 5, code: 0, label: 'Clear', maxC: null, minC: null }, true)), metals: vi.fn(async () => ({ ok: true as const, data: { ok: false, data: null, fetchedAt: null, offline: true, source: 'x' } })), rates: vi.fn(async () => { throw new Error('boom') }) })
    await mount()
    const w = host.querySelector<HTMLElement>('[data-tile="weather"]')!
    expect(w.dataset.offline).toBe('true')
    expect(w.querySelector('.q3-tile__badge')!.textContent).toBe('offline')
    expect(w.textContent).toContain('20°C')
    expect(host.querySelector('[data-tile="metals"]')!.textContent).toContain('Not available right now.')
    expect(host.querySelector('[data-tile="usd"]')!.textContent).toContain('Not available right now.')
    expect(host.querySelector('[data-tile="clock"]')!.getAttribute('data-offline')).toBe('false')
  })

  it('upcoming holidays come from the offline table with no network call', async () => {
    bridge(); await mount()
    const h = host.querySelector('[data-tile="holidays"]')!
    expect(h.querySelectorAll('li').length).toBeGreaterThan(0)
  })
})

describe('Settings > Dashboard tiles (Phase 126)', () => {
  it('toggling a tile saves it; a city search then pick saves the city', async () => {
    const setTiles = vi.fn(async (t: Partial<Record<DashTileKey, boolean>>) => ({ ok: true as const, data: { ...DEFAULT_DASH_TILES, ...t } }))
    const setCity = vi.fn(async (c: unknown) => ({ ok: true as const, data: c }))
    const hit = { id: '1', name: 'Pune', region: 'Maharashtra', country: 'India', lat: 18.5, lon: 73.8 }
    bridge({}, { setTiles, setCity, getCity: vi.fn(async () => ({ ok: true as const, data: { name: 'Bangalore', region: 'Karnataka', country: 'India', lat: 1, lon: 2 } })), searchCities: vi.fn(async () => ({ ok: true as const, data: [hit] })) })
    await act(async () => { root.render(createElement(DashboardSection)) }); await flush()
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes).toHaveLength(7)
    await act(async () => { boxes[3]!.click() }); await flush()
    expect(setTiles).toHaveBeenCalledWith({ metals: false })
    const input = host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'Pune'); input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    const pickBtn = [...host.querySelectorAll('ul[aria-label="City results"] button')][0] as HTMLButtonElement
    expect(pickBtn.textContent).toContain('Pune')
    await act(async () => { pickBtn.click() }); await flush()
    expect(setCity).toHaveBeenCalledWith({ name: 'Pune', region: 'Maharashtra', country: 'India', lat: 18.5, lon: 73.8 })
  })
})
