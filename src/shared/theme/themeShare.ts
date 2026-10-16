import { canonicalJson } from '../sync/canonicalJson'
import { sha256Hex } from '../sync/codecV2'
import { validateTheme } from './validateTheme'
import { BUILTIN_THEME_IDS } from './tokens'

/**
 * Phase 171 - theme sharing, the pure part (Milestone 16). A theme is DATA: nothing here evaluates a theme; a received theme is run through
 * `validateTheme` exactly like a file dropped in the folder. Server rules: `supabase/sql/17_themes.sql` (contract in API_CONTRACTS.md, Phase 170).
 * No theme contents ever go into a log line: only ids and counts.
 */

/** Setting key of the switch "Share my themes with the other PCs" (OFF by default [A]). */
export const THEME_SHARE_KEY = 'themes.share'
export const THEME_SHARE_DEFAULT = false
/** Same cap as the SQL file (64 KB per theme [A]). */
export const THEME_SHARE_MAX_BYTES = 64 * 1024
/** The newest theme `min_reader_ver` this build can read: 1 = a v1 file, 2 = a schema-2 file (Themes 2.0). */
export const THEME_READER_VER = 2
export const THEME_PUSH_BATCH = 20
export const THEME_PULL_PAGE = 50
/** Previous versions of a local file that a received theme replaced are kept this many per theme (`themes/history/`). */
export const THEME_LOCAL_HISTORY_KEEP = 5

/** `sync_state` keys. All under `shared.`, so signing out of the shared notebook removes them with the rest. */
export const THEME_STATE_KEYS = {
  cursor: 'shared.themes.cursor',
  /** + theme id: what this PC last exchanged with the server for that theme (JSON `ThemeShareState`). */
  state: 'shared.themes.state.',
  /** + theme id: a received theme that was not applied (JSON `ThemeAside`). */
  aside: 'shared.themes.aside.',
  /** + theme id: the owner removed the shared theme on this PC (JSON `ThemeRemoved`). */
  removed: 'shared.themes.removed.',
  /** Last run summary (JSON `ThemeShareLast`). */
  last: 'shared.themes.last'
} as const

export const THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export interface ThemeShareState { hash: string; version: number; editedAt: string; serverSeq: number; origin: string | null }
export interface ThemeRemoved { version: number; hash: string }
/** `io` = the file could not be written on this PC; it is retried like `too_new`. */
export type AsideReason = 'invalid' | 'too_new' | 'too_big' | 'io'
export interface ThemeAside {
  reason: AsideReason
  message: string
  version: number
  minReaderVer: number
  editedAt: string
  origin: string | null
  /** Kept only for `too_new` and `io`, so the theme can be applied later without rewinding the cursor. */
  payload?: Record<string, unknown>
  payloadHash: string
}
export interface ThemeShareLast { at: string; sent: number; received: number; setAside: number; error: string | null }

/** 1 for a v1 file, 2 for a schema-2 file. */
export const minReaderFor = (theme: Record<string, unknown>): number => (theme.schema === 2 ? 2 : 1)

/** Hash of the theme CONTENT (canonical JSON), the same on every PC regardless of key order or whitespace. */
export const themeContentHash = (theme: Record<string, unknown>): string => sha256Hex(canonicalJson(theme))

export const themeByteSize = (theme: unknown): number => new TextEncoder().encode(JSON.stringify(theme)).length

export interface IncomingTheme {
  themeId: string
  version: number
  payload: Record<string, unknown>
  payloadHash: string
  minReaderVer: number
  editedAt: string
  origin: string | null
}
export interface LocalThemeInfo { hash: string; editedAtMs: number }

export type IncomingDecision =
  | { action: 'skip'; why: 'same' | 'removed' | 'local_newer' }
  | { action: 'aside'; reason: AsideReason; message: string }
  | { action: 'write'; replacesLocal: boolean }

/**
 * What to do with one pulled theme. Order: nothing to do (same content / removed here / our own newer unsent edit) -> too new for this app
 * -> too big -> invalid (the same `validateTheme` as a local file; the id inside must equal the server's id) -> write.
 * `local` is the custom theme file with that id on THIS PC, with its edit time already skew-corrected; `state` is what we last exchanged.
 */
