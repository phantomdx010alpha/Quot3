import type { PhoneDb } from '../data/db'
import { getSetting, setSetting, resetSetting, SECRET_SETTING_PREFIX } from '../data/settingsRepo'
import { toSyncFailure, isTransientKind } from './errors'
import type { PhoneSession, PhoneSyncPort, SyncFailure } from './transport'

/**
 * Phase 178 - the sync login kept on the phone.
 *
 * What is stored (all inside ONE encrypted blob, setting `secret.syncVault`): the Supabase address, the anon key, the license key, the seat e-mail
 * and the current session tokens. The seat PASSWORD is never stored: the refresh token keeps the phone signed in, and when it no longer works
 * the person types the password again.
 *
 * How it is protected: AES-GCM with a NON-EXTRACTABLE key made by the browser (`crypto.subtle`) and kept in IndexedDB (`secret.syncVaultKey`).
 * Page code can use the key but cannot read its bytes. HONEST LIMIT: this is not the desktop's operating-system secret store. Anyone who
 * can run code on this origin, or who unlocks the phone and opens the app with no app lock, can use the key. It stops casual reading of a copied
 * database, not a determined attacker with the unlocked phone. `secret.*` settings are never part of a backup file (Phase 175).
 */
export const VAULT_KEY_SETTING = `${SECRET_SETTING_PREFIX}syncVaultKey`
export const VAULT_BLOB_SETTING = `${SECRET_SETTING_PREFIX}syncVault`

export interface VaultData {
  supabaseUrl: string
  anonKey: string
  license: string
  email: string
  session: PhoneSession | null
}

interface Blob {
  v: 1
  iv: string
  ct: string
}

const b64 = (u: Uint8Array): string => {
  let s = ''
  for (const c of u) s += String.fromCharCode(c)
  return btoa(s)
}
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export class VaultError extends Error {
  constructor(readonly code: 'unavailable' | 'corrupt', message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

export interface SessionVault {
  /** The stored login, or null when none / unreadable (an unreadable blob is treated as signed out and dropped: the person signs in again). */
  load(): Promise<VaultData | null>
  save(d: VaultData): Promise<void>
  /** Keeps the connection details, drops only the session tokens. */
  clearSession(): Promise<void>
  /** Removes everything this vault stored, including its key. */
  forget(): Promise<void>
}

export function createSessionVault(db: PhoneDb, crypt: Crypto = globalThis.crypto): SessionVault {
  const subtle = crypt?.subtle
  async function key(create: boolean): Promise<CryptoKey | null> {
    if (!subtle) throw new VaultError('unavailable', 'This browser cannot protect the login (no Web Crypto). Use https and a current Chrome.')
    const stored = await getSetting<CryptoKey | null>(db, VAULT_KEY_SETTING, null)
    if (stored) return stored
    if (!create) return null
    const k = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await setSetting(db, VAULT_KEY_SETTING, k)
    return k
  }
  async function load(): Promise<VaultData | null> {
    const blob = await getSetting<Blob | null>(db, VAULT_BLOB_SETTING, null)
    if (!blob) return null
    try {
      const k = await key(false)
      if (!k) throw new Error('no key')
      const plain = await subtle!.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, k, unb64(blob.ct))
      return JSON.parse(new TextDecoder().decode(plain)) as VaultData
    } catch (e) {
      if (e instanceof VaultError) throw e
      await resetSetting(db, VAULT_BLOB_SETTING) // damaged or from another key: nothing useful can be read, ask for a new sign-in
      return null
    }
  }
  async function save(d: VaultData): Promise<void> {
    const k = (await key(true))!
    const iv = crypt.getRandomValues(new Uint8Array(12))
    const ct = await subtle!.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(d)))
    await setSetting(db, VAULT_BLOB_SETTING, { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) } satisfies Blob)
  }
  return {
    load,
    save,
    async clearSession() {
      const d = await load()
      if (d) await save({ ...d, session: null })
    },
    async forget() {
      await resetSetting(db, VAULT_BLOB_SETTING)
      await resetSetting(db, VAULT_KEY_SETTING)
    }
  }
}

/**
 * Refresh tokens are single-use: every time the transport refreshes, the new pair MUST be stored or the next start is signed out.
 * Writes are queued so two quick refreshes cannot land out of order. Returns the unsubscribe.
 */
export function persistSessionChanges(port: Pick<PhoneSyncPort, 'onSessionChange'>, vault: SessionVault, onError?: (e: unknown) => void): () => void {
  let chain: Promise<void> = Promise.resolve()
  return port.onSessionChange((s) => {
    chain = chain
      .then(async () => {
        const d = await vault.load()
        if (d) await vault.save({ ...d, session: s })
      })
      .catch((e) => onError?.(e))
  })
}

export type RestoreResult =
  | { state: 'none' } // never signed in on this phone
  | { state: 'signed_out'; failure: SyncFailure } // stored login no longer accepted: sign in again
  | { state: 'signed_in'; data: VaultData }
  | { state: 'unreachable'; data: VaultData; failure: SyncFailure } // server paused / offline: keep the login, try again later

/** Start-up: put the stored login back. A refused login clears the tokens only; a paused or unreachable server keeps everything. */
export async function restoreSyncSession(vault: SessionVault, port: PhoneSyncPort): Promise<RestoreResult> {
  const data = await vault.load()
  if (!data) return { state: 'none' }
  if (!data.session) return { state: 'signed_out', failure: { kind: 'auth_failed', message: 'Sign in again to keep syncing.' } }
  try {
    const fresh = await port.restoreSession(data.session)
    const next = { ...data, session: fresh }
    await vault.save(next)
    return { state: 'signed_in', data: next }
  } catch (e) {
    const failure = toSyncFailure(e)
    if (isTransientKind(failure.kind)) return { state: 'unreachable', data, failure }
    await vault.clearSession()
    return { state: 'signed_out', failure }
  }
}

/** Sign out: the server session is dropped (best effort), the stored tokens are cleared. Local bills, the branch and the connection details stay. */
export async function signOutPhone(vault: SessionVault, port: Pick<PhoneSyncPort, 'signOut'>): Promise<void> {
  try {
    await port.signOut()
  } catch {
    // offline: the local tokens are what matter
  }
  await vault.clearSession()
}
