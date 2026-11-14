/**
 * Phase 270 - the company profile model (API_CONTRACTS.md M24-P). Pure: no Electron / Node / DOM, no new dependency.
 *
 * Three layers, first match wins, per field:
 *   1. this device's OVERRIDE (the person edited the field on this PC and the flag `company.override.<field>` is true) -> the local value
 *   2. the company default downloaded from the master (`company.master`, stored on this PC)                       -> the master value
 *   3. no master default on this PC (not linked, or nothing downloaded yet)                                      -> the local value, exactly as before 0.1.57
 * `company.profile` (the local record the print code reads today) is never rewritten by a master update; Phase 271 switches the readers to
 * `effectiveProfile`. Text limits and the logo rule are the master's (`schemas.ts`): text <= 200 characters, logo = PNG <= 150 KB.
 */
import { LOGO_MAX_BYTES, PROFILE_TEXT_MAX, base64DecodedLength, type ProfileView } from './schemas'
import { sniffImage, type CompanyProfile } from '../settings/appSettings'

export const PROFILE_FIELDS = ['name', 'phone', 'address', 'logo'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]
export type ProfileOverrides = Record<ProfileField, boolean>

/** The company default as kept on THIS PC. The logo is a file name in the assets folder (a 150 KB base64 value would not fit one settings row). */
export interface StoredMasterProfile { version: number; name: string; phone: string; address: string; logoFile: string }

export const MASTER_PROFILE_KEY = 'company.master'
export const MASTER_LOGO_FILE = 'company-logo-master.png'
export const NO_OVERRIDES: Readonly<ProfileOverrides> = Object.freeze({ name: false, phone: false, address: false, logo: false })

/** `company.override.<field>`. */
export const overrideKey = (field: ProfileField): string => `company.override.${field}`

/** Defaults for `SETTING_DEFAULTS` (shared/settings.ts). */
export const COMPANY_MASTER_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  [MASTER_PROFILE_KEY]: null,
  'company.override.name': false,
  'company.override.phone': false,
  'company.override.address': false,
  'company.override.logo': false
})

/** What the Settings screen needs to know about the master (carried in `AppSettingsState.companyMaster`). Never a token or a secret. */
export interface CompanyMasterView {
  linked: boolean
  isAdmin: boolean
  /** Version of the default stored on this PC; null = none downloaded yet. */
  version: number | null
  /** The stored default, for display ("Company default: ..."). Null = none. */
  default: { name: string; phone: string; address: string; logoDataUrl: string } | null
  overrides: ProfileOverrides
  /** Plain words of the last problem publishing to the master ('' = none). */
  notice: string
}

