/**
 * Phase 52 - pure rules for license activation: key / passphrase / URL checks, the status shape shared by main and the
 * renderer, and the plain-words messages for every way activation can fail. No Electron / Node / DOM.
 */

/** Same pattern the server enforces in `qt_auth` (supabase/sql/04_rpcs.sql). */
export const LICENSE_KEY_RE = /^Q3-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/
export const PASSPHRASE_MIN = 8
export const PASSPHRASE_MAX = 128
export const ANON_KEY_MAX = 2048
export const DEACTIVATE_WORD = 'DEACTIVATE'
/** Server rule for a PO prefix (`qt_register_branch`). */
export const SERVER_PREFIX_RE = /^[A-Z0-9_/-]{1,8}$/

/** Upper-case, trim, drop inner spaces (a key is often pasted with a trailing newline or spaces). */
export const normalizeLicenseKey = (raw: string): string => raw.replace(/\s+/g, '').toUpperCase()
export const isLicenseKey = (raw: string): boolean => LICENSE_KEY_RE.test(normalizeLicenseKey(raw))

/** `Q3-ABCD-****-****`: enough for the owner to recognise the key, never the whole secret. */
export function maskLicenseKey(key: string): string {
  const k = normalizeLicenseKey(key)
  return LICENSE_KEY_RE.test(k) ? `${k.slice(0, 7)}-****-****` : '****'
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

/** The project URL as typed: https only (http only for localhost in development). Returns the origin without a trailing slash. */
export function validateSupabaseUrl(raw: string): Checked<string> {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Enter the Supabase project URL, for example https://abcd1234.supabase.co.' }
  let u: URL
  try { u = new URL(text) } catch { return { ok: false, message: 'That does not look like a web address. Copy the Project URL from Supabase.' } }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { ok: false, message: 'The address must start with https://.' }
  if (u.username !== '' || u.password !== '') return { ok: false, message: 'The address must not contain a user name or password.' }
  return { ok: true, value: u.origin }
}

/** The anon (public) key is a long JWT-like token. Reject obvious mistakes, do not try to parse it. */
export function validateAnonKey(raw: string): Checked<string> {
  const key = raw.trim()
  if (key === '') return { ok: false, message: 'Enter the anon (public) key from Supabase > Project settings > API.' }
  if (key.length > ANON_KEY_MAX || /\s/.test(key)) return { ok: false, message: 'That key does not look right. Copy the anon (public) key as one line.' }
  if (/service_role/i.test(key)) return { ok: false, message: 'Do not use a service_role key here. Use the anon (public) key only.' }
  if (key.split('.').length === 3) {
    // A JWT: refuse a service_role token by its role claim (the claim is not secret, only the key is).
    try {
      const body = key.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')
      const json = atob(body.padEnd(Math.ceil(body.length / 4) * 4, '='))
      const role = (JSON.parse(json) as { role?: unknown }).role
      if (role === 'service_role') return { ok: false, message: 'That is a service_role key. Quot3 must only ever hold the anon (public) key.' }
    } catch { /* not a decodable JWT: let the server decide */ }
  }
  return { ok: true, value: key }
}

export function validateLicenseKey(raw: string): Checked<string> {
  const key = normalizeLicenseKey(raw)
  if (key === '') return { ok: false, message: 'Enter the license key, like Q3-ABCD-EFGH-JKLM.' }
  if (!LICENSE_KEY_RE.test(key)) return { ok: false, message: 'A license key looks like Q3-ABCD-EFGH-JKLM (letters A-Z and digits 2-7).' }
  return { ok: true, value: key }
}

export function validatePassphrase(raw: string): Checked<string> {
  if (raw.length < PASSPHRASE_MIN) return { ok: false, message: `The organisation passphrase needs at least ${PASSPHRASE_MIN} characters.` }
  if (raw.length > PASSPHRASE_MAX) return { ok: false, message: `The organisation passphrase can be at most ${PASSPHRASE_MAX} characters.` }
  if (raw !== raw.trim()) return { ok: false, message: 'The passphrase must not start or end with a space.' }
  return { ok: true, value: raw }
}

/** The PO prefix as the server will see it (the local rule already allows the same alphabet; the server also caps at 8). */
export function checkPrefixForServer(prefix: string): Checked<string> {
  const p = prefix.trim().toUpperCase()
  return SERVER_PREFIX_RE.test(p) ? { ok: true, value: p } : { ok: false, message: 'This branch\'s PO prefix cannot be registered (letters, digits and - _ / only, up to 8). Change it in Settings > Branch and PO prefix first.' }
}

export interface RegisteredBranch { branchId: string; name: string; poPrefix: string }

/** Where the last contact with the server stands. `unchecked` = never tried since activation. */
export type LinkState = 'unchecked' | 'ok' | 'offline' | 'license_problem' | 'server_problem'

export interface LicenseStatus {
  /** `activated` once `qt_register_branch` succeeded and the secrets were stored. */
  state: 'not_activated' | 'activated'
  /** The OS cannot protect secrets (safeStorage unavailable): activation is refused. */
  secretsAvailable: boolean
  readOnly: boolean
  /** Host of the Supabase project ('' when not activated). */
  host: string
  licenseHint: string
  orgId: string
  /** The local branch as the server knows it (what was registered). */
  registered: { branchId: string; name: string; poPrefix: string } | null
  /** This branch's current local name and prefix (null when no branch row). */
  local: { branchId: string; name: string; poPrefix: string } | null
  /** False when the local PO prefix was changed after registering (the server still has the old one). */
  prefixInSync: boolean
  branches: RegisteredBranch[]
  passphraseSaved: boolean
  activatedAt: string
  link: { state: LinkState; at: string; message: string }
}

export interface ActivateInput { supabaseUrl: string; anonKey: string; licenseKey: string; passphrase: string }

/** Plain-words text for each transport failure kind (see `TransportErrorKind` in main/sync/transport.ts). */
export const TRANSPORT_MESSAGES = {
  license: 'That license key was not accepted. Check the key, or ask the owner whether the license is suspended.',
  unknown_branch: 'This branch is not registered for that license. Activate it again.',
  branch_limit: 'This license has no free branch seat left. Ask the owner to raise the limit, or use another license.',
  prefix_taken: 'Another branch already uses this PO prefix. Change the prefix in Settings > Branch and PO prefix, then activate again.',
  branch_conflict: 'This branch id is already registered under a different organisation. Reset local data to start a new branch.',
  invalid_input: 'The server refused the details sent. Check the branch name and PO prefix.',
  too_large: 'The server refused a message as too large.',
  too_many: 'The server refused a message with too many items.',
  anon_key: 'The Supabase address or anon key was not accepted. Check both and try again.',
  not_installed: 'The Supabase project has no Quot3 sync functions yet. Run the SQL files in supabase/sql first.',
  offline: 'Could not reach Supabase. Check the internet connection and try again.',
  timeout: 'Supabase did not answer in time. Try again in a moment.',
  server: 'Supabase reported a problem. Try again in a moment.'
} as const
export type TransportErrorKind = keyof typeof TRANSPORT_MESSAGES

/** `LinkState` a failure kind leaves behind. */
export function linkStateFor(kind: TransportErrorKind): LinkState {
  if (kind === 'license' || kind === 'unknown_branch') return 'license_problem'
  if (kind === 'offline' || kind === 'timeout') return 'offline'
  return 'server_problem'
}

// ---------------------------------------------------------------------------------------------------------------------
// Phase 132 - shared-notebook sync (Milestone 12): sign-in (e-mail + password per seat), no passphrase, no client-side encryption.
// Everything below is pure. The v1 section above stays until Phase 142 removes it.
// ---------------------------------------------------------------------------------------------------------------------

export const EMAIL_MAX = 254
export const SEAT_PASSWORD_MAX = 256
export const BRANCH_NAME_MAX = 80

/** Only checks the shape; whether the login exists is the server's answer. */
export function validateEmail(raw: string): Checked<string> {
  const email = raw.trim().toLowerCase()
  if (email === '') return { ok: false, message: 'Enter the e-mail address of this computer\'s login (given when the license was created).' }
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'That does not look like an e-mail address.' }
  return { ok: true, value: email }
}

