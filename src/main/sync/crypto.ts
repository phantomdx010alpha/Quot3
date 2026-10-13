import { createCipheriv, createDecipheriv, createHmac, pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { canonicalJson } from '../../shared/sync/canonicalJson'
import type { SecretStore } from './secretStore'

/**
 * Phase 53: the encryption layer of the sync postbox (docs/SYNC_POSTBOX_SPEC.md section 4). Main process only.
 * Node `crypto` + `zlib`, no dependency. The renderer never sees a key or a passphrase.
 *
 * Wire format of one sealed bill (a string safe for a `text` column):
 *   "Q3E1." + base64( version[1] | keyCheck[4] | nonce[12] | ciphertext[n] | gcmTag[16] )
 * - version 1 = deflate-raw, then AES-256-GCM.
 * - AAD = utf8("q3|1|" + billId + "|" + revision): a ciphertext cannot be moved to another bill or revision.
 * - keyCheck = first 4 bytes of HMAC-SHA256(key, "quot3-key-check-v1"): lets the receiver say "wrong passphrase"
 *   (WRONG_KEY) instead of "damaged" (TAMPERED). It reveals nothing usable about the key.
 */

export const SYNC_KDF_ITERATIONS = 310_000
export const SYNC_KEY_BYTES = 32
export const SYNC_NONCE_BYTES = 12
export const SYNC_TAG_BYTES = 16
export const SYNC_MIN_SALT_BYTES = 16
/** Inflate guard: a hostile row cannot expand into memory beyond this. */
export const SYNC_MAX_PLAIN_BYTES = 32 * 1024 * 1024
export const SEAL_PREFIX = 'Q3E1.'
const VERSION = 1
const KEY_CHECK_BYTES = 4
const KEY_CHECK_LABEL = 'quot3-key-check-v1'

export type CryptoFailure = 'WRONG_KEY' | 'TAMPERED' | 'MALFORMED' | 'UNSUPPORTED'
/** Maps onto the stable IPC error code DECRYPT_FAILED at the service layer; `reason` is for the Sync status list. */
export class SyncCryptoError extends Error {
  constructor(readonly reason: CryptoFailure, message: string) { super(message); this.name = 'SyncCryptoError' }
}

const REASON_TEXT: Record<CryptoFailure, string> = {
  WRONG_KEY: 'This change was encrypted with a different organisation passphrase.',
  TAMPERED: 'This change is damaged or was altered, so it cannot be trusted.',
  MALFORMED: 'This change is not in a format Quot3 understands.',
  UNSUPPORTED: 'This change was written by a newer version of Quot3.'
}
const fail = (r: CryptoFailure): never => { throw new SyncCryptoError(r, REASON_TEXT[r]) }

/** PBKDF2-HMAC-SHA256 -> 32-byte key. `salt` is the org's public salt (base64 from the server). Async: it takes ~100 ms. */
export function deriveKey(passphrase: string, saltBase64: string, iterations: number = SYNC_KDF_ITERATIONS): Promise<Buffer> {
  const salt = Buffer.from(saltBase64, 'base64')
  if (salt.length < SYNC_MIN_SALT_BYTES) return Promise.reject(new SyncCryptoError('MALFORMED', 'The organisation salt is missing or too short.'))
  if (!Number.isInteger(iterations) || iterations < 1) return Promise.reject(new RangeError('iterations'))
  return new Promise((resolve, reject) => {
    pbkdf2(Buffer.from(passphrase.normalize('NFKC'), 'utf8'), salt, iterations, SYNC_KEY_BYTES, 'sha256', (e, k) => (e ? reject(e) : resolve(k)))
  })
}

const assertKey = (key: Buffer): void => { if (key.length !== SYNC_KEY_BYTES) throw new RangeError('key must be 32 bytes') }

/** 4-byte key check as hex (8 chars). Deterministic; safe to store and to put in the envelope. */
export function keyCheck(key: Buffer): string {
  assertKey(key)
  return createHmac('sha256', key).update(KEY_CHECK_LABEL).digest().subarray(0, KEY_CHECK_BYTES).toString('hex')
}
/** Constant-time compare of a stored check value with a key (wrong-passphrase detection when the passphrase is re-entered). */
export function verifyKeyCheck(key: Buffer, stored: string): boolean {
  const a = Buffer.from(keyCheck(key), 'hex'), b = Buffer.from(stored, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function aadFor(billId: string, revision: number): Buffer {
  if (!Number.isInteger(revision) || revision < 0) throw new RangeError('revision')
  return Buffer.from(`q3|${VERSION}|${billId}|${revision}`, 'utf8')
}

/** Raw AES-256-GCM, exported for the known-answer tests and used by `seal`. Returns ciphertext || tag. */
export function gcmSeal(key: Buffer, nonce: Buffer, plain: Buffer, aad: Buffer): Buffer {
  assertKey(key)
  if (nonce.length !== SYNC_NONCE_BYTES) throw new RangeError('nonce must be 12 bytes')
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: SYNC_TAG_BYTES })
  c.setAAD(aad)
  const ct = Buffer.concat([c.update(plain), c.final()])
  return Buffer.concat([ct, c.getAuthTag()])
}
/** Throws a plain Error when the tag does not verify. */
export function gcmOpen(key: Buffer, nonce: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  assertKey(key)
  if (sealed.length < SYNC_TAG_BYTES) throw new Error('too short')
  const d = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: SYNC_TAG_BYTES })
  d.setAAD(aad)
  d.setAuthTag(sealed.subarray(sealed.length - SYNC_TAG_BYTES))
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - SYNC_TAG_BYTES)), d.final()])
}

