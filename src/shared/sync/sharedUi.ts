import { validatePoPrefix } from '../settings/appSettings'
import {
  checkPrefixForServer, validateAnonKey, validateBranchName, validateEmail, validateLicenseKey, validateSeatPassword, validateSupabaseUrl,
  type ActivateInputV2, type SharedErrorKind, type SharedLicenseStatus
} from './license'

/**
 * Phase 139 - Settings > Sync v2 (SYNC_SHARED_STORE_SPEC sections 3, 5, 11). Pure: the form rules, the way a server refusal is
 * routed to the field it is about, the "is this name free?" state words and the bridge the renderer talks to. No Electron, Node or DOM.
 * There is no passphrase anywhere in this file or in the screen it feeds.
 */

export type SharedFormField = 'supabaseUrl' | 'anonKey' | 'licenseKey' | 'email' | 'password' | 'branchName' | 'poPrefix'

export interface SharedForm {
  supabaseUrl: string
  anonKey: string
  licenseKey: string
  email: string
  password: string
  branchName: string
  poPrefix: string
  device: string
  takeover: boolean
}
export const EMPTY_SHARED_FORM: SharedForm = { supabaseUrl: '', anonKey: '', licenseKey: '', email: '', password: '', branchName: '', poPrefix: '', device: '', takeover: false }

export type FieldErrors = Partial<Record<SharedFormField, string>>
export type FormCheck = { ok: true; input: ActivateInputV2 } | { ok: false; errors: FieldErrors }

/** Validates the whole form the same way main will; the first message per field only. `device` is optional (label of this computer). */
export function validateSharedForm(f: SharedForm): FormCheck {
  const errors: FieldErrors = {}
  const take = <T>(field: SharedFormField, c: { ok: true; value: T } | { ok: false; message: string }): T | undefined => {
    if (c.ok) return c.value
    errors[field] = c.message
    return undefined
  }
  const supabaseUrl = take('supabaseUrl', validateSupabaseUrl(f.supabaseUrl))
  const anonKey = take('anonKey', validateAnonKey(f.anonKey))
  const licenseKey = take('licenseKey', validateLicenseKey(f.licenseKey))
  const email = take('email', validateEmail(f.email))
  const password = take('password', validateSeatPassword(f.password))
  const branchName = take('branchName', validateBranchName(f.branchName))
  const local = validatePoPrefix(f.poPrefix, [])
  let poPrefix: string | undefined
  if (!local.ok) errors.poPrefix = local.message
  else poPrefix = take('poPrefix', checkPrefixForServer(local.prefix))
  if (supabaseUrl === undefined || anonKey === undefined || licenseKey === undefined || email === undefined || password === undefined || branchName === undefined || poPrefix === undefined) return { ok: false, errors }
  const device = f.device.trim()
  return { ok: true, input: { supabaseUrl, anonKey, licenseKey, email, password, branchName, poPrefix, ...(device !== '' ? { device } : {}), ...(f.takeover ? { takeover: true } : {}) } }
}

/** What the "name free?" check shows next to the field. */
export type NameState = 'idle' | 'checking' | 'free' | 'taken' | 'unknown'
export const NAME_CHECK_DEBOUNCE_MS = 400

/** The key the server compares names by: trimmed, inner spaces collapsed, case-insensitive. */
export const branchNameKey = (raw: string): string => raw.trim().replace(/\s+/g, ' ').toLowerCase()

export function nameStateText(s: NameState): string {
  switch (s) {
    case 'checking': return 'Checking the name.'
    case 'free': return 'This name is free.'
    case 'taken': return 'Another branch already uses this name.'
    case 'unknown': return 'Could not check the name now. It is checked again when you sign in.'
    default: return ''
  }
}

/** What a failed call from the bridge carries. `kind` is the transport failure kind when there is one. */
export interface SharedUiError { code: string; message: string; kind?: SharedErrorKind }
export type SharedUiResult<T> = { ok: true; data: T } | { ok: false; error: SharedUiError }

export interface RoutedError {
  /** The field the message is about (the form puts it under that field), if any. */
  field?: SharedFormField
  message: string
  /** `seat_in_use`: show the "Take over this login" prompt. */
  askTakeover: boolean
  /** The server is paused (not the same as offline). */
  paused: boolean
}

