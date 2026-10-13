import { pathToFileURL } from 'node:url'

/** The strict production CSP from SECURITY_MODEL.md (+ form-action). */
export const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Dev only: Vite's React-refresh preamble is inline and HMR uses a websocket. */
export const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

export function buildCsp(dev: boolean): string {
  return dev ? DEV_CSP : PROD_CSP
}

export interface TrustConfig {
  /** Vite dev server URL (ELECTRON_RENDERER_URL), dev only. */
  devUrl?: string | undefined
  /** Absolute path of the packaged renderer directory (…/out/renderer). */
  rendererDir: string
}

/** True only for pages our own renderer is served from. Everything else is untrusted. */
export function isTrustedUrl(url: string, cfg: TrustConfig): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (cfg.devUrl) {
    try {
      if (parsed.origin === new URL(cfg.devUrl).origin) return true
    } catch {
      /* fall through */
    }
  }
  if (parsed.protocol === 'file:') {
    const base = pathToFileURL(cfg.rendererDir).href.replace(/\/?$/, '/')
    return parsed.href.startsWith(base)
  }
  return false
}
