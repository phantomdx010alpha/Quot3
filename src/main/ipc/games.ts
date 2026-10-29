import { z } from 'zod'
import type { GameCatalog } from '../games/gameCatalog'
import { GAME_ID_RE, type GameEntry } from '../../shared/games/manifest'
import { parseGamesState, pruneGamesState, serializeGamesState, type GamesState } from '../../shared/games/gamesState'
import { pickRandom } from '../../shared/games/search'
import { AppError, wrapHandler } from './envelope'

const empty = z.object({}).strict()
const idInput = z.object({ id: z.string().regex(GAME_ID_RE) }).strict()
const MAX = 500
const stateInput = z
  .object({
    favourites: z.array(z.string().max(60)).max(MAX),
    lastPlayed: z.record(z.string().max(60), z.string().max(40)).refine((r) => Object.keys(r).length <= MAX, 'too many entries'),
    plays: z.record(z.string().max(60), z.number()).refine((r) => Object.keys(r).length <= MAX, 'too many entries')
  })
  .strict()

export interface GamesPorts {
  catalog: GameCatalog
  /** The stored `games.state` value (any shape) and its writer. */
  readState(): unknown
  writeState(json: string): void
  rng?: () => number
}

/** `games:*` handlers (design 4.2). IPC calls the catalog and the settings port only. Nothing here touches bills, the database schema or the network. */
export function gamesHandlers(p: GamesPorts): Record<string, (raw: unknown) => Promise<unknown>> {
  const state = (): GamesState => pruneGamesState(parseGamesState(p.readState()), p.catalog.list().games.map((g) => g.id))
  return {
    'games:list': wrapHandler(empty, () => { const r = p.catalog.list(); return { games: r.games, skipped: r.skipped } }),
    'games:getState': wrapHandler(empty, () => state()),
    'games:setState': wrapHandler(stateInput, (i) => {
      // Re-sanitised and pruned on the way in, so a hostile or stale renderer cannot store junk.
      const clean = pruneGamesState(parseGamesState(i), p.catalog.list().games.map((g) => g.id))
      p.writeState(serializeGamesState(clean))
      return clean
    }),
    'games:pickRandom': wrapHandler(empty, (): GameEntry | null => pickRandom(p.catalog.list().games, state(), p.rng)),
    'games:getCredits': wrapHandler(empty, () => p.catalog.credits()),
    'games:getLicense': wrapHandler(idInput, ({ id }) => {
      const text = p.catalog.license(id)
      if (text === null) throw new AppError('NOT_FOUND', 'That game has no licence text here.')
      return { text }
    })
  }
}
