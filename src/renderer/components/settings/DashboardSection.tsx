import { useEffect, useState } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import { DASH_TILE_KEYS, DEFAULT_CITY, DEFAULT_DASH_TILES, type CityHit, type DashCity, type DashTileKey } from '@shared/dashboard/live'
import { TILE_LABELS } from '@shared/dashboard/tileLayout'
import { Button, Input } from '../ui'

type Api = Quot3Bridge['dashboard']
const api = (): Partial<Api> | undefined => (window as unknown as { quot3?: { dashboard?: Partial<Api> } }).quot3?.dashboard
const cityText = (c: Pick<DashCity, 'name' | 'region' | 'country'>): string => [c.name, c.region, c.country].filter((x) => x !== '').join(', ')

/**
 * Phase 126 - Settings > Dashboard tiles: which of the six Today tiles show (the Dashboard re-flows so no row is left part-empty) and
 * the weather city. Only the typed city name is sent to the geocoder; the city is saved as `dash.city`.
 */
export function DashboardSection(): React.JSX.Element {
  const [tiles, setTiles] = useState<Record<DashTileKey, boolean>>({ ...DEFAULT_DASH_TILES })
  const [city, setCity] = useState<DashCity>(DEFAULT_CITY)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CityHit[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const a = api()
    void (async () => {
      try {
        const t = await a?.getTiles?.(); if (t?.ok) setTiles(t.data)
        const c = await a?.getCity?.(); if (c?.ok) setCity(c.data)
      } catch { /* defaults stay */ }
    })()
  }, [])
  const toggle = async (k: DashTileKey, on: boolean): Promise<void> => {
    setTiles((t) => ({ ...t, [k]: on }))
    try {
      const r = await api()?.setTiles?.({ [k]: on })
      if (r?.ok) { setTiles(r.data); setMsg('') } else setMsg(r ? r.error.message : 'Could not save.')
    } catch { setMsg('Could not save.') }
  }
  const search = async (): Promise<void> => {
    const q = query.trim()
    if (q === '') { setHits([]); return }
    setBusy(true); setMsg('')
    try {
      const r = await api()?.searchCities?.(q)
      if (r?.ok) { setHits(r.data); if (r.data.length === 0) setMsg('No city found. Check the spelling or try a bigger nearby city.') } else setMsg(r ? r.error.message : 'City search is not available.')
    } catch { setMsg('City search is not available.') }
    setBusy(false)
  }
  const pick = async (h: CityHit): Promise<void> => {
    try {
      const { id: _id, ...c } = h
      const r = await api()?.setCity?.(c)
      if (r?.ok) { setCity(r.data); setHits([]); setQuery(''); setMsg(`Weather city set to ${cityText(r.data)}.`) } else setMsg(r ? r.error.message : 'Could not save the city.')
    } catch { setMsg('Could not save the city.') }
  }
  const on = DASH_TILE_KEYS.filter((k) => tiles[k]).length
  return (
    <form className="q3-set__form" aria-label="Dashboard tiles" onSubmit={(e) => { e.preventDefault(); void search() }}>
      <fieldset className="q3-set__fieldset">
        <legend>Tiles shown under Today on the Dashboard</legend>
        {DASH_TILE_KEYS.map((k) => (
          <label key={k} className="q3-set__check">
            <input type="checkbox" checked={tiles[k]} onChange={(e) => { void toggle(k, e.target.checked) }} /> {TILE_LABELS[k]}
          </label>
        ))}
        <p className="q3-set__hint">{on === 0 ? 'All tiles are off: the Today section is hidden.' : `${on} of ${DASH_TILE_KEYS.length} shown. The Dashboard re-arranges them so no row is left half empty.`}</p>
      </fieldset>
      <Input label="Weather city" value={query} onChange={(e) => setQuery(e.target.value)} hint={`Now: ${cityText(city)}. Type a city name and press Enter to search. Only that name is sent to find it.`} />
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={busy || query.trim() === ''}>Search city</Button></div>
      {hits.length > 0 && (
        <ul className="q3-set__list" aria-label="City results">
          {hits.map((h) => (
            <li key={h.id}><Button type="button" variant="ghost" onClick={() => { void pick(h) }}>{cityText(h)}</Button></li>
          ))}
        </ul>
      )}
      {msg !== '' && <p role="status" className="q3-set__hint">{msg}</p>}
    </form>
  )
}
