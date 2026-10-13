import { describe, expect, it } from 'vitest'
import {
  checkPrefixForServer, isLicenseKey, linkStateFor, maskLicenseKey, normalizeLicenseKey, validateAnonKey, validateLicenseKey, validatePassphrase, validateSupabaseUrl, TRANSPORT_MESSAGES
} from '../license'

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')

describe('license rules (Phase 52)', () => {
  it('normalises and validates the key format the server enforces', () => {
    expect(normalizeLicenseKey(' q3-abcd-efgh-jklm\n')).toBe('Q3-ABCD-EFGH-JKLM')
    expect(isLicenseKey('q3-abcd-efgh-jk2m')).toBe(true)
    expect(isLicenseKey('Q3-ABCD-EFGH-JK1M')).toBe(false) // 1 is not in the alphabet
    expect(isLicenseKey('Q3-ABCD-EFGH')).toBe(false)
    expect(validateLicenseKey('')).toMatchObject({ ok: false })
    expect(validateLicenseKey('q3-abcd-efgh-jklm')).toEqual({ ok: true, value: 'Q3-ABCD-EFGH-JKLM' })
  })
  it('masks all but the first group', () => {
    expect(maskLicenseKey('q3-abcd-efgh-jklm')).toBe('Q3-ABCD-****-****')
    expect(maskLicenseKey('nonsense')).toBe('****')
  })
  it('accepts https project URLs, local http only for localhost, nothing else', () => {
    expect(validateSupabaseUrl(' https://abcd.supabase.co/ ')).toEqual({ ok: true, value: 'https://abcd.supabase.co' })
    expect(validateSupabaseUrl('http://localhost:54321')).toEqual({ ok: true, value: 'http://localhost:54321' })
    expect(validateSupabaseUrl('http://abcd.supabase.co')).toMatchObject({ ok: false })
    expect(validateSupabaseUrl('abcd.supabase.co')).toMatchObject({ ok: false })
    expect(validateSupabaseUrl('https://u:p@abcd.supabase.co')).toMatchObject({ ok: false })
    expect(validateSupabaseUrl('')).toMatchObject({ ok: false })
  })
  it('refuses a service_role anon key, by role claim', () => {
    const jwt = (role: string): string => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`
    expect(validateAnonKey(jwt('anon'))).toMatchObject({ ok: true })
    expect(validateAnonKey(jwt('service_role'))).toMatchObject({ ok: false })
    expect(validateAnonKey('sb_service_role_xyz')).toMatchObject({ ok: false })
    expect(validateAnonKey('two words')).toMatchObject({ ok: false })
    expect(validateAnonKey('')).toMatchObject({ ok: false })
    expect(validateAnonKey('opaque-publishable-key')).toMatchObject({ ok: true })
  })
  it('passphrase: length bounds and no edge spaces', () => {
    expect(validatePassphrase('short')).toMatchObject({ ok: false })
    expect(validatePassphrase(' padded pass ')).toMatchObject({ ok: false })
    expect(validatePassphrase('x'.repeat(129))).toMatchObject({ ok: false })
    expect(validatePassphrase('correct horse battery')).toMatchObject({ ok: true })
  })
  it('PO prefix must fit the server rule', () => {
    expect(checkPrefixForServer('blr-')).toEqual({ ok: true, value: 'BLR-' })
    expect(checkPrefixForServer('TOOLONGPFX-')).toMatchObject({ ok: false })
    expect(checkPrefixForServer('A B')).toMatchObject({ ok: false })
  })
  it('every failure kind has a message and a link state; license problems are never "offline"', () => {
    for (const k of Object.keys(TRANSPORT_MESSAGES) as (keyof typeof TRANSPORT_MESSAGES)[]) expect(TRANSPORT_MESSAGES[k].length).toBeGreaterThan(10)
    expect(linkStateFor('license')).toBe('license_problem')
    expect(linkStateFor('offline')).toBe('offline')
    expect(linkStateFor('timeout')).toBe('offline')
    expect(linkStateFor('server')).toBe('server_problem')
  })
})
