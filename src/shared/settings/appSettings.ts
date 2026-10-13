/**
 * Phase 48 - pure rules for the Settings screens: company profile, logo file checks, PO prefix, behaviour numbers.
 * No Electron / Node / DOM. Main applies these before anything is stored; the renderer reuses them for live messages.
 */
import { DEFAULT_PO_PREFIX, formatPoNumber } from '../po'

export const COMPANY_PROFILE_KEY = 'company.profile'
export const BEHAVIOUR_KEYS = { trashRetentionDays: 'trash.retentionDays', leftUnlockPresses: 'behaviour.leftUnlockPresses', autosaveSeconds: 'behaviour.autosaveSeconds' } as const

export const COMPANY_NAME_MAX = 200
export const COMPANY_PHONE_MAX = 100
export const COMPANY_ADDRESS_MAX = 500

export const LOGO_MAX_BYTES = 512 * 1024
export const LOGO_MAX_SIDE_PX = 2000
export const LOGO_MIN_SIDE_PX = 16
export const LOGO_FILE_BASENAME = 'company-logo'

export const PO_PREFIX_MIN = 1
export const PO_PREFIX_MAX = 8
const PO_PREFIX_RE = /^[A-Z0-9][A-Z0-9\-_/]*$/

export const TRASH_RETENTION_RANGE = { min: 1, max: 365, default: 30 } as const
export const LEFT_UNLOCK_RANGE = { min: 1, max: 3, default: 2 } as const
export const AUTOSAVE_SECONDS_RANGE = { min: 1, max: 30, default: 2 } as const

export interface CompanyProfile { logo: string; name: string; phone: string; address: string }
export const EMPTY_COMPANY: CompanyProfile = Object.freeze({ logo: '', name: '', phone: '', address: '' })

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

const normAddress = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') : ''

/** Tolerant read of the stored value (a corrupt or missing row is the empty profile). */
export function readCompany(v: unknown): CompanyProfile {
  if (typeof v !== 'object' || v === null) return { ...EMPTY_COMPANY }
  const o = v as Record<string, unknown>
  return {
    logo: typeof o['logo'] === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(o['logo']) ? o['logo'] : '',
    name: clean(o['name'], COMPANY_NAME_MAX),
    phone: clean(o['phone'], COMPANY_PHONE_MAX),
    address: normAddress(o['address']).slice(0, COMPANY_ADDRESS_MAX)
  }
}

export type CompanyField = 'name' | 'phone' | 'address'
export type CompanyCheck = { ok: true; value: Omit<CompanyProfile, 'logo'> } | { ok: false; field: CompanyField; message: string }

/** The company name is required for a real Professional header; phone and address may be blank. Over-long input is refused, not cut. */
export function validateCompany(input: { name: unknown; phone: unknown; address: unknown }): CompanyCheck {
  const name = clean(input.name, 10_000)
  if (name === '') return { ok: false, field: 'name', message: 'Enter your company name.' }
  if (name.length > COMPANY_NAME_MAX) return { ok: false, field: 'name', message: `Company name can be at most ${COMPANY_NAME_MAX} characters.` }
  const phone = clean(input.phone, 10_000)
  if (phone.length > COMPANY_PHONE_MAX) return { ok: false, field: 'phone', message: `Phone can be at most ${COMPANY_PHONE_MAX} characters.` }
  const address = normAddress(input.address)
  if (address.length > COMPANY_ADDRESS_MAX) return { ok: false, field: 'address', message: `Address can be at most ${COMPANY_ADDRESS_MAX} characters.` }
  return { ok: true, value: { name, phone, address } }
}

export interface SniffedImage { ext: 'png' | 'jpg'; mime: 'image/png' | 'image/jpeg'; width: number; height: number }

/** Reads the real type and pixel size from the bytes (the file extension is never trusted). PNG and JPEG only; `null` = not one of those. */
export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    const u32 = (o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
    if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null
    return { ext: 'png', mime: 'image/png', width: u32(16), height: u32(20) }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]!
      if (m === 0xff) { i++; continue }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
      const len = (b[i + 2]! << 8) | b[i + 3]!
      if (len < 2) return null
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC) carry the frame size.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: 'jpg', mime: 'image/jpeg', width: (b[i + 7]! << 8) | b[i + 8]!, height: (b[i + 5]! << 8) | b[i + 6]! }
      i += 2 + len
    }
  }
  return null
}

export type LogoCheck = { ok: true; image: SniffedImage } | { ok: false; message: string }

export function validateLogoBytes(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, message: 'That file is empty.' }
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, message: `The logo is ${(bytes.length / 1024).toFixed(0)} KB; the limit is ${LOGO_MAX_BYTES / 1024} KB. Use a smaller image.` }
  const image = sniffImage(bytes)
  if (!image) return { ok: false, message: 'The logo must be a PNG or JPEG image.' }
  if (image.width < LOGO_MIN_SIDE_PX || image.height < LOGO_MIN_SIDE_PX) return { ok: false, message: `The logo is too small (${image.width} x ${image.height}). Use at least ${LOGO_MIN_SIDE_PX} px on each side.` }
  if (image.width > LOGO_MAX_SIDE_PX || image.height > LOGO_MAX_SIDE_PX) return { ok: false, message: `The logo is ${image.width} x ${image.height} px; the limit is ${LOGO_MAX_SIDE_PX} px on each side.` }
  return { ok: true, image }
}

export const logoFileName = (ext: 'png' | 'jpg'): string => `${LOGO_FILE_BASENAME}.${ext}`

/** Upper-cases and trims what the owner typed; the stored prefix is exactly this. */
export const normalizePoPrefix = (raw: string): string => raw.trim().toUpperCase()

