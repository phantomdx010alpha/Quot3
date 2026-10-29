/** Phase 198 - reads and validates `<gamesRoot>/manifest.json`. A bad entry is skipped and counted; a missing or broken file is an empty list. Never throws. */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { validateManifest, type GameEntry } from '../../shared/games/manifest'

export interface GameCredit { id: string; title: string; author: string; source: string; licence: string; commit: string }
export interface CatalogResult { games: GameEntry[]; skipped: number; problems: string[] }

export interface GameCatalog {
  list(): CatalogResult
  get(id: string): GameEntry | null
  credits(): GameCredit[]
  /** Full LICENSE text of a listed game (max 64 KB), or null. */
  license(id: string): string | null
  reload(): CatalogResult
}

const MAX_LICENSE = 64 * 1024

export function createGameCatalog(deps: { gamesRoot: string; warn?: (msg: string, extra?: unknown) => void }): GameCatalog {
  let cache: CatalogResult | null = null
  const load = (): CatalogResult => {
    const file = join(deps.gamesRoot, 'manifest.json')
    let raw: unknown
    try { raw = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
      const missing = !existsSync(file)
      if (!missing) deps.warn?.('Games manifest could not be read', { err: e instanceof Error ? e.message : String(e) })
      return { games: [], skipped: 0, problems: missing ? [] : ['manifest.json could not be read'] }
    }
    const v = validateManifest(raw)
    const games: GameEntry[] = []
    let skipped = v.skipped
    const problems = [...v.problems]
    for (const g of v.games) {
      // The files must really be there: an entry whose folder, entry page or LICENSE is missing is skipped (never shown, never crashes).
      const ok = isFile(join(deps.gamesRoot, g.id, ...g.entry.split('/'))) && isFile(join(deps.gamesRoot, g.id, 'LICENSE'))
      if (ok) games.push(g)
      else { skipped++; problems.push(`${g.id}: entry page or LICENSE file is missing`) }
    }
    if (problems.length) deps.warn?.('Games manifest problems', { skipped, problems: problems.slice(0, 10) })
    return { games, skipped, problems }
  }
  const list = (): CatalogResult => (cache ??= load())
  return {
    list,
    reload: () => (cache = load()),
    get: (id) => list().games.find((g) => g.id === id) ?? null,
    credits: () => list().games.map((g) => ({ id: g.id, title: g.title, author: g.author, source: g.source, licence: g.licence, commit: g.commit })),
    license(id) {
      if (!list().games.some((g) => g.id === id)) return null
      try {
        const p = join(deps.gamesRoot, id, 'LICENSE')
        if (statSync(p).size > MAX_LICENSE) return null
        return readFileSync(p, 'utf8')
      } catch { return null }
    }
  }
}

function isFile(p: string): boolean { try { return statSync(p).isFile() } catch { return false } }
