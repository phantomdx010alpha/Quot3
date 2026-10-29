/**
 * Phase 198 - the pure half of the `q3game://<gameId>/<path>` host (design rule 3). No Electron import here, so every rule is unit tested.
 * Serves files read-only from `<gamesRoot>/<gameId>/` and nothing else. The Electron glue is `gameProtocolElectron.ts`.
 */
import { promises as fs } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { GAME_ID_RE } from '../../shared/games/manifest'

export const GAME_SCHEME = 'q3game'
export const SELFTEST_ID = '_selftest'
const MAX_PATH = 300

/** Per-response CSP for a game page (design 3.3). `frameAncestors` is the app window's origin source (`file:` installed, the dev server origin in dev). No `unsafe-eval`. */
export function gameCsp(frameAncestors: string): string {
  return [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    `frame-ancestors ${frameAncestors}`
  ].join('; ')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif', '.cur': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mp4': 'video/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm', '.map': 'application/json', '.webmanifest': 'application/manifest+json'
}
export const mimeFor = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

export type Resolved = { ok: true; id: string; segments: string[] } | { ok: false; status: 400 | 404 }

/**
 * Splits a request URL into a game id and safe path segments. Refuses (never touches the disk): other schemes, a bad or unknown id, a query-less
 * trailing slash, `..` / `.` / empty segments, encoded slashes or dots (`%2f`, `%5c`, `%2e`), backslashes, NUL, drive letters, absolute paths.
 */
export function parseGameUrl(url: string, opts: { allowSelftest?: boolean } = {}): Resolved {
  if (typeof url !== 'string' || url.length > 2000) return { ok: false, status: 400 }
  const m = /^q3game:\/\/([^/?#]*)(\/[^?#]*)?(?:[?#].*)?$/i.exec(url)
  if (!m) return { ok: false, status: 400 }
  const id = (m[1] ?? '').toLowerCase()
  const okId = GAME_ID_RE.test(id) || (opts.allowSelftest === true && id === SELFTEST_ID)
  if (!okId) return { ok: false, status: 404 }
  const rawPath = m[2] ?? '/'
  if (rawPath.length > MAX_PATH || rawPath.endsWith('/')) return { ok: false, status: 404 }
  if (/%(2f|5c|2e|00)/i.test(rawPath) || rawPath.includes('\\') || rawPath.includes('\0')) return { ok: false, status: 400 }
  const segments: string[] = []
  for (const raw of rawPath.slice(1).split('/')) {
    let seg: string
    try { seg = decodeURIComponent(raw) } catch { return { ok: false, status: 400 } }
    if (seg === '' || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\') || seg.includes('\0') || seg.includes(':')) return { ok: false, status: 400 }
    segments.push(seg)
  }
  return { ok: true, id, segments }
}

export interface GameResponse {
  status: 200 | 206 | 400 | 404 | 405 | 416
  headers: Record<string, string>
  /** null for HEAD, errors and an empty body. */
  body: Buffer | null
}

export interface HandleDeps {
  gamesRoot: string
  frameAncestors: string
  allowSelftest?: boolean
}

const baseHeaders = (csp: string): Record<string, string> => ({
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-cache',
  'Cross-Origin-Resource-Policy': 'same-origin'
})
const err = (status: 400 | 404 | 405, csp: string): GameResponse => ({ status, headers: { ...baseHeaders(csp), 'Content-Type': 'text/plain; charset=utf-8', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) }, body: null })

/** One `bytes=a-b` range (audio / video seeking). Anything else is served whole. */
function parseRange(h: string | undefined, size: number): { start: number; end: number } | 'bad' | null {
  if (!h) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null
  let start: number, end: number
  if (m[1] === '') { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1 } else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1) }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'bad'
  return { start, end }
}

/** Read-only handler: GET / HEAD only, files strictly inside `<gamesRoot>/<id>/` (real paths compared, so a symlink that leaves the folder is refused). */
export async function handleGameRequest(req: { url: string; method?: string; range?: string }, deps: HandleDeps): Promise<GameResponse> {
  const csp = gameCsp(deps.frameAncestors)
  const method = (req.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return err(405, csp)
  const parsed = parseGameUrl(req.url, { allowSelftest: deps.allowSelftest === true })
  if (!parsed.ok) return err(parsed.status, csp)
  try {
    const gameDir = await fs.realpath(join(deps.gamesRoot, parsed.id))
    const wanted = join(gameDir, ...parsed.segments)
    const real = await fs.realpath(wanted)
    if (real !== gameDir && !real.startsWith(gameDir.endsWith(sep) ? gameDir : gameDir + sep)) return err(404, csp)
    const st = await fs.stat(real)
    if (!st.isFile()) return err(404, csp)
    const headers = { ...baseHeaders(csp), 'Content-Type': mimeFor(real), 'Accept-Ranges': 'bytes' }
    const range = parseRange(req.range, st.size)
    if (range === 'bad') return { status: 416, headers: { ...headers, 'Content-Range': `bytes */${st.size}` }, body: null }
    if (range) {
      const buf = method === 'HEAD' ? null : (await fs.readFile(real)).subarray(range.start, range.end + 1)
      return { status: 206, headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`, 'Content-Length': String(range.end - range.start + 1) }, body: buf }
    }
    return { status: 200, headers: { ...headers, 'Content-Length': String(st.size) }, body: method === 'HEAD' ? null : await fs.readFile(real) }
  } catch {
    return err(404, csp) // missing file, missing game, broken link: one answer, no detail
  }
}

const ALLOWED_GAME_SCHEMES = ['q3game:', 'data:', 'blob:']

/**
 * Belt and braces (design rule 3): a request that comes from a game page (its initiator or referrer is a `q3game:` origin) may only go to
 * `q3game:`, `data:` or `blob:`. Everything else is cancelled. Requests from the app itself are never touched.
 */
export function shouldCancelGameRequest(d: { url: string; initiator?: string | undefined; referrer?: string | undefined }): boolean {
  const fromGame = (d.initiator ?? '').toLowerCase().startsWith('q3game:') || (d.referrer ?? '').toLowerCase().startsWith('q3game:')
  if (!fromGame) return false
  let scheme: string
  try { scheme = new URL(d.url).protocol.toLowerCase() } catch { return true }
  return !ALLOWED_GAME_SCHEMES.includes(scheme)
}

/** The Alt+Left key that leaves a game even while the game frame has focus (design rule 8, [A]). Only a plain key-down of Alt+Left. */
export function isLeaveGameInput(i: { type: string; key: string; alt?: boolean; control?: boolean; shift?: boolean; meta?: boolean }): boolean {
  return i.type === 'keyDown' && i.key === 'ArrowLeft' && i.alt === true && !i.control && !i.shift && !i.meta
}
