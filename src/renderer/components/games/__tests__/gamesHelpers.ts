import { vi } from 'vitest'
import type { GameEntry } from '@shared/games/manifest'
import { emptyGamesState, type GamesState } from '@shared/games/gamesState'

export const game = (id: string, title: string, extra: Partial<GameEntry> = {}): GameEntry => ({
  id, title, tags: ['puzzle'], description: `${title} synthetic`, source: 'https://example.invalid/repo', commit: 'abcdef1234567890', licence: 'MIT', author: 'Test Author',
  entry: 'index.html', players: 1, touch: false, added: '2026-10-29', ...extra
})

export interface FakeApi {
  games: Record<string, ReturnType<typeof vi.fn>>
  settings: Record<string, ReturnType<typeof vi.fn>>
  on: ReturnType<typeof vi.fn>
  listeners: Record<string, (p: unknown) => void>
  state: GamesState
  enabled: boolean
}

/** A fake `window.quot3` with the games + settings parts only. */
export function installApi(games: GameEntry[], opts: { skipped?: number; enabled?: boolean; state?: GamesState } = {}): FakeApi {
  const listeners: Record<string, (p: unknown) => void> = {}
  const api: FakeApi = {
    state: opts.state ?? emptyGamesState(),
    enabled: opts.enabled ?? true,
    listeners,
    games: {},
    settings: {},
    on: vi.fn((c: string, cb: (p: unknown) => void) => { listeners[c] = cb; return () => { delete listeners[c] } })
  }
  api.games = {
    list: vi.fn(async () => ({ ok: true, data: { games, skipped: opts.skipped ?? 0 } })),
    getState: vi.fn(async () => ({ ok: true, data: api.state })),
    setState: vi.fn(async (s: GamesState) => { api.state = s; return { ok: true, data: s } }),
    pickRandom: vi.fn(async () => ({ ok: true, data: games[0] ?? null })),
    getCredits: vi.fn(async () => ({ ok: true, data: games.map((g) => ({ id: g.id, title: g.title, author: g.author, source: g.source, licence: g.licence, commit: g.commit })) })),
    getLicense: vi.fn(async (id: string) => ({ ok: true, data: { text: `LICENSE TEXT for ${id}` } }))
  }
  api.settings = {
    get: vi.fn(async () => ({ ok: true, data: { value: api.enabled } })),
    set: vi.fn(async (_k: string, v: unknown) => { api.enabled = v as boolean; return { ok: true, data: {} } })
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { games: api.games, settings: api.settings, on: api.on }
  return api
}
