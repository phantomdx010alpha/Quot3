import { describe, expect, it } from 'vitest'
import {
  SEAL_PREFIX, SYNC_KDF_ITERATIONS, SyncCryptoError, aadFor, deriveKey, gcmOpen, gcmSeal, keyCheck, open, seal,
  unwrapStoredKey, verifyKeyCheck, wrapKeyForStorage
} from '../crypto'
import type { SecretStore } from '../secretStore'

const SALT = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex').toString('base64')
const FAST = 1000
const BILL = '7f0c1f2e-0000-4000-8000-00000000b111'
const SNAP = { id: BILL, revision: 3, party: { name: 'Ruby Traders' }, rows: [{ idx: 0, qty: '90', rate: '1250.50' }], deleted: false }
const reason = (f: () => unknown): string => { try { f(); return 'none' } catch (e) { return e instanceof SyncCryptoError ? e.reason : 'other' } }
const flipByte = (sealed: string, at: number): string => {
  const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), 'base64'); raw[at] = (raw[at] ?? 0) ^ 0x01
  return SEAL_PREFIX + raw.toString('base64')
}

describe('crypto - known answers', () => {
  it('PBKDF2-HMAC-SHA256 matches RFC 7914 section 11 ("passwd", "salt", c=1; first 32 bytes)', async () => {
    const k = await deriveKey('passwd', Buffer.from('salt').toString('base64'), 1).catch((e: unknown) => e)
    // "salt" is 4 bytes: the 16-byte minimum applies to real org salts, so the vector goes through Node directly too.
    expect(k).toBeInstanceOf(SyncCryptoError)
    const { pbkdf2Sync } = await import('node:crypto')
    expect(pbkdf2Sync('passwd', 'salt', 1, 32, 'sha256').toString('hex')).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc')
  })
  it('deriveKey = PBKDF2-HMAC-SHA256 over the org salt (pinned vector, 1000 rounds)', async () => {
    const { pbkdf2Sync } = await import('node:crypto')
    const k = await deriveKey('correct horse battery', SALT, FAST)
    expect(k.toString('hex')).toBe(pbkdf2Sync('correct horse battery', Buffer.from(SALT, 'base64'), FAST, 32, 'sha256').toString('hex'))
    expect(k).toHaveLength(32)
  })
  it('AES-256-GCM matches the GCM spec test case 14 (zero key, zero nonce, 16 zero bytes, no AAD)', () => {
    const out = gcmSeal(Buffer.alloc(32), Buffer.alloc(12), Buffer.alloc(16), Buffer.alloc(0))
    expect(out.subarray(0, 16).toString('hex')).toBe('cea7403d4d606b6e074ec5d3baf39d18')
    expect(out.subarray(16).toString('hex')).toBe('d0d1c8a799996bf0265b98b5d48ab919')
    expect(gcmOpen(Buffer.alloc(32), Buffer.alloc(12), out, Buffer.alloc(0))).toEqual(Buffer.alloc(16))
  })
  it('the key check is a pinned, deterministic value and the production iteration count is 310 000', () => {
    expect(keyCheck(Buffer.alloc(32))).toMatch(/^[0-9a-f]{8}$/)
    expect(keyCheck(Buffer.alloc(32))).toBe(keyCheck(Buffer.alloc(32)))
    expect(keyCheck(Buffer.alloc(32, 1))).not.toBe(keyCheck(Buffer.alloc(32)))
    expect(SYNC_KDF_ITERATIONS).toBeGreaterThanOrEqual(310_000)
  })
  it('seal with a fixed nonce is byte-for-byte reproducible (canonical JSON, deterministic deflate)', () => {
    const key = Buffer.alloc(32, 7), nonce = Buffer.alloc(12, 9)
    const a = seal(key, { b: 1, a: 2 }, BILL, 1, nonce), b = seal(key, { a: 2, b: 1 }, BILL, 1, nonce)
    expect(a).toBe(b)
    expect(a.startsWith(SEAL_PREFIX)).toBe(true)
  })
})

