import { RELEASES_API_URL, RELEASES_RESPONSE_MAX_BYTES } from '../../shared/rollback'

/**
 * 0.1.5 - the GitHub "list releases" call for Settings > Updates > Choose app version. Public repo, no token, no cookies; only the
 * request itself leaves the PC (no bill data, no settings). Main process only. Rejects with a short technical message (the service
 * turns it into a plain sentence); a 403 is GitHub's 60-per-hour limit.
 */
export function createGithubReleaseFeed(): { fetch(): Promise<unknown> } {
  return {
    async fetch() {
      const res = await fetch(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Quot3-desktop', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      if (text.length > RELEASES_RESPONSE_MAX_BYTES) throw new Error('release list too large')
      return JSON.parse(text) as unknown
    }
  }
}
