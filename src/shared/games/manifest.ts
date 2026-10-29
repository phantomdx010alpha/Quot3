/** Games manifest contract (Milestone 19, Phase 197, API_CONTRACTS M19-1). Pure: no DOM, no Electron, no Node, no network. */

export const ALLOWED_LICENCES = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Apache-2.0', 'Unlicense', 'CC0-1.0'] as const
export type GameLicence = (typeof ALLOWED_LICENCES)[number]

export const GAME_TAGS = ['puzzle', 'arcade', 'card', 'board', 'shooter', 'word', 'retro', 'two-player', 'chess', 'relaxing'] as const
export type GameTag = (typeof GAME_TAGS)[number]

export interface GameEntry {
  id: string
  title: string
  tags: GameTag[]
  description: string
  /** Upstream repository URL. */
  source: string
  /** Upstream commit SHA the files were copied from. */
  commit: string
  licence: GameLicence
  author: string
  /** Relative html path inside resources/games/<id>/ (no '..', no leading '/'). */
  entry: string
  players: 1 | 2
  touch: boolean
  /** YYYY-MM-DD */
  added: string
}

export interface ManifestResult {
  games: GameEntry[]
  /** Entries that were dropped (invalid, disallowed licence, duplicate id). */
  skipped: number
  /** Plain-words reason for each skipped entry, and for a broken file. For logs and Settings, never fatal. */
  problems: string[]
}

export const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/
const SHA_RE = /^[0-9a-f]{7,40}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidGameId(id: unknown): id is string {
  return typeof id === 'string' && GAME_ID_RE.test(id) && !id.startsWith('_')
}

/** True when `p` is a relative path that stays inside its own game folder: no '..', no absolute path, no drive letter, no backslash, no NUL, no empty segment, no query/fragment. */
export function isSafeGamePath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || p.includes(':') || p.includes('?') || p.includes('#') || p.includes('%')) return false
  const segs = p.split('/')
  return segs.every((s) => s !== '' && s !== '.' && s !== '..')
}

/** `q3game://<id>/<entry>`; throws on an unsafe id or path so a bad value can never become a URL. */
export function gameUrl(id: string, entry: string): string {
  if (typeof id !== 'string' || !GAME_ID_RE.test(id)) throw new Error(`Unsafe game id: ${String(id)}`)
  if (!isSafeGamePath(entry)) throw new Error(`Unsafe game path: ${String(entry)}`)
  return `q3game://${id}/${entry}`
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null)

export type EntryCheck = { ok: true; entry: GameEntry } | { ok: false; error: string }

/** Validates one raw manifest entry. Never throws. */
export function validateGameEntry(raw: unknown): EntryCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'entry is not an object' }
  const r = raw as Record<string, unknown>
  if (!isValidGameId(r.id)) return { ok: false, error: `bad id: ${String(r.id)}` }
  const id = r.id
  const title = str(r.title, 80)
  if (!title) return { ok: false, error: `${id}: missing title` }
  const description = str(r.description, 400)
  if (!description) return { ok: false, error: `${id}: missing description` }
  const author = str(r.author, 120)
  if (!author) return { ok: false, error: `${id}: missing author` }
  const source = str(r.source, 300)
  if (!source || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(source)) return { ok: false, error: `${id}: source must be a GitHub repo URL` }
  if (typeof r.commit !== 'string' || !SHA_RE.test(r.commit)) return { ok: false, error: `${id}: commit must be a git SHA` }
  if (typeof r.licence !== 'string' || !(ALLOWED_LICENCES as readonly string[]).includes(r.licence)) return { ok: false, error: `${id}: licence not allowed: ${String(r.licence)}` }
  if (!isSafeGamePath(r.entry) || !/\.html?$/i.test(r.entry)) return { ok: false, error: `${id}: entry must be a relative .html path inside the game folder` }
  if (r.players !== 1 && r.players !== 2) return { ok: false, error: `${id}: players must be 1 or 2` }
  if (typeof r.touch !== 'boolean') return { ok: false, error: `${id}: touch must be true or false` }
  if (typeof r.added !== 'string' || !DATE_RE.test(r.added)) return { ok: false, error: `${id}: added must be YYYY-MM-DD` }
  if (!Array.isArray(r.tags) || r.tags.length === 0 || r.tags.length > 6) return { ok: false, error: `${id}: tags must be 1 to 6 known tags` }
  for (const t of r.tags) if (typeof t !== 'string' || !(GAME_TAGS as readonly string[]).includes(t)) return { ok: false, error: `${id}: unknown tag ${String(t)}` }
  if (new Set(r.tags).size !== r.tags.length) return { ok: false, error: `${id}: duplicate tag` }
  return {
    ok: true,
    entry: { id, title, tags: [...(r.tags as GameTag[])], description, source, commit: r.commit, licence: r.licence as GameLicence, author, entry: r.entry, players: r.players, touch: r.touch, added: r.added }
  }
}

/** Validates the whole manifest file content (already JSON-parsed). A broken entry is skipped and counted; a broken file gives an empty list. Never throws. */
export function validateManifest(raw: unknown): ManifestResult {
  const out: ManifestResult = { games: [], skipped: 0, problems: [] }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { out.problems.push('manifest is not an object'); return out }
  const m = raw as Record<string, unknown>
  if (m.version !== 1) { out.problems.push(`unsupported manifest version: ${String(m.version)}`); return out }
  if (!Array.isArray(m.games)) { out.problems.push('manifest.games is not a list'); return out }
  const seen = new Set<string>()
  for (const item of m.games) {
    const v = validateGameEntry(item)
    if (!v.ok) { out.skipped++; out.problems.push(v.error); continue }
    if (seen.has(v.entry.id)) { out.skipped++; out.problems.push(`${v.entry.id}: duplicate id`); continue }
    seen.add(v.entry.id)
    out.games.push(v.entry)
  }
  return out
}
