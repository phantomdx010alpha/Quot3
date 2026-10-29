import type { Quot3Bridge } from '@shared/ipc'
import { markPlayed, toggleFavourite as toggleFav, emptyGamesState, type GamesState } from '@shared/games/gamesState'
import type { GameEntry } from '@shared/games/manifest'
import { useGamesStore } from './gamesStore'

type Bridge = Pick<Quot3Bridge, 'games' | 'settings'>
const bridge = (): Partial<Bridge> | undefined => (window as unknown as { quot3?: Partial<Bridge> }).quot3
const msg = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong.')

/** Reads the on / off setting (default ON when it cannot be read). */
export async function loadGamesEnabled(): Promise<boolean> {
  try {
    const r = await bridge()?.settings?.get('games.enabled')
    const on = r?.ok ? r.data.value !== false : true
    useGamesStore.setState({ enabled: on })
    return on
  } catch { return useGamesStore.getState().enabled }
}

/** Loads the catalogue and the per-PC state. Plain-words error, never throws. */
export async function loadGames(): Promise<void> {
  const g = bridge()?.games
  if (!g) { useGamesStore.setState({ status: 'error', error: 'Games are not available in this window.' }); return }
  useGamesStore.setState({ status: 'loading', error: '' })
  try {
    const [list, st] = await Promise.all([g.list(), g.getState()])
    if (!list.ok) { useGamesStore.setState({ status: 'error', error: list.error.message }); return }
    useGamesStore.setState({ status: 'ready', games: list.data.games, skipped: list.data.skipped, state: st.ok ? st.data : emptyGamesState() })
  } catch (e) { useGamesStore.setState({ status: 'error', error: msg(e) }) }
}

/** Saves a new state; the screen shows it at once and the saved (pruned) copy replaces it. A refusal puts the old one back. */
async function saveState(next: GamesState): Promise<void> {
  const prev = useGamesStore.getState().state
  useGamesStore.setState({ state: next })
  try {
    const r = await bridge()?.games?.setState(next)
    if (r?.ok) useGamesStore.setState({ state: r.data })
    else if (r) useGamesStore.setState({ state: prev, error: r.error.message })
  } catch (e) { useGamesStore.setState({ state: prev, error: msg(e) }) }
}

export async function toggleFavourite(id: string): Promise<void> {
  await saveState(toggleFav(useGamesStore.getState().state, id))
}

/** Opens the player for a game and records it as played (last played + count). */
export async function openGame(game: GameEntry): Promise<void> {
  useGamesStore.setState({ playing: game, frameKey: useGamesStore.getState().frameKey + 1, error: '' })
  await saveState(markPlayed(useGamesStore.getState().state, game.id, new Date().toISOString()))
}

export function closeGame(): void {
  if (useGamesStore.getState().playing) useGamesStore.setState({ playing: null })
}

export function restartGame(): void {
  useGamesStore.setState({ frameKey: useGamesStore.getState().frameKey + 1 })
}

/** "Random game": asks the main process (it avoids the last played one) and opens it. Returns false when there is none. */
export async function openRandomGame(): Promise<boolean> {
  try {
    const r = await bridge()?.games?.pickRandom()
    if (r?.ok && r.data) { await openGame(r.data); return true }
    if (r && !r.ok) useGamesStore.setState({ error: r.error.message })
  } catch (e) { useGamesStore.setState({ error: msg(e) }) }
  return false
}

export async function clearGamesData(): Promise<void> {
  await saveState(emptyGamesState())
}

export async function setGamesEnabled(on: boolean): Promise<boolean> {
  try {
    const r = await bridge()?.settings?.set('games.enabled', on)
    if (r?.ok) { useGamesStore.setState({ enabled: on, ...(on ? {} : { playing: null }) }); return true }
    if (r) useGamesStore.setState({ error: r.error.message })
  } catch (e) { useGamesStore.setState({ error: msg(e) }) }
  return false
}
