/**
 * 0.1.5 - "choose app version" (rollback), pure rules. Which GitHub releases may be offered, whether the owner's data can be read
 * by an older build, and the one update address a chosen version is downloaded from. No Electron, no Node, no DOM.
 *
 * Data safety (the reason this file exists): the database stores `PRAGMA user_version` = number of migrations of the app that last
 * migrated it. An app that finds a NEWER number opens the file read-only, so bills cannot be saved. A release therefore declares its
 * own number in its notes (`schema: N`, written by `.github/workflows/release.yml`), and `rollbackDecision` refuses to go to a release
 * whose number is lower than the database's.
 */
import { z } from 'zod'
import { cleanVersion, DEFAULT_GITHUB_FEED, type UpdateChannel } from './updater'

/** Public, unauthenticated: 60 requests per hour per IP, so the list is cached (`ROLLBACK_LIST_TTL_MS`). */
export const RELEASES_API_URL = `https://api.github.com/repos/${DEFAULT_GITHUB_FEED.owner}/${DEFAULT_GITHUB_FEED.repo}/releases?per_page=100`
/** Every release keeps its own `latest.yml` and installer under `<base>/v<version>/`. */
export const RELEASE_DOWNLOAD_BASE = `https://github.com/${DEFAULT_GITHUB_FEED.owner}/${DEFAULT_GITHUB_FEED.repo}/releases/download/`
export const ROLLBACK_LIST_TTL_MS = 5 * 60 * 1000
export const RELEASES_RESPONSE_MAX_BYTES = 4 * 1024 * 1024

/**
 * Releases from before the `schema: N` line existed. 0.1.2 to 0.1.4 all shipped the 8 migrations 0000..0007.
 * Older than 0.1.2 is never offered: those builds cannot update themselves (GITHUB_UPDATE_PUSH.md section 4), so going back to one
 * would strand the PC. A release newer than 0.1.4 without the line is "unknown" and is blocked, never guessed.
 */
export const LEGACY_SCHEMA = 8
export const LEGACY_SCHEMA_LAST_VERSION = '0.1.4'
export const MIN_ROLLBACK_VERSION = '0.1.2'

/** `schema: 8` on a line of its own in the release notes. */
const SCHEMA_LINE = /^[ \t]*schema:[ \t]*(\d{1,3})[ \t]*\r?$/im

export function parseSchemaLine(body: unknown): number | null {
  if (typeof body !== 'string') return null
  const m = SCHEMA_LINE.exec(body)
  return m ? Number.parseInt(m[1]!, 10) : null
}

/** `v0.1.4` or `0.1.4` -> `0.1.4`; anything that is not a clean version -> ''. */
export function versionFromTag(tag: unknown): string {
  const s = typeof tag === 'string' ? tag.trim() : ''
  return cleanVersion(s.startsWith('v') ? s.slice(1) : s)
}

const triple = (v: string): number[] => v.split(/[-+]/)[0]!.split('.').map((x) => Number.parseInt(x, 10) || 0)
const preOf = (v: string): string => (/^[^-+]*-([^+]*)/.exec(v)?.[1] ?? '')

/** Full ordering: 1.2.3 > 1.2.3-beta.2 > 1.2.3-beta.1 > 1.2.2. (Used for sorting; `isNewer` in updater.ts ignores pre-release tags.) */
export function compareVersions(a: string, b: string): number {
  const x = triple(a)
  const y = triple(b)
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  const pa = preOf(a)
  const pb = preOf(b)
  if (pa === pb) return 0
  if (pa === '') return 1
  if (pb === '') return -1
  const ia = pa.split('.')
  const ib = pb.split('.')
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const s = ia[i]
    const t = ib[i]
    if (s === undefined) return -1
    if (t === undefined) return 1
    const ns = /^\d+$/.test(s) ? Number.parseInt(s, 10) : null
    const nt = /^\d+$/.test(t) ? Number.parseInt(t, 10) : null
    if (ns !== null && nt !== null) { if (ns !== nt) return ns > nt ? 1 : -1 } else if (ns !== null) return -1
    else if (nt !== null) return 1
    else if (s !== t) return s > t ? 1 : -1
  }
  return 0
}

export const isPrereleaseVersion = (v: string): boolean => preOf(v) !== ''

/** electron-builder names the update file after the version's pre-release tag: `latest.yml`, `beta.yml`, ... */
export function releaseChannelOf(version: string): string {
  const id = /^([A-Za-z]+)/.exec(preOf(version))?.[1]
  return id ? id.toLowerCase() : 'latest'
}
export const channelFileOf = (version: string): string => `${releaseChannelOf(version)}.yml`
export const installerNameOf = (version: string): string => `Quot3-Setup-${version}.exe`

/** One release the owner could go to. */
export interface RollbackRelease {
  version: string
  /** Number of migrations that build ships; null = the release does not say (and is not one of the known early ones). */
  schema: number | null
  prerelease: boolean
  /** ISO date-time the release was published ('' = unknown). */
  publishedAt: string
}

const assetSchema = z.object({ name: z.string(), state: z.string().optional() }).passthrough()
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  assets: z.array(assetSchema).default([])
}).passthrough()

/**
 * Turns the GitHub "list releases" answer into the versions that can really be installed. A release is listed only when it is
 * published (not a draft), has BOTH its update file and `Quot3-Setup-<version>.exe` fully uploaded, and is 0.1.2 or newer.
 * Pre-releases are listed only on the beta channel. Newest first. Anything unreadable is skipped, never thrown.
 */