/** Canonical JSON -> deflate -> AES-256-GCM with a fresh random nonce. */
export function seal(key: Buffer, snapshot: unknown, billId: string, revision: number, nonce: Buffer = randomBytes(SYNC_NONCE_BYTES)): string {
  assertKey(key)
  const plain = deflateRawSync(Buffer.from(canonicalJson(snapshot), 'utf8'))
  const body = gcmSeal(key, nonce, plain, aadFor(billId, revision))
  return SEAL_PREFIX + Buffer.concat([Buffer.from([VERSION]), Buffer.from(keyCheck(key), 'hex'), nonce, body]).toString('base64')
}

/** Reverses `seal`. Throws `SyncCryptoError` (WRONG_KEY / TAMPERED / MALFORMED / UNSUPPORTED); never returns partial data. */
export function open(key: Buffer, sealed: string, billId: string, revision: number): unknown {
  assertKey(key)
  if (typeof sealed !== 'string' || !sealed.startsWith(SEAL_PREFIX)) return fail('MALFORMED')
  const b64 = sealed.slice(SEAL_PREFIX.length)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return fail('MALFORMED')
  const raw = Buffer.from(b64, 'base64')
  if (raw.length < 1 + KEY_CHECK_BYTES + SYNC_NONCE_BYTES + SYNC_TAG_BYTES) return fail('MALFORMED')
  if (raw[0] !== VERSION) return fail('UNSUPPORTED')
  const check = raw.subarray(1, 1 + KEY_CHECK_BYTES)
  if (!verifyKeyCheck(key, check.toString('hex'))) return fail('WRONG_KEY')
  const nonce = raw.subarray(1 + KEY_CHECK_BYTES, 1 + KEY_CHECK_BYTES + SYNC_NONCE_BYTES)
  const body = raw.subarray(1 + KEY_CHECK_BYTES + SYNC_NONCE_BYTES)
  let plain: Buffer
  try { plain = gcmOpen(key, nonce, body, aadFor(billId, revision)) } catch { return fail('TAMPERED') }
  let text: string
  try { text = inflateRawSync(plain, { maxOutputLength: SYNC_MAX_PLAIN_BYTES }).toString('utf8') } catch { return fail('TAMPERED') }
  try { return JSON.parse(text) as unknown } catch { return fail('TAMPERED') }
}

/**
 * The postbox stores `nonce` (12 bytes) and `ciphertext` as separate columns. A sealed string maps onto them without
 * loss: nonce = the nonce field, ciphertext = version | keyCheck | encrypted body | tag (everything else, in order).
 * Both are base64. `partsToSealed(sealedToParts(x)) === x` for every sealed string `seal` produces.
 */
export function sealedToParts(sealed: string): { nonce: string; ciphertext: string } {
  if (typeof sealed !== 'string' || !sealed.startsWith(SEAL_PREFIX)) return fail('MALFORMED')
  const b64 = sealed.slice(SEAL_PREFIX.length)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return fail('MALFORMED')
  const raw = Buffer.from(b64, 'base64')
  const head = 1 + KEY_CHECK_BYTES
  if (raw.length < head + SYNC_NONCE_BYTES + SYNC_TAG_BYTES) return fail('MALFORMED')
  return {
    nonce: raw.subarray(head, head + SYNC_NONCE_BYTES).toString('base64'),
    ciphertext: Buffer.concat([raw.subarray(0, head), raw.subarray(head + SYNC_NONCE_BYTES)]).toString('base64')
  }
}
export function partsToSealed(nonce: string, ciphertext: string): string {
  const n = Buffer.from(nonce, 'base64'), c = Buffer.from(ciphertext, 'base64')
  const head = 1 + KEY_CHECK_BYTES
  if (n.length !== SYNC_NONCE_BYTES || c.length < head + SYNC_TAG_BYTES) return fail('MALFORMED')
  return SEAL_PREFIX + Buffer.concat([c.subarray(0, head), n, c.subarray(head)]).toString('base64')
}

/** Key caching: the derived key (never the passphrase) is stored through `safeStorage`. */
export function wrapKeyForStorage(secrets: SecretStore, key: Buffer): string {
  assertKey(key)
  return secrets.encrypt(key.toString('base64'))
}
/** Returns null when the blob cannot be read (another Windows user, damaged data) or does not hold a 32-byte key. */
export function unwrapStoredKey(secrets: SecretStore, blob: string): Buffer | null {
  try {
    const k = Buffer.from(secrets.decrypt(blob), 'base64')
    return k.length === SYNC_KEY_BYTES ? k : null
  } catch { return null }
}
