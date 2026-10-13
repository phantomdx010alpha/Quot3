import { describe, expect, it } from 'vitest'
import {
  LOGO_MAX_BYTES, normalizePoPrefix, previewPo, readBehaviour, readCompany, sniffImage, validateBehaviour, validateCompany, validateLogoBytes, validatePoPrefix, validatePrintDefaults
} from '../appSettings'
import { jpegBytes, pngBytes } from './imageBytes'

describe('company profile', () => {
  it('requires a name, collapses whitespace, keeps address lines', () => {
    expect(validateCompany({ name: '   ', phone: '', address: '' })).toMatchObject({ ok: false, field: 'name' })
    const r = validateCompany({ name: '  Acme   Traders ', phone: ' 98765  43210 ', address: ' 12 Main St \r\n\r\n  Pune   411001 ' })
    expect(r).toEqual({ ok: true, value: { name: 'Acme Traders', phone: '98765 43210', address: '12 Main St\nPune 411001' } })
  })
  it('refuses over-long fields instead of cutting them', () => {
    expect(validateCompany({ name: 'x'.repeat(201), phone: '', address: '' })).toMatchObject({ ok: false, field: 'name' })
    expect(validateCompany({ name: 'A', phone: '9'.repeat(101), address: '' })).toMatchObject({ ok: false, field: 'phone' })
    expect(validateCompany({ name: 'A', phone: '', address: 'a'.repeat(501) })).toMatchObject({ ok: false, field: 'address' })
    expect(validateCompany({ name: 'A', phone: '', address: 'a'.repeat(500) }).ok).toBe(true)
    expect(validateCompany({ name: 5, phone: null, address: undefined })).toMatchObject({ ok: false, field: 'name' })
  })
  it('reads a corrupt stored value as empty and rejects unsafe logo names', () => {
    expect(readCompany(null)).toEqual({ logo: '', name: '', phone: '', address: '' })
    expect(readCompany('x')).toEqual({ logo: '', name: '', phone: '', address: '' })
    expect(readCompany({ logo: '../../evil.png', name: 'A' }).logo).toBe('')
    expect(readCompany({ logo: 'data:image/png;base64,AAAA', name: 'A' }).logo).toBe('')
    expect(readCompany({ logo: 'company-logo.png', name: 'A', phone: 7 })).toEqual({ logo: 'company-logo.png', name: 'A', phone: '', address: '' })
  })
})

describe('logo file checks', () => {
  it('reads real PNG / JPEG sizes from the bytes', () => {
    expect(sniffImage(pngBytes(300, 120))).toEqual({ ext: 'png', mime: 'image/png', width: 300, height: 120 })
    expect(sniffImage(jpegBytes(640, 200))).toEqual({ ext: 'jpg', mime: 'image/jpeg', width: 640, height: 200 })
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
  })
  it('accepts a normal logo and refuses empty, huge, wrong type, tiny and oversized images', () => {
    expect(validateLogoBytes(pngBytes(300, 120)).ok).toBe(true)
    expect(validateLogoBytes(jpegBytes(300, 120)).ok).toBe(true)
    expect(validateLogoBytes(new Uint8Array())).toMatchObject({ ok: false })
    const big = validateLogoBytes(pngBytes(300, 120, LOGO_MAX_BYTES))
    expect(big).toMatchObject({ ok: false })
    expect(!big.ok && big.message).toMatch(/512 KB/)
    expect(validateLogoBytes(new TextEncoder().encode('GIF89a......................'))).toMatchObject({ ok: false, message: 'The logo must be a PNG or JPEG image.' })
    expect(validateLogoBytes(pngBytes(8, 8))).toMatchObject({ ok: false })
    const wide = validateLogoBytes(pngBytes(2001, 100))
    expect(!wide.ok && wide.message).toMatch(/2000 px/)
    expect(validateLogoBytes(pngBytes(2000, 2000)).ok).toBe(true)
  })
})

