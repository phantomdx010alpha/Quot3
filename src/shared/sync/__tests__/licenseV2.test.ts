import { describe, expect, it } from 'vitest'
import {
  SHARED_MESSAGES, SHARED_SQLSTATE_KIND, classifySharedFailure, maskEmail, sharedKindToErrorCode, sharedLinkStateFor, validateAnonKey, validateBranchName,
  validateEmail, validateSeatPassword, type SharedErrorKind
} from '../license'

describe('shared-notebook sign-in rules (Phase 132)', () => {
  it('validates the e-mail shape and lower-cases it', () => {
    expect(validateEmail('  Seat1@Example.COM ')).toEqual({ ok: true, value: 'seat1@example.com' })
    for (const bad of ['', 'nope', 'a@b', 'a b@c.d', 'x'.repeat(260) + '@a.bc']) expect(validateEmail(bad).ok).toBe(false)
  })
  it('keeps the seat password exactly as typed (no trimming)', () => {
    expect(validateSeatPassword(' pa ss ')).toEqual({ ok: true, value: ' pa ss ' })
    expect(validateSeatPassword('').ok).toBe(false)
    expect(validateSeatPassword('x'.repeat(300)).ok).toBe(false)
  })
  it('normalises the branch name like the server does (trim, collapse spaces, 80 max)', () => {
    expect(validateBranchName('  Main   shop ')).toEqual({ ok: true, value: 'Main shop' })
    expect(validateBranchName('   ').ok).toBe(false)
    expect(validateBranchName('x'.repeat(81)).ok).toBe(false)
  })
  it('masks the e-mail', () => {
    expect(maskEmail('seat1@example.com')).toBe('s***@example.com')
    expect(maskEmail('nonsense')).toBe('****')
  })
  it('still refuses a service_role anon key', () => {
    const body = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')
    expect(validateAnonKey(`aaa.${body}.ccc`).ok).toBe(false)
  })
})

describe('failure classification (Phase 132)', () => {
  const k = (f: Parameters<typeof classifySharedFailure>[0]): SharedErrorKind => classifySharedFailure(f)
  it('maps every SQLSTATE the v2 RPCs raise', () => {
    for (const [code, kind] of Object.entries(SHARED_SQLSTATE_KIND)) expect(k({ status: 400, code })).toBe(kind)
    expect(Object.keys(SHARED_SQLSTATE_KIND).sort()).toEqual(['Q3A01', 'Q3B02', 'Q3B03', 'Q3B04', 'Q3B05', 'Q3I01', 'Q3I03', 'Q3L01', 'Q3M01', 'Q3R01'])
  })
  it('keeps a paused server apart from offline', () => {
    expect(k({ status: 540 })).toBe('server_paused')
    expect(k({ status: 503, message: 'Project is paused' })).toBe('server_paused')
    expect(k({ network: true })).toBe('offline')
    expect(k({ timeout: true })).toBe('timeout')
    expect(k({ status: 500 })).toBe('server')
  })
  it('auth failures: bad login, expired token, banned user', () => {
    expect(k({ auth: true, status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('auth_failed')
    expect(k({ status: 401, message: 'JWT expired' })).toBe('auth_failed')
    expect(k({ auth: true, status: 400, code: 'user_banned' })).toBe('auth_failed')
    expect(k({ auth: true, status: 502 })).toBe('server')
  })
  it('a wrong anon key and a missing function are told apart from auth', () => {
    expect(k({ status: 401, message: 'Invalid API key' })).toBe('anon_key')
    expect(k({ status: 404, code: 'PGRST202' })).toBe('not_installed')
  })
  it('every kind has a plain message, no secrets placeholders, and an IPC code', () => {
    for (const kind of Object.keys(SHARED_MESSAGES) as SharedErrorKind[]) {
      expect(SHARED_MESSAGES[kind].length).toBeGreaterThan(10)
      expect(['AUTH_FAILED', 'LICENSE_INVALID', 'SERVER_PAUSED', 'SYNC_OFFLINE', 'VALIDATION']).toContain(sharedKindToErrorCode(kind))
      expect(['license_problem', 'offline', 'server_problem']).toContain(sharedLinkStateFor(kind))
    }
    expect(sharedKindToErrorCode('auth_failed')).toBe('AUTH_FAILED')
    expect(sharedKindToErrorCode('server_paused')).toBe('SERVER_PAUSED')
    expect(sharedKindToErrorCode('offline')).toBe('SYNC_OFFLINE')
  })
})
