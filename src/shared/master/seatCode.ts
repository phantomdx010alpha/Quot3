/**
 * Phase 259 - the seat code (API_CONTRACTS.md M24-0 C4): `Q3C-XXXX-XXXX-XXXX-XXXX` = prefix + 16 characters, the first 15
 * random (75 bits), the 16th a check character (weighted sum mod 31). Randomness is PASSED IN as bytes, never drawn here,
 * so tests are deterministic. Pure: no Electron / Node / DOM.
 */

export const SEAT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const SEAT_PREFIX = 'Q3C'
export const SEAT_PAYLOAD_LEN = 15
export const SEAT_CODE_LEN = 16
/** Check = sum mod 31 (not 32): any single wrong character is caught. */
const CHECK_MOD = 31

const valueOf = (ch: string): number => SEAT_ALPHABET.indexOf(ch)

/** The check character of 15 payload characters: `ALPHABET[(Σ value(c_i) * i) mod 31]`, i = 1..15. Throws on bad input. */
export function checkChar(payload15: string): string {
  if (payload15.length !== SEAT_PAYLOAD_LEN) throw new RangeError('checkChar needs exactly 15 characters')
  let sum = 0
  for (let i = 0; i < SEAT_PAYLOAD_LEN; i++) {
    const v = valueOf(payload15.charAt(i))
    if (v < 0) throw new RangeError('checkChar: character outside the seat alphabet')
    sum += v * (i + 1)
  }
  return SEAT_ALPHABET.charAt(sum % CHECK_MOD)
}

/** `ABCDEFGHIJKLMNOE` -> `Q3C-ABCD-EFGH-IJKL-MNOE` (any length is grouped by four; the prefix is always added). */
export function formatSeatCode(chars: string): string {
  const groups: string[] = []
  for (let i = 0; i < chars.length; i += 4) groups.push(chars.slice(i, i + 4))
  return [SEAT_PREFIX, ...groups].join('-')
}

/** 15 random bytes (each `& 31` picks a letter, uniform) -> a complete code. Extra bytes are ignored; fewer than 15 throws. */
export function generateSeatCode(bytes: Uint8Array): string {
  if (bytes.length < SEAT_PAYLOAD_LEN) throw new RangeError('generateSeatCode needs 15 random bytes')
  let payload = ''
  for (let i = 0; i < SEAT_PAYLOAD_LEN; i++) payload += SEAT_ALPHABET.charAt((bytes[i] ?? 0) & 31)
  return formatSeatCode(payload + checkChar(payload))
}

/**
 * The typed text without the prefix and grouping: upper-case, spaces / tabs / `-` / en dash / em dash removed, `0` -> `O`
 * and `1` -> `I`. The `Q3C` prefix is optional on input. (`8` and `9` are NOT mapped: they stay invalid.)
 */
export function seatCodeChars(input: string): string {
  let s = input.toUpperCase().replace(/[\s\-–—]+/g, '').replace(/0/g, 'O').replace(/1/g, 'I')
  // A 16-character input is already the bare form, even if it happens to start with Q3C.
  if (s.length !== SEAT_CODE_LEN && s.startsWith(SEAT_PREFIX)) s = s.slice(SEAT_PREFIX.length)
  return s
}

/** The normalised, grouped form `Q3C-XXXX-XXXX-XXXX-XXXX` of what was typed (wrong lengths are grouped as they are). */
export function normaliseSeatCode(input: string): string {
  return formatSeatCode(seatCodeChars(input))
}

export type SeatCodeCheck =
  | { ok: true; code: string; chars: string }
  | { ok: false; reason: 'format' | 'chars' | 'check' }

/**
 * Offline validation, in this order: (1) 16 characters else `format`; (2) every character in the alphabet else `chars`;
 * (3) the check character else `check`. A failure is shown to the user as Q3M91, with no network call.
 */
export function validateSeatCode(input: string): SeatCodeCheck {
  const chars = seatCodeChars(input)
  if (chars.length !== SEAT_CODE_LEN) return { ok: false, reason: 'format' }
  for (const ch of chars) if (valueOf(ch) < 0) return { ok: false, reason: 'chars' }
  if (checkChar(chars.slice(0, SEAT_PAYLOAD_LEN)) !== chars.charAt(SEAT_PAYLOAD_LEN)) return { ok: false, reason: 'check' }
  return { ok: true, code: formatSeatCode(chars), chars }
}

export const isSeatCode = (input: string): boolean => validateSeatCode(input).ok

/** What the master shows as the hint: the last four characters of a valid code, else ''. */
export function seatCodeHint(input: string): string {
  const v = validateSeatCode(input)
  return v.ok ? v.chars.slice(-4) : ''
}
