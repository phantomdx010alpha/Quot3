/**
 * Phase 62 - auto-updater rules (pure). Which feed to read, what state the update is in, when an install may start and what the
 * owner is told. No Electron, no Node, no DOM. The real `electron-updater` sits behind a port in `main/services/updateService.ts`.
 */
import { z } from 'zod'

/** Settings keys (defaults in `shared/settings.ts`). */
export const UPDATE_SETTING_KEYS = ['updates.auto', 'updates.channel', 'updates.feedUrl'] as const
export const UPDATE_FEED_MAX = 300
/** First background check this long after launch (the app settles first), then every `UPDATE_CHECK_INTERVAL_MS`. */
export const UPDATE_FIRST_CHECK_MS = 45_000
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateChannel = 'stable' | 'beta'
export const UPDATE_CHANNELS: readonly { value: UpdateChannel; label: string }[] = [
  { value: 'stable', label: 'Stable (recommended)' },
  { value: 'beta', label: 'Early access (beta)' }
]

/**
 * The built-in update address, hardcoded (0.1.4): the owner's public GitHub repo. Used whenever Settings > Updates > Update address
 * is empty, so a fresh install never needs the address typed in. If the repo is ever renamed or moved, change it here (installs that
 * have a value typed in Settings keep using that value).
 */
export const DEFAULT_GITHUB_FEED = { owner: 'phantomdx010alpha', repo: 'Quot3' } as const

/** Where updates come from. `builtin` = the hardcoded `DEFAULT_GITHUB_FEED` above (it used to be the `app-update.yml` electron-builder bakes in; same repo). */
export type FeedConfig =
  | { kind: 'builtin' }
  | { kind: 'github'; owner: string; repo: string }
  | { kind: 'generic'; url: string }

export type FeedParse = { ok: true; feed: FeedConfig } | { ok: false; message: string }

const GH_RE = /^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/

/**
 * `''` = built-in. `github:owner/repo` = GitHub Releases. `https://host/path` = a generic feed (a folder holding `latest.yml` and the
 * installer). Anything else is refused: plain http would let anyone on the network swap the installer, and a URL with a user name /
 * password would put a secret in the settings table and the log.
 */
export function parseFeed(raw: unknown): FeedParse {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (s === '') return { ok: true, feed: { kind: 'builtin' } }
  if (s.length > UPDATE_FEED_MAX) return { ok: false, message: 'The update address is too long.' }
  const gh = GH_RE.exec(s)
  if (gh) return { ok: true, feed: { kind: 'github', owner: gh[1]!, repo: gh[2]! } }
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, message: 'Use github:owner/repo or an https:// address.' } }
  if (u.protocol !== 'https:') return { ok: false, message: 'The update address must start with https://.' }
  if (u.username !== '' || u.password !== '') return { ok: false, message: 'The update address must not contain a user name or password.' }
  if (u.hostname === '') return { ok: false, message: 'The update address has no host name.' }
  u.hash = ''
  return { ok: true, feed: { kind: 'generic', url: u.toString() } }
}

export function parseChannel(raw: unknown): UpdateChannel {
  return raw === 'beta' ? 'beta' : 'stable'
}

/** electron-updater channel name (`latest.yml` for stable, `beta.yml` for beta). */
export function updaterChannelName(c: UpdateChannel): string {
  return c === 'beta' ? 'beta' : 'latest'
}

/** The option set handed to the port before every check. */
export interface UpdaterOptions {
  feed: FeedConfig
  channel: string
  allowPrerelease: boolean
  /** Never downgrade, never accept a lower version than the running one. */
  allowDowngrade: false
}
export function buildUpdaterOptions(feed: FeedConfig, channel: UpdateChannel): UpdaterOptions {
  return { feed, channel: updaterChannelName(channel), allowPrerelease: channel === 'beta', allowDowngrade: false }
}