describe('PO prefix', () => {
  it('normalises to capitals and previews the next number', () => {
    expect(normalizePoPrefix('  q3- ')).toBe('Q3-')
    expect(previewPo('Q3-', 7)).toBe('Q3-0007')
    expect(previewPo('PUNE/', 12)).toBe('PUNE/0012')
  })
  it('accepts valid prefixes', () => {
    for (const p of ['Q3-', 'a', 'BR2_', 'PUNE/', '12345678']) expect(validatePoPrefix(p, []).ok).toBe(true)
    expect(validatePoPrefix('br-', [])).toEqual({ ok: true, prefix: 'BR-' })
  })
  it('refuses empty, too long, bad characters and a clash with another branch (case-insensitive)', () => {
    expect(validatePoPrefix('   ', [])).toMatchObject({ ok: false })
    expect(validatePoPrefix('123456789', [])).toMatchObject({ ok: false, message: expect.stringContaining('8') })
    for (const p of ['A B', 'A.B', '-A', 'Q3 4', 'Ä-', '<b>']) expect(validatePoPrefix(p, []).ok).toBe(false)
    expect(validatePoPrefix('mum-', ['Q3-', 'MUM-'])).toEqual({ ok: false, message: 'Another branch already uses MUM-.' })
  })
})

describe('behaviour and print defaults', () => {
  it('reads defaults for anything missing, fractional or out of range', () => {
    expect(readBehaviour({})).toEqual({ trashRetentionDays: 30, leftUnlockPresses: 2, autosaveSeconds: 2 })
    expect(readBehaviour({ 'trash.retentionDays': 0, 'behaviour.leftUnlockPresses': 2.5, 'behaviour.autosaveSeconds': '5' })).toEqual({ trashRetentionDays: 30, leftUnlockPresses: 2, autosaveSeconds: 2 })
    expect(readBehaviour({ 'trash.retentionDays': 365, 'behaviour.leftUnlockPresses': 1, 'behaviour.autosaveSeconds': 30 })).toEqual({ trashRetentionDays: 365, leftUnlockPresses: 1, autosaveSeconds: 30 })
  })
  it('saves only whole numbers inside the ranges, naming the field', () => {
    expect(validateBehaviour({ trashRetentionDays: 14, leftUnlockPresses: 3, autosaveSeconds: 5 })).toEqual({ ok: true, value: { trashRetentionDays: 14, leftUnlockPresses: 3, autosaveSeconds: 5 } })
    expect(validateBehaviour({ trashRetentionDays: 366, leftUnlockPresses: 2, autosaveSeconds: 2 })).toMatchObject({ ok: false, field: 'trashRetentionDays' })
    expect(validateBehaviour({ trashRetentionDays: 30, leftUnlockPresses: 4, autosaveSeconds: 2 })).toMatchObject({ ok: false, field: 'leftUnlockPresses' })
    expect(validateBehaviour({ trashRetentionDays: 30, leftUnlockPresses: 2, autosaveSeconds: Number.NaN })).toMatchObject({ ok: false, field: 'autosaveSeconds' })
    expect(validateBehaviour({ trashRetentionDays: 1.5, leftUnlockPresses: 2, autosaveSeconds: 2 })).toMatchObject({ ok: false, field: 'trashRetentionDays' })
  })
  it('silent printing needs a printer', () => {
    expect(validatePrintDefaults({ rupeeOnTotal: true, silent: true, printer: '  ' })).toMatchObject({ ok: false, field: 'printer' })
    expect(validatePrintDefaults({ rupeeOnTotal: false, silent: true, printer: ' HP LaserJet ' })).toEqual({ ok: true, value: { rupeeOnTotal: false, silent: true, printer: 'HP LaserJet' } })
    expect(validatePrintDefaults({ rupeeOnTotal: undefined, silent: false, printer: '' })).toEqual({ ok: true, value: { rupeeOnTotal: true, silent: false, printer: '' } })
  })
})

describe('Phase 75 - smooth arrows setting', () => {
  it('defaults ON; only an explicit false turns it off', async () => {
    const { readSmoothArrows, NAV_SMOOTH_ARROWS_KEY } = await import('../appSettings')
    expect(NAV_SMOOTH_ARROWS_KEY).toBe('nav.smoothArrows')
    expect(readSmoothArrows({})).toBe(true)
    expect(readSmoothArrows({ 'nav.smoothArrows': 'junk' })).toBe(true)
    expect(readSmoothArrows({ 'nav.smoothArrows': false })).toBe(false)
  })
})
