import type { DashHttp } from './dashboardLiveService'

/** The real network port for the dashboard (Node fetch in the main process). GET only, no cookies / credentials, no redirects off-host, size cap. */
export function createFetchDashHttp(fetchImpl: typeof fetch = fetch): DashHttp {
  return {
    async getJson(url, timeoutMs) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)
      try {
        const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctl.signal, credentials: 'omit', redirect: 'error' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (text.length > 512 * 1024) throw new Error('Response too large')
        return JSON.parse(text) as unknown
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
