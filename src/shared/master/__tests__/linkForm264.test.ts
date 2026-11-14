import { describe, expect, it } from 'vitest'
import { canOfferLink, seatStatusLine, validateLinkForm } from '../linkForm'

const jwt = (role: string): string => `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.${'s'.repeat(24)}`
const OK = { enrolToken: 'tok-1234567890', label: 'Acme Traders', serviceRoleKey: 'x'.repeat(40) }

describe('Phase 264 link form', () => {
  it('accepts a complete form', () => { expect(validateLinkForm(OK)).toEqual({}) })
  it('asks for each empty field in plain words', () => {
    const e = validateLinkForm({ enrolToken: ' ', label: '', serviceRoleKey: '' })
    expect(Object.keys(e).sort()).toEqual(['enrolToken', 'label', 'serviceRoleKey'])
  })
  it('refuses a too-short key and the anon key pasted by mistake, accepts a service_role key', () => {
    expect(validateLinkForm({ ...OK, serviceRoleKey: 'short' }).serviceRoleKey).toMatch(/does not look right/)
    expect(validateLinkForm({ ...OK, serviceRoleKey: jwt('anon') }).serviceRoleKey).toMatch(/anon/)
    expect(validateLinkForm({ ...OK, serviceRoleKey: jwt('service_role') })).toEqual({})
  })
  it('error words never echo the typed key', () => {
    const key = 'SECRETKEY-' + 'z'.repeat(30)
    expect(JSON.stringify(validateLinkForm({ ...OK, serviceRoleKey: key, label: 'x'.repeat(90) }))).not.toContain('SECRETKEY')
  })
  it('offers the wizard only to an unlinked, signed-in seat 1 on a configured build', () => {
    const base = { configured: true, linked: false, sharedActive: true, sharedSeatNo: 1 }
    expect(canOfferLink(base)).toBe(true)
    expect(canOfferLink({ ...base, sharedSeatNo: 2 })).toBe(false)
    expect(canOfferLink({ ...base, sharedSeatNo: null })).toBe(false)
    expect(canOfferLink({ ...base, sharedActive: false })).toBe(false)
    expect(canOfferLink({ ...base, linked: true })).toBe(false)
    expect(canOfferLink({ ...base, configured: false })).toBe(false)
  })
  it('status line', () => {
    expect(seatStatusLine(null)).toBe('Not linked to master')
    expect(seatStatusLine({ linked: false, seatNo: null, companyLabel: null })).toBe('Not linked to master')
    expect(seatStatusLine({ linked: true, seatNo: 3, companyLabel: 'Acme' })).toBe('Linked as seat 3 of Acme')
  })
})
