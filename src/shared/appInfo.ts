// Phase 63 - one place for the app's identity: name, installer ID, publisher, version scheme, icon files.
// Pure (no electron / node / DOM). Phase 64 (electron-builder.yml) must use the same APP_ID / PUBLISHER values.

export const APP_NAME = 'Quot3'
/** Windows AppUserModelID and the electron-builder `appId`. Never change after the first release (it ties taskbar pins and updates together). */
export const APP_ID = 'app.quot3.desktop'
export const PUBLISHER = 'Quot3'
export const APP_TAGLINE = 'Quotations, made fast. Local-first and keyboard-first.'
export const APP_COPYRIGHT_OWNER = 'Quot3'
/**
 * Phase 90: the person shown as "Publisher" on the About screen. This is display text only; the installer publisher
 * (`PUBLISHER` above), `APP_ID` and the signing name are unchanged.
 * [A] The email is exactly as the owner typed it (it differs from the account email): confirm before release.
 */
export const PUBLISHER_NAME = 'Ankit Shukla'
export const PUBLISHER_EMAIL = 'phantomdx9@gmail.com'
export const publisherMailto = (): string => `mailto:${PUBLISHER_EMAIL}?subject=${encodeURIComponent(`${APP_NAME} feedback`)}`

/** Icon files under `resources/icons/` (all generated from the owner's artwork). */
export const ICON_FILES = {
  /** Multi-size Windows icon (16, 24, 32, 48, 64, 128, 256): window, taskbar, installer, uninstaller, shortcuts. */
  ico: 'icon.ico',
  /** 256 px PNG with a transparent background: the BrowserWindow icon fallback and the About screen. */
  png256: 'icon-256.png',
  /** 512 px PNG: store / release pages. */
  png512: 'icon-512.png'
} as const
export const ICO_SIZES: readonly number[] = [16, 24, 32, 48, 64, 128, 256]

/** Version scheme: plain semantic version `MAJOR.MINOR.PATCH`, optionally `-beta.N` for the beta channel (Phase 62). */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(beta)\.(\d+))?$/

export interface ParsedVersion { major: number; minor: number; patch: number; beta: number | null }

export function parseVersion(raw: unknown): ParsedVersion | null {
  if (typeof raw !== 'string') return null
  const m = VERSION_RE.exec(raw.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), beta: m[4] === 'beta' ? Number(m[5]) : null }
}

/** `1.2.0` -> "Version 1.2.0"; `1.2.0-beta.3` -> "Version 1.2.0 (beta 3)"; anything else is shown as given. */
export function formatVersion(raw: unknown): string {
  const v = parseVersion(raw)
  if (!v) return typeof raw === 'string' && raw.trim() !== '' ? `Version ${raw.trim()}` : 'Version unknown'
  const base = `${v.major}.${v.minor}.${v.patch}`
  return v.beta === null ? `Version ${base}` : `Version ${base} (beta ${v.beta})`
}

export const copyrightLine = (year: number): string => `© ${year} ${APP_COPYRIGHT_OWNER}. All rights reserved.`

/** First existing icon path from an ordered candidate list (packaged `resources` first, then the source tree). Pure: existence is injected. */
export function pickIconPath(candidates: readonly string[], exists: (p: string) => boolean): string | undefined {
  return candidates.find((p) => exists(p))
}