export function readOverrides(all: Record<string, unknown>): ProfileOverrides {
  return {
    name: all[overrideKey('name')] === true,
    phone: all[overrideKey('phone')] === true,
    address: all[overrideKey('address')] === true,
    logo: all[overrideKey('logo')] === true
  }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Tolerant read of the stored default (a corrupt or missing row = none). */
export function readStoredMaster(v: unknown): StoredMasterProfile | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const version = o['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return null
  const logoFile = typeof o['logoFile'] === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(o['logoFile']) ? o['logoFile'] : ''
  return { version, name: str(o['name'], PROFILE_TEXT_MAX), phone: str(o['phone'], PROFILE_TEXT_MAX), address: str(o['address'], PROFILE_TEXT_MAX), logoFile }
}

/** The master's profile as stored on this PC (`logoFile` = the file the caller wrote, '' = no logo). */
export function storedFromView(p: ProfileView, logoFile: string): StoredMasterProfile {
  return { version: p.version, name: p.name, phone: p.phone, address: p.address, logoFile: p.logo === null ? '' : logoFile }
}

export interface EffectiveProfile extends CompanyProfile {
  /** Where each field came from. */
  sources: Record<ProfileField, 'local' | 'master'>
}

/**
 * The profile this PC uses. `master` null = exactly the local record (nothing changes for a company that is not linked).
 * The logo is the FILE NAME of the chosen image ('' = no logo); the caller turns it into bytes / a data URL.
 */
export function effectiveProfile(master: StoredMasterProfile | null, local: CompanyProfile, overrides: ProfileOverrides): EffectiveProfile {
  if (master === null) return { ...local, sources: { name: 'local', phone: 'local', address: 'local', logo: 'local' } }
  const pick = <T>(field: ProfileField, l: T, m: T): [T, 'local' | 'master'] => (overrides[field] ? [l, 'local'] : [m, 'master'])
  const [name, sn] = pick('name', local.name, master.name)
  const [phone, sp] = pick('phone', local.phone, master.phone)
  const [address, sa] = pick('address', local.address, master.address)
  const [logo, sl] = pick('logo', local.logo, master.logoFile)
  return { name, phone, address, logo, sources: { name: sn, phone: sp, address: sa, logo: sl } }
}

export interface ProfileLike { name: string; phone: string; address: string; logo: string | null }

/** The fields whose value differs between two profiles (`logo` compared as given: a base64 text, a file name, or null). */
export function diffProfile(a: ProfileLike, b: ProfileLike): ProfileField[] {
  const out: ProfileField[] = []
  if (a.name !== b.name) out.push('name')
  if (a.phone !== b.phone) out.push('phone')
  if (a.address !== b.address) out.push('address')
  if ((a.logo ?? '') !== (b.logo ?? '')) out.push('logo')
  return out
}

/**
 * A local edit of name / phone / address on a PC that has a company default: a field that differs from the default gets its override flag,
 * a field the person set back to the default value drops it (an override that equals the default is pointless) [A].
 * Returns only the flags that change.
 */
export function overridesAfterEdit(master: StoredMasterProfile, edited: { name: string; phone: string; address: string }, current: ProfileOverrides): Partial<ProfileOverrides> {
  const changed = new Set(diffProfile({ ...edited, logo: null }, { name: master.name, phone: master.phone, address: master.address, logo: null }))
  const out: Partial<ProfileOverrides> = {}
  for (const f of ['name', 'phone', 'address'] as const) {
    const want = changed.has(f)
    if (current[f] !== want) out[f] = want
  }
  return out
}

// ---- size limits and the logo rule ----------------------------------------------------------------------------------------
export type ProfileSizeCheck = { ok: true } | { ok: false; field: ProfileField; message: string }

/** The master's limits for what seat 1 publishes (same as `profileTooLarge`, but with plain words and the field). */
export function checkProfileSizes(p: { name: string; phone: string; address: string }): ProfileSizeCheck {
  const labels: Record<'name' | 'phone' | 'address', string> = { name: 'Company name', phone: 'Phone', address: 'Address' }
  for (const f of ['name', 'phone', 'address'] as const) {
    if (p[f].length > PROFILE_TEXT_MAX) return { ok: false, field: f, message: `${labels[f]} can be at most ${PROFILE_TEXT_MAX} characters to be shared with the other devices.` }
  }
  return { ok: true }
}

/** Largest side tried, in order, when a logo has to be made smaller for the master. */
export const MASTER_LOGO_SIDES: readonly number[] = [512, 384, 256, 192, 128]

const isPng = (b: Uint8Array): boolean => sniffImage(b)?.ext === 'png'

/**
 * A logo the master accepts: PNG, <= 150 KB. A PNG that is already small enough is kept as it is; otherwise `encode(bytes, maxSide)` (a real
 * resize, supplied by the caller) is tried at each side in `MASTER_LOGO_SIDES` until the PNG fits. Null = could not be made small enough.
 */
export function fitLogoForMaster(bytes: Uint8Array, encode: (bytes: Uint8Array, maxSide: number) => Uint8Array | null): Uint8Array | null {
  const first = sniffImage(bytes)
  if (first === null) return null
  if (first.ext === 'png' && bytes.length <= LOGO_MAX_BYTES && Math.max(first.width, first.height) <= MASTER_LOGO_SIDES[0]!) return bytes
  for (const side of MASTER_LOGO_SIDES) {
    let out: Uint8Array | null = null
    try { out = encode(bytes, side) } catch { out = null }
    if (out !== null && isPng(out) && out.length <= LOGO_MAX_BYTES) return out
  }
  return null
}

/** Checks a downloaded logo (base64) before it is written to disk: PNG signature and the size rule. */
export function validMasterLogoBase64(b64: string): boolean {
  if (b64.length === 0 || base64DecodedLength(b64) > LOGO_MAX_BYTES) return false
  const head = atob(b64.slice(0, 16))
  return head.charCodeAt(0) === 0x89 && head.slice(1, 4) === 'PNG'
}
