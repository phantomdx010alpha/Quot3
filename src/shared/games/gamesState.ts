/** Per-PC games state (setting `games.state`, Phase 197). Pure. Garbage in gives an empty state, never an exception. */
import { isValidGameId } from './manifest'

export interface GamesState {
  favourites: string[]
  /** gameId -> ISO timestamp of the last time it was opened. */
  lastPlayed: Record<string, string>
  plays: Record<string, number>
}

export const GAMES_STATE_CAP = 500
const MAX_PLAYS = 1_000_000

export const emptyGamesState = (): GamesState => ({ favourites: [], lastPlayed: {}, plays: {} })

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Keeps the newest `cap` ids of a lastPlayed map (ties by id so the result is deterministic). */
function capByRecency(last: Record<string, string>, plays: Record<string, number>, cap: number): void {
  const ids = Object.keys(last)
  if (ids.length <= cap) return
  ids.sort((a, b) => (last[a]! < last[b]! ? 1 : last[a]! > last[b]! ? -1 : a < b ? -1 : 1))
  for (const id of ids.slice(cap)) { delete last[id]; delete plays[id] }
}

/** Parses a stored value (JSON string or object). Invalid parts are dropped; every list is capped at 500. */
export function parseGamesState(raw: unknown): GamesState {
  let v: unknown = raw
  if (typeof raw === 'string') { try { v = JSON.parse(raw) } catch { return emptyGamesState() } }
  if (!isRec(v)) return emptyGamesState()
  const s = emptyGamesState()
  if (Array.isArray(v.favourites)) {
    for (const id of v.favourites) {
      if (s.favourites.length >= GAMES_STATE_CAP) break
      if (isValidGameId(id) && !s.favourites.includes(id)) s.favourites.push(id)
    }
  }
  if (isRec(v.lastPlayed)) {
    for (const [id, t] of Object.entries(v.lastPlayed)) {
      if (isValidGameId(id) && typeof t === 'string' && t.length <= 40 && !Number.isNaN(Date.parse(t))) s.lastPlayed[id] = t
    }
  }
  if (isRec(v.plays)) {
    for (const [id, n] of Object.entries(v.plays)) {
      if (isValidGameId(id) && typeof n === 'number' && Number.isInteger(n) && n > 0) s.plays[id] = Math.min(n, MAX_PLAYS)
    }
  }
  capByRecency(s.lastPlayed, s.plays, GAMES_STATE_CAP)
  const extra = Object.keys(s.plays).filter((id) => !(id in s.lastPlayed))
  if (extra.length > GAMES_STATE_CAP) for (const id of extra.slice(GAMES_STATE_CAP)) delete s.plays[id]
  return s
}

/** Drops favourites, history and counts for games that are no longer in the catalogue. */
export function pruneGamesState(state: GamesState, knownIds: Iterable<string>): GamesState {
  const known = new Set(knownIds)
  const keep = <T,>(m: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(m).filter(([id]) => known.has(id)))
  return { favourites: state.favourites.filter((id) => known.has(id)), lastPlayed: keep(state.lastPlayed), plays: keep(state.plays) }
}

/** Returns a new state with `id` opened at `nowIso` (plays + 1). */
export function markPlayed(state: GamesState, id: string, nowIso: string): GamesState {
  if (!isValidGameId(id)) return state
  const next: GamesState = { favourites: [...state.favourites], lastPlayed: { ...state.lastPlayed, [id]: nowIso }, plays: { ...state.plays, [id]: Math.min((state.plays[id] ?? 0) + 1, MAX_PLAYS) } }
  capByRecency(next.lastPlayed, next.plays, GAMES_STATE_CAP)
  return next
}

export function toggleFavourite(state: GamesState, id: string): GamesState {
  if (!isValidGameId(id)) return state
  if (state.favourites.includes(id)) return { ...state, favourites: state.favourites.filter((f) => f !== id) }
  if (state.favourites.length >= GAMES_STATE_CAP) return state
  return { ...state, favourites: [...state.favourites, id] }
}

export const serializeGamesState = (s: GamesState): string => JSON.stringify(s)
