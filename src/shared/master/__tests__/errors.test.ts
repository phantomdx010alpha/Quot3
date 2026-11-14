import { describe, expect, it } from 'vitest'
import {
  CLIENT_ERROR_CODES, MASTER_ERRORS, SERVER_ERROR_CODES, isMasterErrorCode, masterErrorBody, masterErrorHttp, masterErrorWords
} from '../errors'

describe('master errors (T34: one table of plain words)', () => {
  it('has Q3M01..Q3M21 and Q3M99 for the server and Q3M90..Q3M93 for clients', () => {
    const want = Array.from({ length: 21 }, (_, i) => `Q3M${String(i + 1).padStart(2, '0')}`)
    expect(SERVER_ERROR_CODES.slice().sort()).toEqual([...want, 'Q3M99'].sort())
    expect(CLIENT_ERROR_CODES.slice().sort()).toEqual(['Q3M90', 'Q3M91', 'Q3M92', 'Q3M93'])
  })

  it('every entry is self-consistent and in plain words', () => {
    for (const [code, info] of Object.entries(MASTER_ERRORS)) {
      expect(info.code).toBe(code)
      expect(info.error).toMatch(/^[a-z0-9_]+$/)
      expect(info.message).toMatch(/[.]$/)
      expect(info.message).not.toMatch(/Q3M\d|[{}\[\]]|undefined|exception|stack/i)
    }
  })

  it('HTTP statuses match the frozen table', () => {
    const http: Record<string, number> = {
      Q3M01: 400, Q3M02: 429, Q3M03: 400, Q3M04: 401, Q3M05: 403, Q3M06: 403, Q3M07: 403, Q3M08: 409, Q3M09: 404,
      Q3M10: 409, Q3M11: 502, Q3M12: 502, Q3M13: 409, Q3M14: 401, Q3M15: 404, Q3M16: 400, Q3M17: 409, Q3M18: 413,
      Q3M19: 426, Q3M20: 409, Q3M21: 409, Q3M99: 500
    }
    for (const [c, h] of Object.entries(http)) expect(masterErrorHttp(c)).toBe(h)
    for (const c of CLIENT_ERROR_CODES) expect(MASTER_ERRORS[c].http).toBe(0)
  })

  it('key sentences are exactly the frozen words', () => {
    expect(masterErrorWords('Q3M01')).toBe('That code did not work. Check it and try again.')
    expect(masterErrorWords('Q3M90')).toBe('Master unreachable, try again.')
    expect(masterErrorWords('Q3M08')).toBe('The seat limit of 15 is reached.')
    expect(masterErrorWords('Q3M91')).toBe('That code has a typo. Check it and try again.')
  })

  it('an unknown code gets the internal-error words, never a raw code', () => {
    expect(isMasterErrorCode('Q3M77')).toBe(false)
    expect(masterErrorWords('Q3M77')).toBe(MASTER_ERRORS.Q3M99.message)
    expect(masterErrorBody('nope')).toEqual({ ok: false, code: 'Q3M99', error: 'internal', message: MASTER_ERRORS.Q3M99.message })
    expect(masterErrorHttp('Q3M91')).toBe(500)
  })

  it('failure body has the frozen shape', () => {
    expect(masterErrorBody('Q3M01')).toEqual({
      ok: false, code: 'Q3M01', error: 'invalid_code', message: 'That code did not work. Check it and try again.'
    })
  })
})
