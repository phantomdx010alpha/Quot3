import { describe, expect, it } from 'vitest'
import {
  COMPANY_MASTER_DEFAULTS, MASTER_LOGO_SIDES, NO_OVERRIDES, checkProfileSizes, diffProfile, effectiveProfile, fitLogoForMaster, overrideKey,
  overridesAfterEdit, readOverrides, readStoredMaster, storedFromView, validMasterLogoBase64, type StoredMasterProfile
} from '../profile'
import { LOGO_MAX_BYTES, PROFILE_TEXT_MAX } from '../schemas'

/** A synthetic PNG: real signature + IHDR (width, height) and padding to `size` bytes. No private data. */
function png(width: number, height: number, size = 64): Uint8Array {
  const b = new Uint8Array(Math.max(size, 33))
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const dv = new DataView(b.buffer)
  dv.setUint32(16, width); dv.setUint32(20, height)
  return b
}
const jpeg = (): Uint8Array => { const b = new Uint8Array(64); b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 10, 3]); return b }
const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64')

const master: StoredMasterProfile = { version: 3, name: 'Master Co', phone: '111', address: 'Master Road', logoFile: 'company-logo-master.png' }
const local = { logo: 'company-logo.png', name: 'Local Co', phone: '999', address: 'Local Street' }

describe('effectiveProfile precedence (Phase 270)', () => {
  it('no master default: the local record exactly as before (nothing changes for an unlinked company)', () => {
    const e = effectiveProfile(null, local, { ...NO_OVERRIDES, name: true })
    expect({ name: e.name, phone: e.phone, address: e.address, logo: e.logo }).toEqual(local)
    expect(Object.values(e.sources).every((s) => s === 'local')).toBe(true)
  })
  it('master default, no override: every field comes from the master', () => {
    const e = effectiveProfile(master, local, NO_OVERRIDES)
    expect(e).toMatchObject({ name: 'Master Co', phone: '111', address: 'Master Road', logo: 'company-logo-master.png' })
    expect(Object.values(e.sources).every((s) => s === 'master')).toBe(true)
  })
  it('an override wins for that field only', () => {
    const e = effectiveProfile(master, local, { ...NO_OVERRIDES, phone: true })
    expect(e.phone).toBe('999'); expect(e.sources.phone).toBe('local')
    expect(e.name).toBe('Master Co'); expect(e.address).toBe('Master Road')
  })
  it('a logo override with no local logo means "no logo" on this PC', () => {
    const e = effectiveProfile(master, { ...local, logo: '' }, { ...NO_OVERRIDES, logo: true })
    expect(e.logo).toBe('')
  })
  it('an override survives a master update for the other fields only', () => {
    const flags = { ...NO_OVERRIDES, name: true }
    const v4: StoredMasterProfile = { ...master, version: 4, name: 'New Master', phone: '222' }
    const e = effectiveProfile(v4, local, flags)
    expect(e.name).toBe('Local Co')
    expect(e.phone).toBe('222')
  })
  it('clearing an override returns the master value', () => {
    expect(effectiveProfile(master, local, { ...NO_OVERRIDES, name: true }).name).toBe('Local Co')
    expect(effectiveProfile(master, local, NO_OVERRIDES).name).toBe('Master Co')
  })
  it('offline keeps the last stored default (the stored value is simply read again)', () => {
    const stored = readStoredMaster(JSON.parse(JSON.stringify(master)))
    expect(effectiveProfile(stored, local, NO_OVERRIDES).name).toBe('Master Co')
  })
})