/** The seat password is generated by the server; it is kept exactly as typed (no trimming), only an empty or huge value is refused. */
export function validateSeatPassword(raw: string): Checked<string> {
  if (raw === '') return { ok: false, message: 'Enter the password of this computer\'s login.' }
  if (raw.length > SEAT_PASSWORD_MAX) return { ok: false, message: 'That password is too long.' }
  return { ok: true, value: raw }
}

/** The branch name as the server will store it: trimmed, inner spaces collapsed; 1-80 characters. */
export function validateBranchName(raw: string): Checked<string> {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '') return { ok: false, message: 'Enter a name for this branch, for example Main shop.' }
  if (name.length > BRANCH_NAME_MAX) return { ok: false, message: `The branch name can be at most ${BRANCH_NAME_MAX} characters.` }
  return { ok: true, value: name }
}

/** `j***@example.com`: enough to recognise the login, never the whole address. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return '****'
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

/** Plain-words text for every way the shared-notebook transport can fail (kinds are the SharedTransportError kinds). */
export const SHARED_MESSAGES = {
  auth_failed: 'The e-mail or password for this computer was not accepted. Check them, or ask the owner to reset this seat.',
  license: 'That license key was not accepted. Check the key, or ask the owner whether the license is suspended.',
  not_member: 'This login does not belong to a Quot3 organisation. Ask the owner to attach or re-create the seat.',
  unknown_branch: 'This computer is not the branch registered for its login. Activate it again.',
  name_taken: 'Another branch already uses this name. Choose a different branch name.',
  seat_in_use: 'This login is already used by another installation. If this is a reinstall of the same computer, tick "Take over this login" and activate again.',
  prefix_taken: 'Another branch already uses this PO prefix. Change the prefix in Settings > Branch and PO prefix, then activate again.',
  branch_conflict: 'This branch id is already registered to a different login. Reset local data to start a new branch.',
  invalid_input: 'The server refused the details sent. Check the branch name and PO prefix.',
  too_large: 'The server refused a record as too large.',
  too_many: 'The server refused a message with too many items.',
  anon_key: 'The Supabase address or anon key was not accepted. Check both and try again.',
  not_installed: 'The Supabase project has no Quot3 shared-notebook functions yet. Run the SQL files in supabase/sql first.',
  server_paused: 'The sync server is paused or not answering (a free Supabase project pauses after about a week without use). Ask the owner to restore it in the Supabase dashboard.',
  offline: 'Could not reach Supabase. Check the internet connection and try again.',
  timeout: 'Supabase did not answer in time. Try again in a moment.',
  server: 'Supabase reported a problem. Try again in a moment.'
} as const
export type SharedErrorKind = keyof typeof SHARED_MESSAGES