export function decideIncoming(input: { item: IncomingTheme; state: ThemeShareState | null; removed: ThemeRemoved | null; local: LocalThemeInfo | null }): IncomingDecision {
  const { item, state, removed, local } = input
  if (state && state.hash === item.payloadHash) return { action: 'skip', why: 'same' }
  if (local && local.hash === item.payloadHash) return { action: 'skip', why: 'same' }
  if (removed && (item.version <= removed.version || removed.hash === item.payloadHash)) return { action: 'skip', why: 'removed' }
  if (item.minReaderVer > THEME_READER_VER) return { action: 'aside', reason: 'too_new', message: 'Update the app to use this theme.' }
  if (themeByteSize(item.payload) > THEME_SHARE_MAX_BYTES) return { action: 'aside', reason: 'too_big', message: `Larger than ${THEME_SHARE_MAX_BYTES / 1024} KB.` }
  if (!THEME_ID_RE.test(item.themeId) || (BUILTIN_THEME_IDS as readonly string[]).includes(item.themeId)) return { action: 'aside', reason: 'invalid', message: 'The theme id is not allowed.' }
  const v = validateTheme(item.payload)
  if (!v.ok) return { action: 'aside', reason: 'invalid', message: v.errors.slice(0, 3).join('; ').slice(0, 200) }
  if (v.theme.id !== item.themeId) return { action: 'aside', reason: 'invalid', message: 'The id inside the theme does not match.' }
  if (themeContentHash(item.payload) !== item.payloadHash) return { action: 'aside', reason: 'invalid', message: 'The theme did not match its checksum.' }
  if (local) {
    const incoming = Date.parse(item.editedAt)
    const localIsUnsent = !state || state.hash !== local.hash
    // Our own unsent edit that is newer (or equal) stays; the push decides on the server (the older version is kept in history there).
    if (localIsUnsent && Number.isFinite(incoming) && local.editedAtMs >= incoming) return { action: 'skip', why: 'local_newer' }
    return { action: 'write', replacesLocal: true }
  }
  return { action: 'write', replacesLocal: false }
}

export interface PushCandidate { id: string; json: Record<string, unknown>; hash: string; editedAtMs: number }
export interface PlannedPush { items: { themeId: string; payload: Record<string, unknown>; payloadHash: string; schemaVer: number; minReaderVer: number; editedAt: string }[]; tooBig: string[] }

/** Local custom themes that changed since they were last exchanged. Built-ins never reach here. Oversize themes are reported by id, not sent. */
export function planPush(candidates: readonly PushCandidate[], states: ReadonlyMap<string, ThemeShareState>, offsetMs: number | null): PlannedPush {
  const items: PlannedPush['items'] = []
  const tooBig: string[] = []
  for (const c of candidates) {
    const st = states.get(c.id)
    if (st && st.hash === c.hash) continue
    if (themeByteSize(c.json) > THEME_SHARE_MAX_BYTES) { tooBig.push(c.id); continue }
    items.push({
      themeId: c.id, payload: c.json, payloadHash: c.hash, schemaVer: c.json.schema === 2 ? 2 : 1, minReaderVer: minReaderFor(c.json),
      editedAt: new Date(c.editedAtMs + (offsetMs ?? 0)).toISOString()
    })
  }
  return { items, tooBig }
}

export const chunk = <T,>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** The text of the "needs a newer app" notice, or '' when none. */
export const tooNewNotice = (count: number): string => (count <= 0 ? '' : `Update the app to use ${count} ${count === 1 ? 'theme' : 'themes'}.`)

export interface SharedThemeRow { id: string; name: string; origin: string | null; editedAt: string }
export interface ThemeAsideRow { id: string; reason: AsideReason; message: string; origin: string | null }
/** What `themes:shareStatus` returns. Ids, names and counts only: never theme contents. */
export interface ThemeShareStatus {
  enabled: boolean
  /** This PC is signed in to the shared notebook (sharing needs it). */
  available: boolean
  shared: SharedThemeRow[]
  aside: ThemeAsideRow[]
  tooNew: number
  notice: string
  last: ThemeShareLast | null
  running: boolean
}
export interface ThemeShareRunResult { sent: number; received: number; setAside: number; skipped: number }
