import { useEffect, useMemo, useState } from 'react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { CloudSun, Clock, CurrencyDollar, Coins, CalendarStar, CurrencyCircleDollar } from '@phosphor-icons/react'
import type { Quot3Bridge, Result } from '@shared/ipc'
import { DEFAULT_DASH_TILES, REFRESH_MS, type DashTileKey, type LiveResult, type MetalsData, type RatesData, type WeatherData } from '@shared/dashboard/live'
import { upcomingHolidays } from '@shared/dashboard/holidays'
import { ageLabel, daysAwayLabel, enabledTiles, localIsoDate, tileSpans, TILE_LABELS, MIN_TILE_WIDTH } from '@shared/dashboard/tileLayout'
import { formatHistoryTotal } from '@shared/history/historyList'
import { Icon } from '../ui'
import { GamesTile } from './GamesTile'
import { useGamesStore } from '../../stores/gamesStore'
import { loadGames, loadGamesEnabled } from '../../stores/gamesActions'

type Api = Quot3Bridge['dashboard']
const api = (): Partial<Api> | undefined => (window as unknown as { quot3?: { dashboard?: Partial<Api> } }).quot3?.dashboard

type Live<T> = { state: 'loading' } | { state: 'ready'; res: LiveResult<T> }

/** Loads one live value on mount, on the source's refresh interval and when the window regains focus. A missing bridge or a throw = not ok (never crashes the Dashboard). */
function useLive<T>(pick: (a: Partial<Api>) => (() => Promise<Result<LiveResult<T>>>) | undefined, every: number, enabled: boolean): Live<T> {
  const [v, setV] = useState<Live<T>>({ state: 'loading' })
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const run = async (): Promise<void> => {
      const call = api() ? pick(api()!) : undefined
      let res: LiveResult<T> = { ok: false, data: null, fetchedAt: null, offline: true, source: '' }
      try { if (call) { const r = await call(); if (r.ok) res = r.data } } catch { /* shown as offline */ }
      if (alive) setV({ state: 'ready', res })
    }
    void run()
    const t = setInterval(() => { void run() }, every)
    const onFocus = (): void => { void run() }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [every, enabled])
  return v
}

interface TileShellProps { id: DashTileKey; span: number; icon: PhosphorIcon; offline?: boolean; foot?: string; children: React.ReactNode }

function TileShell({ id, span, icon, offline = false, foot, children }: TileShellProps): React.JSX.Element {
  return (
    <section className={`q3-tile nm-inset nm-sm${offline ? ' q3-tile--offline' : ''}`} style={{ gridColumn: `span ${span}` }} data-tile={id} data-offline={offline ? 'true' : 'false'} aria-label={TILE_LABELS[id]}>
      <h3 className="q3-tile__title"><Icon icon={icon} weight="duotone" size="md" />{TILE_LABELS[id]}{offline && <span className="q3-tile__badge">offline</span>}</h3>
      <div className="q3-tile__body">{children}</div>
      {foot !== undefined && foot !== '' && <p className="q3-tile__foot">{foot}</p>}
    </section>
  )
}

const Loading = (): React.JSX.Element => <p className="q3-tile__note">Loading…</p>
const Unavailable = (): React.JSX.Element => <p className="q3-tile__note">Not available right now.</p>
const foot = (res: LiveResult<unknown>, extra = ''): string => [res.source, res.fetchedAt ? ageLabel(res.fetchedAt, Date.now()) : '', extra].filter((x) => x !== '').join(' · ')

function WeatherTile({ span }: { span: number }): React.JSX.Element {
  const v = useLive<WeatherData>((a) => a.weather ? () => a.weather!() : undefined, REFRESH_MS.weather, true)
  const res = v.state === 'ready' ? v.res : null
  const d: WeatherData | null = res?.data ?? null
  return (
    <TileShell id="weather" span={span} icon={CloudSun} offline={res !== null && (res.offline || !res.ok)} foot={res ? foot(res) : ''}>
      {v.state === 'loading' ? <Loading /> : !d ? <Unavailable /> : (
        <>
          <p className="q3-tile__big">{Math.round(d.tempC)}°C <span className="q3-tile__sub">{d.label}</span></p>
          <p className="q3-tile__line" title={d.city}>{d.city}</p>
          <p className="q3-tile__line">Feels {Math.round(d.feelsC)}°C · Humidity {d.humidity}% · Wind {Math.round(d.windKmh)} km/h</p>
          {d.maxC !== null && d.minC !== null && <p className="q3-tile__line">High {Math.round(d.maxC)}°C · Low {Math.round(d.minC)}°C</p>}
        </>
      )}
    </TileShell>
  )
}

const rate = (r: RatesData | null, code: string): string => (r?.inr[code] !== undefined ? formatHistoryTotal(r.inr[code]!) : '—')

