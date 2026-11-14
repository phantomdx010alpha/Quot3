import { describe, expect, it } from 'vitest'
import {
  SEAT_ALPHABET, checkChar, formatSeatCode, generateSeatCode, isSeatCode, normaliseSeatCode, seatCodeHint, validateSeatCode
} from '../seatCode'

// The five worked examples of API_CONTRACTS.md M24-0 C4 (invented, never issued): random values -> code.
const WORKED: Array<[number[], string, string]> = [
  [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 'ABCDEFGHIJKLMNO', 'Q3C-ABCD-EFGH-IJKL-MNOE'],
  [Array(15).fill(31), '777777777777777', 'Q3C-7777-7777-7777-777A'],
  [[7, 19, 2, 25, 30, 11, 4, 16, 22, 9, 28, 13, 1, 20, 5], 'HTCZ6LEQWJ4NBUF', 'Q3C-HTCZ-6LEQ-WJ4N-BUFA'],
  [[26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8], '234567ABCDEFGHI', 'Q3C-2345-67AB-CDEF-GHIS'],
  [[15, 3, 21, 8, 17, 29, 6, 24, 12, 0, 18, 31, 10, 23, 14], 'PDVIR5GYMAS7KXO', 'Q3C-PDVI-R5GY-MAS7-KXO3']
]

describe('seatCode (T30)', () => {
  it('alphabet is 32 letters', () => {
    expect(SEAT_ALPHABET).toHaveLength(32)
    expect(new Set(SEAT_ALPHABET).size).toBe(32)
  })

  it.each(WORKED)('worked example %# generates, checks and validates', (bytes, payload, code) => {
    expect(generateSeatCode(Uint8Array.from(bytes))).toBe(code)
    expect(checkChar(payload)).toBe(code.slice(-1))
    const v = validateSeatCode(code)
    expect(v).toEqual({ ok: true, code, chars: code.replace(/-/g, '').slice(3) })
    expect(seatCodeHint(code)).toBe(code.slice(-4))
  })

  it('high bits of the random bytes are ignored (& 31) and extra bytes too', () => {
    const a = generateSeatCode(Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]))
    const b = generateSeatCode(Uint8Array.from([32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 255, 255]))
    expect(b).toBe(a)
  })

  it('refuses fewer than 15 bytes', () => {
    expect(() => generateSeatCode(new Uint8Array(14))).toThrow(RangeError)
  })

  it('refuses a bad payload in checkChar', () => {
    expect(() => checkChar('ABC')).toThrow(RangeError)
    expect(() => checkChar('ABCDEFGHIJKLMN8')).toThrow(RangeError)
  })

  it('typos are refused offline with the right reason', () => {
    expect(validateSeatCode('Q3C-ABCD-EFGH-IJKL-MNOF')).toEqual({ ok: false, reason: 'check' })
    expect(validateSeatCode('Q3C-ABCD-EFGH-IJLK-MNOE')).toEqual({ ok: false, reason: 'check' })
    expect(validateSeatCode('Q3C-ABCD-EFGH-IJKL-MN8E')).toEqual({ ok: false, reason: 'chars' })
    expect(validateSeatCode('Q3C-ABCD-EFGH-IJKL-MNO')).toEqual({ ok: false, reason: 'format' })
    expect(validateSeatCode('')).toEqual({ ok: false, reason: 'format' })
  })

  it('every single wrong character is caught, except A <-> 7 in the 15 payload positions (known limit, mod 31)', () => {
    for (const [, , code] of WORKED) {
      const chars = code.replace(/-/g, '').slice(3)
      for (let i = 0; i < 16; i++) {
        for (const ch of SEAT_ALPHABET) {
          const was = chars[i] as string
          if (ch === was) continue
          const bad = chars.slice(0, i) + ch + chars.slice(i + 1)
          const knownLimit = i < 15 && ((was === 'A' && ch === '7') || (was === '7' && ch === 'A'))
          expect(validateSeatCode(bad).ok, `${code} pos ${i} ${was}->${ch}`).toBe(knownLimit)
        }
      }
    }
  })

  it('adjacent swaps are caught except the A / 7 pair', () => {
    const code = 'Q3C-ABCD-EFGH-IJKL-MNOE'
    const chars = code.replace(/-/g, '').slice(3)
    for (let i = 0; i < 14; i++) {
      if (chars[i] === chars[i + 1]) continue
      const swapped = chars.slice(0, i) + chars[i + 1] + chars[i] + chars.slice(i + 2)
      expect(validateSeatCode(swapped).ok, `swap at ${i}`).toBe(false)
    }
  })

  it('normalises case, spaces, dashes, 0->O, 1->I and an optional prefix', () => {
    const want = 'Q3C-ABCD-EFGH-IJKL-MNOE'
    expect(normaliseSeatCode('q3c abcd efgh ijkl mnoe')).toBe(want)
    expect(normaliseSeatCode('ABCDEFGHIJKLMNOE')).toBe(want)
    expect(normaliseSeatCode('  Q3C–ABCD—EFGH-IJKL\tMNOE\n')).toBe(want)
    expect(normaliseSeatCode('abcdefghijklmn0e')).toBe(want) // 0 -> O
    expect(isSeatCode('ABCDEFGH1JKLMNOE')).toBe(true) // 1 -> I restores the real payload
    expect(isSeatCode('ABCDEFGH1JKLMNOF')).toBe(false)
    expect(validateSeatCode('ABCDEFGHIJKLMN0E').ok).toBe(true)
  })

  it('8 and 9 are not mapped (invalid characters)', () => {
    expect(validateSeatCode('ABCDEFGHIJKLMN8E')).toEqual({ ok: false, reason: 'chars' })
    expect(validateSeatCode('ABCDEFGHIJKLMN9E')).toEqual({ ok: false, reason: 'chars' })
  })

  it('a bare 16-character code that itself starts with Q3C keeps its first letters', () => {
    const payload = 'Q3CDEFGHIJKLMNO'
    const code = payload + checkChar(payload)
    expect(validateSeatCode(code).ok).toBe(true)
    expect(validateSeatCode(formatSeatCode(code)).ok).toBe(true)
  })

  it('random round trip: 200 generated codes validate and survive typing noise', () => {
    let seed = 12345
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff)
    for (let n = 0; n < 200; n++) {
      const bytes = Uint8Array.from({ length: 15 }, () => rnd() & 255)
      const code = generateSeatCode(bytes)
      expect(code).toMatch(/^Q3C-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/)
      expect(validateSeatCode(code.toLowerCase().replace(/-/g, ' ')).ok).toBe(true)
    }
  })

  it('hint of an invalid code is empty', () => {
    expect(seatCodeHint('nonsense')).toBe('')
  })
})
