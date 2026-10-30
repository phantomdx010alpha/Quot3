/** Games search, sort and random pick (Phase 197). Pure and deterministic given the same inputs and rng. */
import Fuse from 'fuse.js'
import type { GameEntry, GameTag } from './manifest'
import { emptyGamesState, type GamesState } from './gamesState'

export interface GameFilters {
  tags?: GameTag[]
  players?: 1 | 2
  onlyFavourites?: boolean
  onlyRecent?: boolean
}

/** Phase 205 (M20): keeps English games only, unless `showChinese` is true. Does not change the input. Search, sort, random pick and the tile all start from this list, so a hidden game can never be opened. */
export function filterByLanguage(list: readonly GameEntry[], showChinese: boolean): GameEntry[] {
  return showChinese ? [...list] : list.filter((g) => g.lang === 'en')
}

const byTitle = (a: GameEntry, b: GameEntry): number => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Favourites first, then most recently played, then A-Z by title. Does not change the input. */
export function sortGames(list: readonly GameEntry[], state: GamesState = emptyGamesState()): GameEntry[] {
  const fav = new Set(state.favourites)
  return [...list].sort((a, b) => {
    const fa = fav.has(a.id) ? 0 : 1
    const fb = fav.has(b.id) ? 0 : 1
    if (fa !== fb) return fa - fb
    const la = state.lastPlayed[a.id] ?? ''
    const lb = state.lastPlayed[b.id] ?? ''
    if (la !== lb) return la < lb ? 1 : -1
    return byTitle(a, b)
  })
}

function applyFilters(list: readonly GameEntry[], f: GameFilters, state: GamesState): GameEntry[] {
  const fav = new Set(state.favourites)
  return list.filter((g) => {
    if (f.tags?.length && !f.tags.every((t) => g.tags.includes(t))) return false
    if (f.players && g.players < f.players) return false
    if (f.onlyFavourites && !fav.has(g.id)) return false
    if (f.onlyRecent && !state.lastPlayed[g.id]) return false
    return true
  })
}

/** Typo-tolerant search over title, tags and description. An empty query returns the filtered list sorted by `sortGames`; a query returns best matches first (favourites break ties). */
export function searchGames(list: readonly GameEntry[], query: string, filters: GameFilters = {}, state: GamesState = emptyGamesState()): GameEntry[] {
  const pool = applyFilters(list, filters, state)
  const q = query.trim()
  if (q === '') return sortGames(pool, state)
  const fuse = new Fuse(pool, {
    keys: [{ name: 'title', weight: 3 }, { name: 'tags', weight: 2 }, { name: 'description', weight: 1 }],
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true
  })
  const fav = new Set(state.favourites)
  return fuse
    .search(q)
    .map((r) => ({ g: r.item, s: Math.round((r.score ?? 1) * 1000) }))
    .sort((a, b) => a.s - b.s || (fav.has(a.g.id) ? 0 : 1) - (fav.has(b.g.id) ? 0 : 1) || byTitle(a.g, b.g))
    .map((x) => x.g)
}

/** The id of the game opened most recently, or null. */
function lastPlayedId(state: GamesState): string | null {
  let best: string | null = null
  for (const [id, t] of Object.entries(state.lastPlayed)) if (best === null || t > state.lastPlayed[best]! || (t === state.lastPlayed[best] && id < best)) best = id
  return best
}

/** Random game for the "(?)" tile. Never repeats the last played game when more than one game exists. `rng` returns [0,1) (injectable for tests). */
export function pickRandom(list: readonly GameEntry[], state: GamesState = emptyGamesState(), rng: () => number = Math.random): GameEntry | null {
  if (list.length === 0) return null
  const last = lastPlayedId(state)
  const pool = list.length > 1 && last ? list.filter((g) => g.id !== last) : [...list]
  const pickFrom = pool.length > 0 ? pool : [...list]
  const r = rng()
  const i = Math.min(pickFrom.length - 1, Math.max(0, Math.floor(Number.isFinite(r) ? r * pickFrom.length : 0)))
  return pickFrom[i]!
}