export type UpdatePhase = 'unavailable' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  /** The version found / downloading / ready ('' = none). */
  version: string
  /** 0..100 while downloading. */
  percent: number
  /** A plain sentence for `error` and `unavailable`. */
  message: string
  /** ISO time of the last finished check ('' = never). */
  checkedAt: string
  channel: UpdateChannel
  auto: boolean
  feed: 'builtin' | 'github' | 'generic'
  /** The editor holds an unsaved bill: "Restart to update" waits (set by the renderer through `updates:setBusy`). */
  busy: boolean
}

export function initialUpdateState(currentVersion: string): UpdateState {
  return { phase: 'idle', currentVersion, version: '', percent: 0, message: '', checkedAt: '', channel: 'stable', auto: true, feed: 'builtin', busy: false }
}

/** Why an install request is refused, or `ok`. The install never starts while an unsaved bill is open. */
export type InstallGate = 'ok' | 'not-ready' | 'busy'
export function installGate(s: Pick<UpdateState, 'phase' | 'busy'>): InstallGate {
  if (s.phase !== 'ready') return 'not-ready'
  return s.busy ? 'busy' : 'ok'
}

export function clampPercent(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0
  return Math.min(100, Math.max(0, Math.round(v)))
}

/** The version string that came from a feed: digits, dots, a pre-release tag; anything else is shown as empty. */
export function cleanVersion(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/.test(s) ? s : ''
}

/** Strict `a.b.c` comparison (pre-release tags ignored); true when `candidate` is newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const n = (v: string): number[] => v.split(/[-+]/)[0]!.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const a = n(candidate)
  const b = n(current)
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export interface UpdateCopy {
  title: string
  detail: string
  /** The one button that makes sense now. */
  action: 'check' | 'restart' | 'none'
}

/** What Settings > Updates and the banner say. */
export function describeUpdate(s: UpdateState): UpdateCopy {
  switch (s.phase) {
    case 'unavailable':
      return { title: 'Updates are not available here', detail: s.message !== '' ? s.message : 'Updates are checked by the installed app.', action: 'none' }
    case 'checking':
      return { title: 'Checking for updates', detail: 'Looking for a newer version.', action: 'none' }
    case 'downloading':
      return { title: `Downloading version ${s.version}`, detail: `${s.percent}% done. You can keep working; nothing restarts by itself.`, action: 'none' }
    case 'ready':
      return s.busy
        ? { title: `Version ${s.version} is ready`, detail: 'It will be offered once the open bill is saved or closed. Nothing restarts by itself.', action: 'restart' }
        : { title: `Version ${s.version} is ready`, detail: 'Restart Quot3 to finish updating. Your bills and settings are kept.', action: 'restart' }
    case 'none':
      return { title: 'Quot3 is up to date', detail: `Version ${s.currentVersion} is the newest on this channel.`, action: 'check' }
    case 'error':
      return { title: 'Could not check for updates', detail: s.message !== '' ? s.message : 'Try again in a while.', action: 'check' }
    default:
      return { title: 'Check for updates', detail: `You are on version ${s.currentVersion}.`, action: 'check' }
  }
}

/** A short sentence for an updater failure; never the raw error (it may hold a URL with a token or a user folder). */
export function friendlyUpdateError(raw: unknown): string {
  const t = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').toLowerCase()
  if (/enotfound|econnrefused|econnreset|etimedout|enetunreach|net::err|network|offline|getaddrinfo/.test(t)) return 'No connection to the update server. Check the internet and try again.'
  if (/404|not found|cannot find|no published versions|latest\.yml/.test(t)) return 'No update information was found at the update address.'
  if (/sha512|checksum|signature|certificate|verif/.test(t)) return 'The downloaded update did not pass its safety check and was not installed.'
  if (/403|401|rate limit|unauthori[sz]ed|forbidden/.test(t)) return 'The update server refused the request.'
  return 'The update check did not finish. Try again in a while.'
}

export const setBusySchema = z.object({ busy: z.boolean() }).strict()
export const checkSchema = z.object({}).strict()
export type SetBusyInput = z.infer<typeof setBusySchema>
