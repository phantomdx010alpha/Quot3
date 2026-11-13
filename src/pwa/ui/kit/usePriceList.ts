/** Phase 245 (M23) - React hooks behind the phone Price List screens. Read only (they call the loader, never a save). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PhoneDb } from '../../data/db'
import { loadPriceList, type PriceListLoaded } from './priceListLoad'
import { resolveHits, searchActive, searchAll, type PriceListData, type ResolvedHit } from './priceListModel'

export type PriceLoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; loaded: PriceListLoaded; reload: () => void }

/** Reads the Price List once when the screen opens (and again if `db` changes) [A]: a sync that lands while the screen is open shows on the next visit. */
export function usePriceList(db: PhoneDb | null, refreshRights?: () => Promise<void>): PriceLoadState {
  const [state, setState] = useState<PriceLoadState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])
  // Phase 246: ask the server for this seat's rights once when the screen opens; the answer is cached and the list is read again (never blocks the first draw).
  useEffect(() => {
    if (!refreshRights) return
    let off = false
    refreshRights().then(() => { if (!off) setTick((n) => n + 1) }, () => undefined)
    return () => { off = true }
  }, [refreshRights])
  useEffect(() => {
    if (!db) { setState({ status: 'error', message: 'Your Price List could not be opened.' }); return undefined }
    let off = false
    if (tick === 0) setState({ status: 'loading' })
    loadPriceList(db).then(
      (loaded) => { if (!off) setState({ status: 'ready', loaded, reload }) },
      (e: unknown) => { if (!off) setState({ status: 'error', message: `Could not read the Price List: ${e instanceof Error ? e.message : String(e)}` }) }
    )
    return () => { off = true }
  }, [db, tick, reload])
  return state
}

export interface PriceSearchState { query: string; setQuery: (q: string) => void; active: boolean; results: ResolvedHit[] }

/** The search box state: results are the shared deterministic search over every tab, resolved to labelled rows. Empty until two letters are typed. */
export function usePriceSearch(data: PriceListData): PriceSearchState {
  const [query, setQuery] = useState('')
  const active = searchActive(query)
  const results = useMemo(() => (active ? resolveHits(data, searchAll(data, query)) : []), [data, query, active])
  return { query, setQuery, active, results }
}