/** SQLSTATE codes raised by supabase/sql/15_rpcs.sql (v2). */
export const SHARED_SQLSTATE_KIND: Readonly<Record<string, SharedErrorKind>> = {
  Q3L01: 'license', Q3A01: 'not_member', Q3M01: 'unknown_branch', Q3B02: 'prefix_taken', Q3B03: 'branch_conflict', Q3B04: 'name_taken',
  Q3B05: 'seat_in_use', Q3I01: 'invalid_input', Q3I03: 'too_many', Q3R01: 'too_large'
}

/** What a failed HTTP / auth / network call looked like, before it is turned into a kind. Only these fields are read; message text is never logged. */
export interface SharedFailure {
  status?: number
  /** SQLSTATE (`Q3L01`, `PGRST202`, ...) or a Supabase auth error code (`invalid_credentials`, ...). */
  code?: string
  message?: string
  /** The call came from an auth endpoint (sign-in / refresh). */
  auth?: boolean
  timeout?: boolean
  /** No answer at all (DNS, refused, offline). */
  network?: boolean
}

/** Turns a failure into a kind. SERVER_PAUSED is kept apart from offline [A]: HTTP 540 or a "paused" answer from the project. */
export function classifySharedFailure(f: SharedFailure): SharedErrorKind {
  const msg = (f.message ?? '').toLowerCase()
  if (f.code !== undefined && Object.prototype.hasOwnProperty.call(SHARED_SQLSTATE_KIND, f.code)) return SHARED_SQLSTATE_KIND[f.code]!
  if (f.timeout === true) return 'timeout'
  if (/invalid api key|no api key/.test(msg)) return 'anon_key'
  if (f.status === 540 || (/paused|restor/.test(msg) && (f.status === undefined || f.status >= 500))) return 'server_paused'
  if (f.network === true) return 'offline'
  if (f.auth === true || f.status === 401 || f.status === 403 || /jwt expired|invalid jwt|invalid login credentials|invalid_credentials|user_banned|refresh token/.test(msg) ||
      (f.code !== undefined && /^(invalid_credentials|user_banned|user_not_found|invalid_grant|bad_jwt|refresh_token_not_found|refresh_token_already_used|session_not_found)$/.test(f.code))) {
    if (f.status !== undefined && f.status >= 500 && f.auth === true) return 'server'
    return 'auth_failed'
  }
  if (f.code === 'PGRST202' || f.code === '42883' || f.status === 404) return 'not_installed'
  return 'server'
}

/** The IPC error code the renderer sees for a kind (`VALIDATION` for the ones the owner fixes by changing an input). */
export function sharedKindToErrorCode(kind: SharedErrorKind): 'AUTH_FAILED' | 'LICENSE_INVALID' | 'SERVER_PAUSED' | 'SYNC_OFFLINE' | 'VALIDATION' {
  switch (kind) {
    case 'auth_failed': case 'not_member': return 'AUTH_FAILED'
    case 'license': case 'unknown_branch': return 'LICENSE_INVALID'
    case 'server_paused': return 'SERVER_PAUSED'
    case 'offline': case 'timeout': case 'server': return 'SYNC_OFFLINE'
    default: return 'VALIDATION'
  }
}

/** `LinkState` a shared-notebook failure leaves behind (`server_problem` also covers a paused server; the message tells them apart). */
export function sharedLinkStateFor(kind: SharedErrorKind): LinkState {
  if (kind === 'license' || kind === 'unknown_branch' || kind === 'auth_failed' || kind === 'not_member') return 'license_problem'
  if (kind === 'offline' || kind === 'timeout') return 'offline'
  return 'server_problem'
}

export interface ActivateInputV2 {
  supabaseUrl: string
  anonKey: string
  licenseKey: string
  email: string
  password: string
  branchName: string
  poPrefix: string
  device?: string
  takeover?: boolean
}

/** What the renderer may know about the shared-notebook link. Masked hints only: never the key, password, anon key or tokens. */
export interface SharedLicenseStatus {
  state: 'not_activated' | 'activated'
  secretsAvailable: boolean
  readOnly: boolean
  host: string
  licenseHint: string
  emailHint: string
  orgId: string
  seatNo: number | null
  registered: { branchId: string; name: string; poPrefix: string } | null
  branches: RegisteredBranch[]
  activatedAt: string
  link: { state: LinkState; at: string; message: string }
}