export type PrefixCheck = { ok: true; prefix: string } | { ok: false; message: string }

/** `others` = the prefixes of the other known branches (case-insensitive clash is refused). */
export function validatePoPrefix(raw: string, others: readonly string[]): PrefixCheck {
  const prefix = normalizePoPrefix(raw)
  if (prefix.length < PO_PREFIX_MIN) return { ok: false, message: 'Enter a prefix, for example Q3-.' }
  if (prefix.length > PO_PREFIX_MAX) return { ok: false, message: `A prefix can be at most ${PO_PREFIX_MAX} characters.` }
  if (!PO_PREFIX_RE.test(prefix)) return { ok: false, message: 'Use letters, digits, and - _ / only, starting with a letter or digit.' }
  if (others.some((o) => o.toUpperCase() === prefix)) return { ok: false, message: `Another branch already uses ${prefix}.` }
  return { ok: true, prefix }
}

/** What the next new bill will be called with this prefix (existing bills keep the number they were saved with). */
export const previewPo = (prefix: string, nextSeq: number): string => formatPoNumber(prefix, nextSeq)
export { DEFAULT_PO_PREFIX }

const intIn = (v: unknown, r: { min: number; max: number; default: number }): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max ? v : r.default

/** Phase 75: Settings > Behaviour > Smooth arrow keys (KEYBOARD_CELL_RULES §11). Default ON; only an explicit `false` turns it off. */
export const NAV_SMOOTH_ARROWS_KEY = 'nav.smoothArrows'
export const readSmoothArrows = (all: Record<string, unknown>): boolean => all[NAV_SMOOTH_ARROWS_KEY] !== false

export interface BehaviourSettings { trashRetentionDays: number; leftUnlockPresses: number; autosaveSeconds: number }
export const DEFAULT_BEHAVIOUR: BehaviourSettings = { trashRetentionDays: TRASH_RETENTION_RANGE.default, leftUnlockPresses: LEFT_UNLOCK_RANGE.default, autosaveSeconds: AUTOSAVE_SECONDS_RANGE.default }

/** Tolerant: anything outside its range (or not a whole number) is that field's default. */
export function readBehaviour(all: Record<string, unknown>): BehaviourSettings {
  return {
    trashRetentionDays: intIn(all[BEHAVIOUR_KEYS.trashRetentionDays], TRASH_RETENTION_RANGE),
    leftUnlockPresses: intIn(all[BEHAVIOUR_KEYS.leftUnlockPresses], LEFT_UNLOCK_RANGE),
    autosaveSeconds: intIn(all[BEHAVIOUR_KEYS.autosaveSeconds], AUTOSAVE_SECONDS_RANGE)
  }
}

export type BehaviourCheck = { ok: true; value: BehaviourSettings } | { ok: false; field: keyof BehaviourSettings; message: string }

/** Strict (for saving): out-of-range or fractional values are refused with a message, not silently clamped. */
export function validateBehaviour(i: Record<keyof BehaviourSettings, unknown>): BehaviourCheck {
  const rows: [keyof BehaviourSettings, string, { min: number; max: number }][] = [
    ['trashRetentionDays', 'Keep deleted bills for', TRASH_RETENTION_RANGE],
    ['leftUnlockPresses', 'Left-arrow presses to unlock', LEFT_UNLOCK_RANGE],
    ['autosaveSeconds', 'Autosave after', AUTOSAVE_SECONDS_RANGE]
  ]
  for (const [field, label, r] of rows) {
    const v = i[field]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < r.min || v > r.max) return { ok: false, field, message: `${label}: enter a whole number from ${r.min} to ${r.max}.` }
  }
  return { ok: true, value: { trashRetentionDays: i.trashRetentionDays as number, leftUnlockPresses: i.leftUnlockPresses as number, autosaveSeconds: i.autosaveSeconds as number } }
}

export interface PrintDefaults { rupeeOnTotal: boolean; silent: boolean; printer: string }
export const PRINTER_NAME_MAX = 300

export function validatePrintDefaults(i: { rupeeOnTotal: unknown; silent: unknown; printer: unknown }): { ok: true; value: PrintDefaults } | { ok: false; field: 'printer'; message: string } {
  const printer = typeof i.printer === 'string' ? i.printer.trim() : ''
  if (printer.length > PRINTER_NAME_MAX) return { ok: false, field: 'printer', message: `Printer name can be at most ${PRINTER_NAME_MAX} characters.` }
  if (i.silent === true && printer === '') return { ok: false, field: 'printer', message: 'Silent printing needs a printer name. Choose a printer or turn silent printing off.' }
  return { ok: true, value: { rupeeOnTotal: i.rupeeOnTotal !== false, silent: i.silent === true, printer } }
}

/** Everything the Settings screens show, in one read (`appSettings:get`). */
export interface AppSettingsState {
  company: CompanyProfile & {
    /** The saved logo as a data URL for display (empty = none). */
    logoDataUrl: string
  }
  branch: { name: string; prefix: string; nextSeq: number; nextPo: string; otherPrefixes: string[] } | null
  print: PrintDefaults
  behaviour: BehaviourSettings
  /** Phase 72: Settings > Image quality (`image.scale`, whole number 2 to 5). */
  image: { scale: number }
  /** Phase 75: grid keyboard (`nav.smoothArrows`, default ON). */
  nav: { smoothArrows: boolean }
  /** Phase 77: `calc.roundOff` (default ON): new saves round the grand total to the nearest rupee. */
  calc: { roundOff: boolean; /** Phase 82: `calc.percentPresets`, canonical comma text (default "18, 5, 3"). */ percentPresets: string }
  /** True when the database is read-only (a newer version made it): Save is refused. */
  readOnly: boolean
}
