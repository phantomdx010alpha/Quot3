import type { PhoneDb } from '../data/db'
import { getSetting, setSetting, resetSetting, SECRET_SETTING_PREFIX } from '../data/settingsRepo'

/**
 * Phase 178 - app-lock GROUNDWORK (optional, OFF by default; design [A] 7: unconfirmed). Data layer only: no screen, no biometric.
 *
 * A numeric PIN is stored as a salted PBKDF2-SHA-256 hash (`secret.appLockPin`). `appLock.enabled` (Phase 175 setting) says whether the UI must
 * ask. HONEST LIMITS: the lock keeps out someone who picks up the phone and opens the app; it does NOT encrypt the sync login or the bills
 * (the vault key stays usable by this origin). A 4 to 8 digit PIN can be guessed by anyone who can run code on the origin, so wrong tries are counted and
 * `lockedForMs` tells the UI how long to wait. Biometric unlock (WebAuthn) is NOT built: Standing gap.
 */
export const PIN_SETTING = `${SECRET_SETTING_PREFIX}appLockPin`
export const PIN_MIN = 4
export const PIN_MAX = 8
export const PBKDF2_ITERATIONS = 150_000
export const FREE_TRIES = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 15 * 60_000

interface PinRecord { v: 1; salt: string; hash: string; iterations: number; fails: number; lockedUntil: number }

const b64 = (u: Uint8Array): string => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s) }
const unb64 = (s: string): Uint8Array<ArrayBuffer> => { const bin = atob(s); const o = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o }

export const isValidPin = (pin: string): boolean => new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin)

async function hashPin(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number, crypt: Crypto): Promise<string> {
  const base = await crypt.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypt.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256)
  return b64(new Uint8Array(bits))
}

/** Constant-time comparison of two equal-purpose base64 strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export interface AppLock {
  isEnabled(): Promise<boolean>
  /** Sets (or changes) the PIN and turns the lock on. Returns false when the PIN is not 4-8 digits. */
  setPin(pin: string): Promise<boolean>
  verify(pin: string): Promise<{ ok: true } | { ok: false; lockedForMs: number; triesLeft: number }>
  /** Turns the lock off and forgets the PIN; the current PIN is required. */
  disable(pin: string): Promise<boolean>
}

export function createAppLock(db: PhoneDb, o: { crypt?: Crypto; nowMs?: () => number; iterations?: number } = {}): AppLock {
  const crypt = o.crypt ?? globalThis.crypto
  const now = o.nowMs ?? Date.now
  const iterations = o.iterations ?? PBKDF2_ITERATIONS
  const read = () => getSetting<PinRecord | null>(db, PIN_SETTING, null)
  return {
    async isEnabled() {
      return (await getSetting(db, 'appLock.enabled')) === true && (await read()) !== null
    },
    async setPin(pin) {
      if (!isValidPin(pin)) return false
      const salt = crypt.getRandomValues(new Uint8Array(16))
      const rec: PinRecord = { v: 1, salt: b64(salt), hash: await hashPin(pin, salt, iterations, crypt), iterations, fails: 0, lockedUntil: 0 }
      await setSetting(db, PIN_SETTING, rec)
      await setSetting(db, 'appLock.enabled', true)
      return true
    },
    async verify(pin) {
      const rec = await read()
      if (!rec) return { ok: true }
      const t = now()
      if (rec.lockedUntil > t) return { ok: false, lockedForMs: rec.lockedUntil - t, triesLeft: 0 }
      const good = same(await hashPin(pin, unb64(rec.salt), rec.iterations, crypt), rec.hash)
      if (good) {
        if (rec.fails !== 0) await setSetting(db, PIN_SETTING, { ...rec, fails: 0, lockedUntil: 0 })
        return { ok: true }
      }
      const fails = rec.fails + 1
      const over = fails - FREE_TRIES
      const lockedForMs = over >= 0 ? Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** over) : 0
      await setSetting(db, PIN_SETTING, { ...rec, fails, lockedUntil: lockedForMs > 0 ? t + lockedForMs : 0 })
      return { ok: false, lockedForMs, triesLeft: Math.max(0, FREE_TRIES - fails) }
    },
    async disable(pin) {
      const r = await this.verify(pin)
      if (!r.ok) return false
      await resetSetting(db, PIN_SETTING)
      await setSetting(db, 'appLock.enabled', false)
      return true
    }
  }
}