/** Both forex tiles ask for the same cached rates (the service shares one request and serves the cache). */
function RatesTile({ id, span }: { id: 'usd' | 'majors'; span: number }): React.JSX.Element {
  const v = useLive<RatesData>((a) => a.rates ? () => a.rates!() : undefined, REFRESH_MS.rates, true)
  const res = v.state === 'ready' ? v.res : null
  const d: RatesData | null = res?.data ?? null
  const attribution = 'Rates By Exchange Rate API'
  return (
    <TileShell id={id} span={span} icon={id === 'usd' ? CurrencyDollar : CurrencyCircleDollar} offline={res !== null && (res.offline || !res.ok)} foot={res ? foot(res, attribution) : ''}>
      {v.state === 'loading' ? <Loading /> : !d ? <Unavailable /> : id === 'usd' ? (
        <>
          <p className="q3-tile__big">{rate(d, 'USD')}</p>
          <p className="q3-tile__line">for 1 US dollar</p>
        </>
      ) : (
        <ul className="q3-tile__rows">
          {(['EUR', 'GBP', 'AED'] as const).map((c) => <li key={c}><span>{c}</span><span className="q3-tile__num">{rate(d, c)}</span></li>)}
        </ul>
      )}
    </TileShell>
  )
}

function MetalsTile({ span }: { span: number }): React.JSX.Element {
  const v = useLive<MetalsData>((a) => a.metals ? () => a.metals!() : undefined, REFRESH_MS.metals, true)
  const res = v.state === 'ready' ? v.res : null
  const d: MetalsData | null = res?.data ?? null
  return (
    <TileShell id="metals" span={span} icon={Coins} offline={res !== null && (res.offline || !res.ok)} foot={res ? foot(res, 'Indicative spot price, before duty, GST and making charges') : ''}>
      {v.state === 'loading' ? <Loading /> : !d ? <Unavailable /> : (
        <ul className="q3-tile__rows">
          <li><span>Gold, 10 g</span><span className="q3-tile__num">{formatHistoryTotal(d.goldPer10gInr)}</span></li>
          <li><span>Silver, 1 kg</span><span className="q3-tile__num">{formatHistoryTotal(d.silverPerKgInr)}</span></li>
        </ul>
      )}
    </TileShell>
  )
}

function ClockTile({ span }: { span: number }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  return (
    <TileShell id="clock" span={span} icon={Clock}>
      <p className="q3-tile__big" data-testid="tile-clock-time">{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
      <p className="q3-tile__line">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
    </TileShell>
  )
}

function HolidaysTile({ span }: { span: number }): React.JSX.Element {
  const items = useMemo(() => upcomingHolidays(localIsoDate(new Date()), 3), [])
  return (
    <TileShell id="holidays" span={span} icon={CalendarStar} foot="Offline list; festival dates that follow the moon are approximate">
      {items.length === 0 ? <p className="q3-tile__note">The holiday list has run out.</p> : (
        <ul className="q3-tile__rows">
          {items.map((h) => (
            <li key={h.date + h.name}><span className="q3-tile__trunc" title={h.name}>{h.name}{h.approx ? ' (approx.)' : ''}</span><span className="q3-tile__num">{daysAwayLabel(h.daysAway)}</span></li>
          ))}
        </ul>
      )}
    </TileShell>
  )
}

/** Window width, tracked for the 3 x 2 / 2 x 3 switch (the layout is only specified from 1024 px up). */
function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  useEffect(() => {
    const on = (): void => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return Math.max(w, MIN_TILE_WIDTH)
}

/**
 * Phase 126 - the Dashboard "Today" section: up to seven small tiles (weather, USD/INR, EUR/GBP/AED, gold and silver, clock, holidays and the Phase 203 "(?)" games tile)
 * in a 12-column grid whose rows are always full, whatever number is switched on in Settings. All data comes from the main process
 * through `window.quot3.dashboard.*` (cached; a failed refresh shows the last good value dimmed with an 'offline' badge). Nothing here
 * blocks the Dashboard opening: the tiles fill in as their data arrives.
 */
export function TodayTiles(): React.JSX.Element | null {
  const [flags, setFlags] = useState<Record<DashTileKey, boolean> | null>(null)
  const width = useWindowWidth()
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const a = api()
      if (!a?.getTiles) return
      try { const r = await a.getTiles(); if (alive) setFlags(r.ok ? { ...DEFAULT_DASH_TILES, ...r.data } : { ...DEFAULT_DASH_TILES }) } catch { if (alive) setFlags({ ...DEFAULT_DASH_TILES }) }
    }
    void load()
    const onFocus = (): void => { void load() }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [])
  // Phase 203: the "(?)" tile also needs Games switched on and at least one game; otherwise it is hidden and the others re-flow.
  const gamesOn = useGamesStore((s) => s.enabled)
  const gameCount = useGamesStore((s) => s.games.length)
  useEffect(() => { void loadGamesEnabled(); void loadGames() }, [])
  const keys = useMemo(() => (flags ? enabledTiles(flags).filter((k) => k !== 'games' || (gamesOn && gameCount > 0)) : []), [flags, gamesOn, gameCount])
  const spans = tileSpans(keys.length, width)
  if (flags === null || keys.length === 0) return null
  return (
    <section className="q3-today" aria-label="Live tiles" data-testid="dash-today">
      <h2 className="q3-stats__title">Today</h2>
      <div className="q3-today__grid">
        {keys.map((k, i) => {
          const span = spans[i]!
          switch (k) {
            case 'weather': return <WeatherTile key={k} span={span} />
            case 'usd': return <RatesTile key={k} id="usd" span={span} />
            case 'majors': return <RatesTile key={k} id="majors" span={span} />
            case 'metals': return <MetalsTile key={k} span={span} />
            case 'clock': return <ClockTile key={k} span={span} />
            case 'games': return <GamesTile key={k} span={span} />
            default: return <HolidaysTile key={k} span={span} />
          }
        })}
      </div>
    </section>
  )
}