export function parseReleaseList(json: unknown, channel: UpdateChannel): RollbackRelease[] {
  if (!Array.isArray(json)) return []
  const seen = new Set<string>()
  const out: RollbackRelease[] = []
  for (const raw of json) {
    const p = releaseSchema.safeParse(raw)
    if (!p.success) continue
    const r = p.data
    if (r.draft === true) continue
    const version = versionFromTag(r.tag_name)
    if (version === '' || seen.has(version)) continue
    const prerelease = r.prerelease === true || isPrereleaseVersion(version)
    if (prerelease && channel !== 'beta') continue
    if (compareVersions(version, MIN_ROLLBACK_VERSION) < 0) continue
    const ready = new Set(r.assets.filter((a) => a.state === undefined || a.state === 'uploaded').map((a) => a.name))
    if (!ready.has(channelFileOf(version)) || !ready.has(installerNameOf(version))) continue
    seen.add(version)
    const stated = parseSchemaLine(r.body)
    const schema = stated ?? (compareVersions(version, LEGACY_SCHEMA_LAST_VERSION) <= 0 ? LEGACY_SCHEMA : null)
    const when = typeof r.published_at === 'string' && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at : ''
    out.push({ version, schema, prerelease, publishedAt: when })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

export type RollbackBlock = 'same' | 'not-listed' | 'schema-unknown' | 'schema-older'
export type RollbackVerdict = { ok: true } | { ok: false; reason: RollbackBlock; message: string }

/**
 * May the owner move from `currentVersion` (database format `dbSchema`) to `target`? Blocked when the target would open the database
 * read-only (its schema is lower than the database's) or when its schema is not known.
 */
export function rollbackDecision(input: { target: RollbackRelease | undefined; currentVersion: string; dbSchema: number }): RollbackVerdict {
  const { target, currentVersion, dbSchema } = input
  if (!target) return { ok: false, reason: 'not-listed', message: 'That version is not in the list. Refresh the list and try again.' }
  if (target.version === currentVersion) return { ok: false, reason: 'same', message: 'You are already on this version.' }
  if (target.schema === null) {
    return { ok: false, reason: 'schema-unknown', message: `Quot3 cannot tell whether version ${target.version} can read your bills, so it is not allowed.` }
  }
  if (target.schema < dbSchema) {
    return {
      ok: false, reason: 'schema-older',
      message: `Your bills were saved in a newer format than version ${target.version} understands. Going back would leave Quot3 unable to save bills, so it is blocked. Pick a newer version.`
    }
  }
  return { ok: true }
}

/** A list row for Settings: the release plus whether it may be chosen and, if not, why. */
export interface RollbackEntry extends RollbackRelease {
  current: boolean
  allowed: boolean
  /** '' when allowed. */
  why: string
}

export function buildEntries(releases: readonly RollbackRelease[], currentVersion: string, dbSchema: number): RollbackEntry[] {
  return releases.map((r) => {
    const v = rollbackDecision({ target: r, currentVersion, dbSchema })
    return { ...r, current: r.version === currentVersion, allowed: v.ok, why: v.ok ? '' : v.reason === 'same' ? '' : v.message }
  })
}

/** The answer to "which versions can I go to" (`updates:listVersions`). `fetchedAt` is when GitHub was asked (cached for a few minutes). */
export interface VersionList { entries: RollbackEntry[]; currentVersion: string; pinned: string; fetchedAt: string }

/** What the version picker sends: a version string only (the address is built in main, never taken from the renderer). */
export const chooseVersionSchema = z.object({ version: z.string().min(1).max(60) }).strict()
export const listVersionsSchema = z.object({ refresh: z.boolean().optional() }).strict()

/**
 * The update address for ONE release. Built only from a version that passed `cleanVersion`, so no raw text ever reaches the URL.
 * electron-updater reads `<url>latest.yml` (or the channel's file) from it, which carries that release's sha512.
 */
export function rollbackFeedUrl(version: string): string {
  const v = cleanVersion(version)
  if (v === '' || v !== version) throw new Error('Not a version')
  return `${RELEASE_DOWNLOAD_BASE}v${v}/`
}

/** Options for the rollback flow ONLY. The normal flow keeps `UpdaterOptions.allowDowngrade: false`. */
export interface RollbackOptions {
  feed: { kind: 'generic'; url: string }
  channel: string
  allowPrerelease: boolean
  allowDowngrade: true
}
export function buildRollbackOptions(version: string): RollbackOptions {
  return { feed: { kind: 'generic', url: rollbackFeedUrl(version) }, channel: releaseChannelOf(version), allowPrerelease: isPrereleaseVersion(version), allowDowngrade: true }
}

/** The confirm dialog text. */
export function rollbackConfirmText(currentVersion: string, targetVersion: string): string {
  return `This replaces ${currentVersion} with ${targetVersion}. Your bills are kept. A backup is made first.`
}

/** A short sentence for a failed release-list request; never the raw error. */
export function friendlyReleaseListError(raw: unknown): string {
  const t = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').toLowerCase()
  if (/enotfound|econnrefused|econnreset|etimedout|enetunreach|net::err|network|offline|getaddrinfo|fetch failed|abort|timeout/.test(t)) {
    return 'No connection to GitHub. Check the internet and try again.'
  }
  if (/403|429|rate limit|forbidden/.test(t)) return 'GitHub is limiting requests right now. Try again in about an hour.'
  if (/404|not found/.test(t)) return 'The list of versions was not found.'
  return 'The list of versions could not be loaded. Try again in a while.'
}
