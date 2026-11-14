import { describe, expect, it } from 'vitest'
import {
  SealError, b64urlDecode, b64urlEncode, keyFromBase64Url, looksSealed, openText, randomBytes, seatCodeHash, sealText, sha256Hex
} from '../seal'

const key = () => Uint8Array.from({ length: 32 }, (_, i) => i + 1)

describe('seal (T33)', () => {
  it('round trip returns the text, including unicode and empty', async () => {
    for (const t of ['hunter2', '', 'Q3C-ABCD-EFGH-IJKL-MNOE', 'नमस्ते ₹ 12,988.00 ✓']) {
      const s = await sealText(key(), t)
      expect(s).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
      expect(looksSealed(s)).toBe(true)
      expect(await openText(key(), s)).toBe(t)
    }
  })

  it('never contains the plain text and uses a new iv each time', async () => {
    const a = await sealText(key(), 'secret-password')
    const b = await sealText(key(), 'secret-password')
    expect(a).not.toContain('secret')
    expect(a).not.toBe(b)
  })

  it('a changed byte anywhere fails (iv or ciphertext or tag)', async () => {
    const s = await sealText(key(), 'hello')
    const [v, iv, ct] = s.split('.') as [string, string, string]
    const flip = (b64: string, i: number) => {
      const bytes = b64urlDecode(b64)
      bytes[i] = (bytes[i] ?? 0) ^ 1
      return b64urlEncode(bytes)
    }
    await expect(openText(key(), `${v}.${flip(iv, 0)}.${ct}`)).rejects.toBeInstanceOf(SealError)
    await expect(openText(key(), `${v}.${iv}.${flip(ct, 0)}`)).rejects.toBeInstanceOf(SealError)
    await expect(openText(key(), `${v}.${iv}.${flip(ct, b64urlDecode(ct).length - 1)}`)).rejects.toBeInstanceOf(SealError)
  })

  it('wrong key and wrong aad fail; the right aad works', async () => {
    const s = await sealText(key(), 'x', 'seat:1')
    expect(await openText(key(), s, 'seat:1')).toBe('x')
    const other = key()
    other[0] = 99
    await expect(openText(other, s, 'seat:1')).rejects.toBeInstanceOf(SealError)
    await expect(openText(key(), s, 'seat:2')).rejects.toBeInstanceOf(SealError)
    await expect(openText(key(), s)).rejects.toBeInstanceOf(SealError)
  })

  it('bad shapes and bad keys throw SealError', async () => {
    for (const bad of ['', 'v1', 'v1.a.b', 'v2.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB', 'a.b.c.d', 'plain text'])
      await expect(openText(key(), bad)).rejects.toBeInstanceOf(SealError)
    await expect(sealText(new Uint8Array(16), 'x')).rejects.toBeInstanceOf(SealError)
    expect(looksSealed('plain text')).toBe(false)
  })

  it('keyFromBase64Url needs exactly 32 bytes', () => {
    const k = key()
    expect(keyFromBase64Url(` ${b64urlEncode(k)}\n`)).toEqual(k)
    expect(() => keyFromBase64Url(b64urlEncode(new Uint8Array(31)))).toThrow(SealError)
    expect(() => keyFromBase64Url('not base64!')).toThrow(SealError)
  })

  it('base64url round trip, no padding, url-safe', () => {
    const bytes = Uint8Array.from([251, 255, 254, 0, 1, 2, 250])
    const s = b64urlEncode(bytes)
    expect(s).not.toMatch(/[+/=]/)
    expect(b64urlDecode(s)).toEqual(bytes)
    expect(randomBytes(32)).toHaveLength(32)
    expect(b64urlEncode(randomBytes(32))).toHaveLength(43) // a device token has 43 characters
  })

  it('sha256Hex matches the known vector and seatCodeHash hashes the 16 characters', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await seatCodeHash('ABCDEFGHIJKLMNOE')).toBe(await sha256Hex('ABCDEFGHIJKLMNOE'))
  })
})