describe('crypto - seal / open', () => {
  it('round-trips a bill snapshot, including unicode and a long row list', async () => {
    const key = await deriveKey('correct horse battery', SALT, FAST)
    const big = { ...SNAP, rows: Array.from({ length: 80 }, (_, i) => ({ idx: i, name: `Item \u20B9 ${i}`, qty: '90', rate: '1250.50' })) }
    expect(open(key, seal(key, big, BILL, 3), BILL, 3)).toEqual(big)
  })
  it('compresses (80 repetitive rows are far smaller than their JSON)', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const rows = Array.from({ length: 80 }, (_, i) => ({ idx: i, name: 'Steel plate 10mm', qty: '90', rate: '1250.50' }))
    expect(seal(key, { rows }, BILL, 1).length).toBeLessThan(JSON.stringify({ rows }).length / 2)
  })
  it('uses a fresh nonce each time: same input, different ciphertext, both open', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const a = seal(key, SNAP, BILL, 3), b = seal(key, SNAP, BILL, 3)
    expect(a).not.toBe(b)
    expect(open(key, a, BILL, 3)).toEqual(open(key, b, BILL, 3))
  })
  it('a wrong passphrase is reported as WRONG_KEY, not as damage', async () => {
    const good = await deriveKey('correct horse battery', SALT, FAST), bad = await deriveKey('correct horse batterz', SALT, FAST)
    expect(reason(() => open(bad, seal(good, SNAP, BILL, 3), BILL, 3))).toBe('WRONG_KEY')
  })
  it('the same passphrase with another org salt is a different key', async () => {
    const a = await deriveKey('same-passphrase', SALT, FAST)
    const b = await deriveKey('same-passphrase', Buffer.alloc(16, 5).toString('base64'), FAST)
    expect(reason(() => open(b, seal(a, SNAP, BILL, 1), BILL, 1))).toBe('WRONG_KEY')
  })
  it('swapped AAD fails: another bill id or another revision', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const s = seal(key, SNAP, BILL, 3)
    expect(reason(() => open(key, s, '7f0c1f2e-0000-4000-8000-00000000b222', 3))).toBe('TAMPERED')
    expect(reason(() => open(key, s, BILL, 4))).toBe('TAMPERED')
    expect(aadFor(BILL, 3).toString()).toBe(`q3|1|${BILL}|3`)
  })
  it('tampered ciphertext, tag, nonce or version all fail and never return data', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const s = seal(key, SNAP, BILL, 3)
    const len = Buffer.from(s.slice(SEAL_PREFIX.length), 'base64').length
    expect(reason(() => open(key, flipByte(s, 1 + 4 + 12), BILL, 3))).toBe('TAMPERED') // first ciphertext byte
    expect(reason(() => open(key, flipByte(s, len - 1), BILL, 3))).toBe('TAMPERED') // last tag byte
    expect(reason(() => open(key, flipByte(s, 1 + 4), BILL, 3))).toBe('TAMPERED') // nonce
    expect(reason(() => open(key, flipByte(s, 0), BILL, 3))).toBe('UNSUPPORTED') // version
  })
  it('a damaged key-check byte reads as WRONG_KEY (the header is authenticated by the check, not trusted)', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    expect(reason(() => open(key, flipByte(seal(key, SNAP, BILL, 3), 2), BILL, 3))).toBe('WRONG_KEY')
  })
  it('malformed input is MALFORMED: wrong prefix, bad base64, truncated', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const s = seal(key, SNAP, BILL, 3)
    expect(reason(() => open(key, 'hello', BILL, 3))).toBe('MALFORMED')
    expect(reason(() => open(key, SEAL_PREFIX + '***', BILL, 3))).toBe('MALFORMED')
    expect(reason(() => open(key, s.slice(0, SEAL_PREFIX.length + 20), BILL, 3))).toBe('MALFORMED')
    expect(reason(() => open(key, '' as string, BILL, 3))).toBe('MALFORMED')
  })
  it('a decompression bomb is refused (valid tag, absurd inflated size)', async () => {
    const key = await deriveKey('pw-long-enough', SALT, FAST)
    const huge = { pad: 'a'.repeat(40 * 1024 * 1024) }
    expect(reason(() => open(key, seal(key, huge, BILL, 1), BILL, 1))).toBe('TAMPERED')
  })
  it('refuses a key of the wrong size and an invalid revision', () => {
    expect(() => seal(Buffer.alloc(16), SNAP, BILL, 1)).toThrow()
    expect(() => seal(Buffer.alloc(32), SNAP, BILL, -1)).toThrow()
    expect(() => seal(Buffer.alloc(32), SNAP, BILL, 1.5)).toThrow()
  })
})

describe('crypto - key derivation and caching', () => {
  it('is deterministic, NFKC-normalised, and rejects a short salt', async () => {
    const a = await deriveKey('pass\u00e9word-1', SALT, FAST), b = await deriveKey('pass\u0065\u0301word-1', SALT, FAST)
    expect(a.equals(b)).toBe(true)
    await expect(deriveKey('x'.repeat(10), Buffer.alloc(8).toString('base64'), FAST)).rejects.toBeInstanceOf(SyncCryptoError)
    await expect(deriveKey('x'.repeat(10), '', FAST)).rejects.toBeInstanceOf(SyncCryptoError)
  })
  it('verifyKeyCheck accepts the right key, rejects another and garbage', async () => {
    const a = await deriveKey('pw-long-enough', SALT, FAST), b = await deriveKey('pw-long-enough!', SALT, FAST)
    expect(verifyKeyCheck(a, keyCheck(a))).toBe(true)
    expect(verifyKeyCheck(b, keyCheck(a))).toBe(false)
    expect(verifyKeyCheck(a, 'zz')).toBe(false)
  })
  it('the cache stores the key (never the passphrase) through the secret store and reads it back', async () => {
    const store: SecretStore = { available: () => true, encrypt: (s) => `enc:${Buffer.from(s).reverse().toString('base64')}`, decrypt: (b) => { if (!b.startsWith('enc:')) throw new Error('bad'); return Buffer.from(b.slice(4), 'base64').reverse().toString() } }
    const key = await deriveKey('correct horse battery', SALT, FAST)
    const blob = wrapKeyForStorage(store, key)
    expect(blob).not.toContain(key.toString('base64'))
    expect(unwrapStoredKey(store, blob)?.equals(key)).toBe(true)
    expect(unwrapStoredKey(store, 'garbage')).toBeNull()
    expect(unwrapStoredKey(store, store.encrypt('AAAA'))).toBeNull() // decrypts, but is not a 32-byte key
  })
  it('PBKDF2 at the production count finishes (single run, informational bound 5 s)', async () => {
    const t0 = Date.now()
    const k = await deriveKey('correct horse battery', SALT)
    expect(k).toHaveLength(32)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
