/** Phase 198 - Electron glue for `q3game://` (not unit tested: needs a real Electron; see the Phase 198 log, standing gaps). */
import { protocol, session } from 'electron'
import { GAME_SCHEME, handleGameRequest, shouldCancelGameRequest } from './gameProtocol'

/** MUST run before `app.whenReady()`. standard + secure give each game its own origin (`q3game://<id>`) and its own localStorage. No bypassCSP, no CORS, no fetch API for the app. */
export function registerGameScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: GAME_SCHEME, privileges: { standard: true, secure: true, stream: true } }])
}

/** After `app.whenReady()`: serve the games folder read-only and cancel any request a game page makes outside q3game / data / blob. */
export function installGameHost(opts: { gamesRoot: string; frameAncestors: string; warn: (m: string, extra?: unknown) => void }): void {
  const ses = session.defaultSession
  ses.protocol.handle(GAME_SCHEME, async (request) => {
    const r = await handleGameRequest({ url: request.url, method: request.method, ...(request.headers.get('range') ? { range: request.headers.get('range') as string } : {}) }, { gamesRoot: opts.gamesRoot, frameAncestors: opts.frameAncestors })
    return new Response(r.body ? new Uint8Array(r.body) : null, { status: r.status, headers: r.headers })
  })
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (shouldCancelGameRequest({ url: details.url, initiator: details.referrer ? undefined : (details as { initiator?: string }).initiator, referrer: details.referrer })) {
      opts.warn('Blocked a request from a game', { scheme: details.url.split(':')[0] })
      callback({ cancel: true })
      return
    }
    callback({})
  })
}
