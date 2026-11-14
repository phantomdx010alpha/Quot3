/**
 * Phase 259 - sealing secrets for the master (API_CONTRACTS.md M24-0 C3 / C8): AES-256-GCM through WebCrypto
 * (`crypto.subtle`) only, so it runs in Node 22, browsers and Deno. The KEY IS PASSED IN (the master's `MASTER_KEK`, 32
 * bytes); nothing is stored here. Sealed text format: `v1.<base64url iv, 12 bytes>.<base64url ciphertext + 16-byte tag>`.
 * Any changed byte, wrong key or wrong `aad` makes `openText` throw a `SealError`. No Electron / Node-only import.
 */

export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

export const SEAL_VERSION = 'v1'
export const SEAL_KEY_BYTES = 32
const IV_BYTES = 12

// Typed through `crypto.subtle` itself so this file compiles with the DOM lib (renderer / PWA) and with Node's types.
type Subtle = typeof crypto.subtle
type KeyHandle = Awaited<ReturnType<Subtle['importKey']>>
type GcmParams = Parameters<Subtle['encrypt']>[0]
/** Uint8Array -> the ArrayBuffer-typed argument WebCrypto declares (same bytes, no copy). */
const buf = (u: Uint8Array): ArrayBuffer => u as unknown as ArrayBuffer

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })

/** Bytes -> base64url (no padding). */
export function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url (padding optional) -> bytes. Throws `SealError` on anything that is not base64url. */
export function b64urlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw new SealError('not base64url')
  const std = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(std)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Random bytes from WebCrypto (the only place the shared core draws randomness; seat codes take bytes from the caller). */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

/** The `MASTER_KEK` env value (base64url of exactly 32 bytes) -> key bytes. Throws `SealError` when the length is wrong. */
export function keyFromBase64Url(text: string): Uint8Array {
  const key = b64urlDecode(text.trim())
  if (key.length !== SEAL_KEY_BYTES) throw new SealError('the key must be 32 bytes')
  return key
}

/** Lower-case hex SHA-256 of UTF-8 text (code hash, device-token hash, enrol-token hash, ip hash). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf(enc.encode(text))))
  let hex = ''
  for (const b of digest) hex += b.toString(16).padStart(2, '0')
  return hex
}

async function importKey(key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<KeyHandle> {
  if (key.length !== SEAL_KEY_BYTES) throw new SealError('the key must be 32 bytes')
  return crypto.subtle.importKey('raw', buf(key), { name: 'AES-GCM' }, false, [usage])
}

function gcmParams(iv: Uint8Array, aad?: string): GcmParams {
  const p: { name: 'AES-GCM'; iv: ArrayBuffer; additionalData?: ArrayBuffer } = { name: 'AES-GCM', iv: buf(iv) }
  if (aad !== undefined) p.additionalData = buf(enc.encode(aad))
  return p as unknown as GcmParams
}

/** Seal `plain` with `key` (32 bytes). `aad` (e.g. `seat:<id>`) is authenticated but not stored; opening needs the same one. */
export async function sealText(key: Uint8Array, plain: string, aad?: string): Promise<string> {
  const k = await importKey(key, 'encrypt')
  const iv = randomBytes(IV_BYTES)
  const params = gcmParams(iv, aad)
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, k, buf(enc.encode(plain))))
  return `${SEAL_VERSION}.${b64urlEncode(iv)}.${b64urlEncode(ct)}`
}

/** Open sealed text. Throws `SealError` for a bad format, a changed byte, a wrong key or a wrong `aad` (never returns garbage). */
export async function openText(key: Uint8Array, sealed: string, aad?: string): Promise<string> {
  const parts = sealed.split('.')
  if (parts.length !== 3 || parts[0] !== SEAL_VERSION) throw new SealError('not sealed text')
  const iv = b64urlDecode(parts[1] ?? '')
  const ct = b64urlDecode(parts[2] ?? '')
  if (iv.length !== IV_BYTES || ct.length < 16) throw new SealError('not sealed text')
  const k = await importKey(key, 'decrypt')
  const params = gcmParams(iv, aad)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(params, k, buf(ct))
  } catch {
    throw new SealError('could not open')
  }
  try {
    return dec.decode(plain)
  } catch {
    throw new SealError('could not open')
  }
}

/** True when the text has the sealed shape (a cheap guard for "never store a plain secret in an `*_enc` column"). */
export const looksSealed = (text: string): boolean => /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(text)

/** The stored hash of a seat code: sha256 hex of the 16 characters (no prefix, no dashes). Pass a VALID code text. */
export async function seatCodeHash(chars16: string): Promise<string> {
  return sha256Hex(chars16)
}