describe('storage helpers', () => {
  it('overrideKey and defaults', () => {
    expect(overrideKey('logo')).toBe('company.override.logo')
    expect(COMPANY_MASTER_DEFAULTS['company.master']).toBeNull()
    expect(COMPANY_MASTER_DEFAULTS['company.override.name']).toBe(false)
  })
  it('readOverrides takes only real true values', () => {
    expect(readOverrides({ 'company.override.name': true, 'company.override.phone': 'yes', 'company.override.logo': 1 })).toEqual({ name: true, phone: false, address: false, logo: false })
  })
  it('readStoredMaster tolerates corrupt rows and bad logo names', () => {
    expect(readStoredMaster(null)).toBeNull()
    expect(readStoredMaster('x')).toBeNull()
    expect(readStoredMaster({ version: -1 })).toBeNull()
    expect(readStoredMaster({ version: 2, name: 5, logoFile: '../evil.png' })).toEqual({ version: 2, name: '', phone: '', address: '', logoFile: '' })
  })
  it('storedFromView keeps no logo file when the master has none', () => {
    const view = { version: 5, name: 'A', phone: 'B', address: 'C', logo: null }
    expect(storedFromView(view, 'company-logo-master.png').logoFile).toBe('')
    expect(storedFromView({ ...view, logo: 'AAAA' }, 'company-logo-master.png').logoFile).toBe('company-logo-master.png')
  })
})

describe('diffProfile and overridesAfterEdit', () => {
  it('lists the differing fields', () => {
    expect(diffProfile({ name: 'a', phone: 'b', address: 'c', logo: null }, { name: 'a', phone: 'x', address: 'c', logo: 'L' })).toEqual(['phone', 'logo'])
    expect(diffProfile({ name: 'a', phone: 'b', address: 'c', logo: null }, { name: 'a', phone: 'b', address: 'c', logo: '' })).toEqual([])
  })
  it('a changed field gets its flag; an unchanged one gets none', () => {
    expect(overridesAfterEdit(master, { name: 'Mine', phone: '111', address: 'Master Road' }, NO_OVERRIDES)).toEqual({ name: true })
  })
  it('typing the default value back drops the flag', () => {
    expect(overridesAfterEdit(master, { name: 'Master Co', phone: '111', address: 'Master Road' }, { ...NO_OVERRIDES, name: true })).toEqual({ name: false })
  })
  it('no change = no flag change', () => {
    expect(overridesAfterEdit(master, { name: 'Master Co', phone: '111', address: 'Master Road' }, NO_OVERRIDES)).toEqual({})
  })
})

describe('size limits and the logo rule', () => {
  it('text over 200 characters is refused with the field named', () => {
    expect(checkProfileSizes({ name: 'a'.repeat(PROFILE_TEXT_MAX), phone: '', address: '' })).toEqual({ ok: true })
    const r = checkProfileSizes({ name: 'a', phone: '', address: 'x'.repeat(PROFILE_TEXT_MAX + 1) })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.field).toBe('address'); expect(r.message).toContain('200') }
  })
  it('a small PNG is kept as it is', () => {
    const p = png(200, 100, 5000)
    expect(fitLogoForMaster(p, () => { throw new Error('must not resize') })).toBe(p)
  })
  it('a JPEG or an over-size PNG is re-encoded until it fits', () => {
    const calls: number[] = []
    const out = fitLogoForMaster(jpeg(), (_b, side) => { calls.push(side); return side <= 256 ? png(100, 100, 2000) : png(100, 100, LOGO_MAX_BYTES + 10) })
    expect(out).not.toBeNull()
    expect(calls).toEqual([512, 384, 256])
    const big = png(1000, 1000, LOGO_MAX_BYTES + 1)
    expect(fitLogoForMaster(big, () => png(10, 10, 1000))).not.toBeNull()
  })
  it('refuses when nothing fits, when the encoder fails, or when the file is not an image', () => {
    expect(fitLogoForMaster(jpeg(), () => png(100, 100, LOGO_MAX_BYTES + 1))).toBeNull()
    expect(fitLogoForMaster(jpeg(), () => { throw new Error('x') })).toBeNull()
    expect(fitLogoForMaster(new Uint8Array(100), () => png(10, 10))).toBeNull()
    expect(MASTER_LOGO_SIDES.length).toBeGreaterThan(2)
  })
  it('a downloaded logo must be a PNG within 150 KB', () => {
    expect(validMasterLogoBase64(b64(png(10, 10, 100)))).toBe(true)
    expect(validMasterLogoBase64(b64(jpeg()))).toBe(false)
    expect(validMasterLogoBase64('')).toBe(false)
    expect(validMasterLogoBase64(b64(png(10, 10, LOGO_MAX_BYTES + 100)))).toBe(false)
  })
})
