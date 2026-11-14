import { describe, expect, it } from 'vitest'
import { REDACTED, isSecretKey, redactText, redactSecrets, redactedJson } from '../redact'

const CODE = 'Q3C-ABCD-EFGH-IJKL-MNOE'
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 chars
const SEALED = 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB'

describe('redact (T28, shared part)', () => {
  it('fixture is what it says', () => expect(TOKEN).toHaveLength(43))

  it('secret keys are replaced, other values kept', () => {
    const out = redactSecrets({
      label: 'Shop A', seat: { no: 2, password: 'hunter2', email: 'a@b.c' }, deviceToken: TOKEN, enrolToken: 'x',
      service_role_enc: SEALED, password_enc: SEALED, license_key_enc: 'whatever', serviceRoleKey: 'k', anonKey: 'a',
      headers: { authorization: 'Bearer zzz', 'x-q3-device': TOKEN, apikey: 'k', 'content-type': 'application/json' }
    }) as Record<string, any>
    expect(out.label).toBe('Shop A')
    expect(out.seat.no).toBe(2)
    expect(out.seat.email).toBe('a@b.c')
    expect(out.seat.password).toBe(REDACTED)
    for (const k of ['deviceToken', 'enrolToken', 'service_role_enc', 'password_enc', 'license_key_enc', 'serviceRoleKey', 'anonKey'])
      expect(out[k]).toBe(REDACTED)
    expect(out.headers.authorization).toBe(REDACTED)
    expect(out.headers['x-q3-device']).toBe(REDACTED)
    expect(out.headers.apikey).toBe(REDACTED)
    expect(out.headers['content-type']).toBe('application/json')
  })

  it('redacts nested data: arrays, maps, sets, errors', () => {
    const err = new Error(`failed for ${CODE} with password=hunter2`)
    const out = JSON.stringify(redactSecrets({
      list: [{ deep: [{ deeper: { password: 'p1', note: `use ${CODE}` } }] }],
      m: new Map([['token', 'tt'], ['ok', `seat ${CODE}`]]),
      s: new Set([CODE]),
      err
    }))
    for (const bad of [CODE, 'hunter2', 'p1', '"tt"', 'ABCD-EFGH']) expect(out).not.toContain(bad)
    expect(out).toContain(REDACTED)
  })

  it('strings: seat codes in any typed shape, license keys, sealed text, bearer, jwt, device tokens, key=value', () => {
    const lines = [
      `redeem ${CODE} failed`, 'redeem q3c abcd efgh ijkl mnoe failed', 'redeem Q3CABCDEFGHIJKLMNOE failed',
      'license Q3-ABCD-EFGH-IJKL used', `stored ${SEALED}`, 'sent Bearer abc.def-ghi', `jwt eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2Q`,
      `token ${TOKEN} seen`, '{"password":"hunter2","a":1}', 'password=hunter2&x=1', "accessToken: 'tok123'"
    ]
    const bad = ['ABCD', 'abcd efgh', 'Q3-ABCD', 'AAAAAAAA', 'abc.def', 'eyJhbGci', TOKEN, 'hunter2', 'tok123']
    for (const l of lines) {
      const r = redactText(l)
      for (const b of bad) expect(r, `${l} -> ${r}`).not.toContain(b)
    }
    expect(redactText('plain words stay')).toBe('plain words stay')
  })

  it('keeps an error code visible but not a seat code under the same key', () => {
    expect(redactSecrets({ ok: false, code: 'Q3M01' })).toEqual({ ok: false, code: 'Q3M01' })
    expect((redactSecrets({ code: CODE }) as any).code).toBe(REDACTED)
  })

  it('does not mutate the input and survives cycles, depth and functions', () => {
    const a: any = { password: 'x', name: 'n' }
    a.self = a
    a.fn = () => 1
    const out = redactSecrets(a) as any
    expect(a.password).toBe('x')
    expect(out.self).toBe('[circular]')
    expect('fn' in out).toBe(false)
    let deep: any = { v: 1 }
    for (let i = 0; i < 40; i++) deep = { deep }
    expect(JSON.stringify(redactSecrets(deep))).toContain('[too deep]')
  })

  it('bytes are summarised, primitives pass through, json helper never throws', () => {
    expect(redactSecrets(new Uint8Array(5))).toBe('[bytes 5]')
    expect(redactSecrets(7)).toBe(7)
    expect(redactSecrets(null)).toBeNull()
    expect(redactedJson({ password: 'p', n: 1 })).toBe(`{"password":"${REDACTED}","n":1}`)
    expect(redactedJson({ n: 1n })).toBe('"[unserialisable]"')
  })

  it('isSecretKey', () => {
    for (const k of ['password', 'Password', 'device_token', 'deviceToken', 'x-q3-device', 'service_role_enc', 'codeEnc', 'accessToken'])
      expect(isSecretKey(k), k).toBe(true)
    for (const k of ['label', 'seatNo', 'status', 'email', 'profileVersion', 'codeHint']) expect(isSecretKey(k), k).toBe(false)
  })
})
