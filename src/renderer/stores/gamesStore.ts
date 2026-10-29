import { create } from 'zustand'
import { emptyGamesState, type GamesState } from '@shared/games/gamesState'
import type { GameEntry } from '@shared/games/manifest'

/**
 * Phase 202 (M19) - Games page state. Selector rule (Phase 92): read the raw fields; derive lists with useMemo in the component.
 * `enabled` mirrors the setting `games.enabled` (default ON until it is read). `playing` is the game open in the player (the
 * Dashboard "(?)" tile of Phase 203 sets it and then opens the Games page).
 */
export interface GamesStoreState {
  enabled: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  games: GameEntry[]
  skipped: number
  state: GamesState
  playing: GameEntry | null
  /** Bumped by Restart so the frame is created again. */
  frameKey: number
}

export const useGamesStore = create<GamesStoreState>(() => ({
  enabled: true,
  status: 'idle',
  error: '',
  games: [],
  skipped: 0,
  state: emptyGamesState(),
  playing: null,
  frameKey: 0
}))