/** Routes one server refusal to the field it is about. Unknown kinds keep the message main wrote (already plain words, never a secret). */
export function routeSharedError(e: SharedUiError): RoutedError {
  const base = { message: e.message, askTakeover: false, paused: false }
  switch (e.kind) {
    case 'name_taken': return { ...base, field: 'branchName' }
    case 'prefix_taken': return { ...base, field: 'poPrefix' }
    case 'seat_in_use': return { ...base, askTakeover: true }
    case 'auth_failed': case 'not_member': return { ...base, field: 'password' }
    case 'license': return { ...base, field: 'licenseKey' }
    case 'anon_key': return { ...base, field: 'anonKey' }
    case 'invalid_input': return { ...base, field: 'branchName' }
    case 'server_paused': return { ...base, paused: true }
    default:
      return e.code === 'SERVER_PAUSED' ? { ...base, paused: true } : e.code === 'AUTH_FAILED' ? { ...base, field: 'password' } : base
  }
}

/** One row of the branch list (this computer's own row is `isThis`). */
export interface BranchRowUi { branchId: string; name: string; poPrefix: string; deviceName: string; lastSeenAt: string | null; isThis: boolean }

/** Pure: the list as the table shows it (this computer first, then by name). */
export function sortBranches(rows: readonly BranchRowUi[]): BranchRowUi[] {
  return [...rows].sort((a, b) => (a.isThis === b.isThis ? a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) : a.isThis ? -1 : 1))
}

export interface CompareOutcome { state: 'done' | 'paused'; upload: number; download: number; conflict: number; skip: number }
export function compareSentence(r: CompareOutcome): string {
  if (r.state === 'paused') return 'The comparison stopped part-way (connection or server). Run it again; it carries on where it stopped.'
  const n = r.upload + r.download + r.conflict
  if (n === 0) return `Both sides already match (${r.skip} records the same).`
  return `Compared with the notebook: ${r.upload} to send, ${r.download} to fetch${r.conflict > 0 ? `, ${r.conflict} different on both sides (the latest edit wins and the other version is kept)` : ''}.`
}

/** What the renderer may call. Phase 140 backs it with IPC channels; every method answers an envelope and never carries a secret back. */
export interface SharedSyncBridge {
  status(opts?: { check?: boolean }): Promise<SharedUiResult<SharedLicenseStatus>>
  activate(input: ActivateInputV2): Promise<SharedUiResult<SharedLicenseStatus>>
  deactivate(input: { confirm: string }): Promise<SharedUiResult<SharedLicenseStatus>>
  /** Before activation `signIn` carries the typed details (main signs in once for the check); after it main uses the stored login. */
  branchNameFree(input: { name: string; signIn?: Pick<ActivateInputV2, 'supabaseUrl' | 'anonKey' | 'licenseKey' | 'email' | 'password'> }): Promise<SharedUiResult<{ free: boolean }>>
  renameBranch(input: { name: string }): Promise<SharedUiResult<SharedLicenseStatus>>
  listBranches(): Promise<SharedUiResult<BranchRowUi[]>>
  compare(): Promise<SharedUiResult<CompareOutcome>>
}

/** Words for the status block beside the overview (pure; the panel only prints them). */
export interface StatusLine { label: string; value: string; tone: 'ok' | 'wait' | 'bad' | 'off' }
export function sharedConnectionLine(o: { activated: boolean; enabled: boolean; serverPaused: boolean; signedOut: boolean; mode: string; deliveryText: string }): StatusLine {
  if (!o.activated) return { label: 'Connection', value: 'Not signed in', tone: 'off' }
  if (o.signedOut) return { label: 'Connection', value: 'Signed out', tone: 'bad' }
  if (!o.enabled) return { label: 'Connection', value: 'Switched off here', tone: 'off' }
  if (o.serverPaused) return { label: 'Connection', value: 'Sync server paused', tone: 'bad' }
  if (o.mode === 'offline') return { label: 'Connection', value: 'Offline', tone: 'wait' }
  return { label: 'Connection', value: o.deliveryText, tone: o.deliveryText === 'Live' ? 'ok' : 'wait' }
}
