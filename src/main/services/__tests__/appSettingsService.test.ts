import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBranchRepo } from '../../db/branchRepo'
import { createSettingsRepo } from '../../db/settingsRepo'
import { allocatePoNumber } from '../../db/poCounter'
import { getLocalBranch } from '../../db/seed'
import { createSettingsService } from '../settingsService'
import { createAppSettingsService, type SettingsPorts } from '../appSettingsService'
import { createPrintService, type PrintPort } from '../printService'
import { appSettingsHandlers } from '../../ipc/appSettings'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { jpegBytes, pngBytes } from '../../../shared/settings/__tests__/imageBytes'

const open: TestDb[] = []
const dirs: string[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()); dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

function mk(opts: { writable?: boolean; pick?: string | null } = {}) {
  const t = openTestDb()
  open.push(t)
  const dir = mkdtempSync(join(tmpdir(), 'q3-set-'))
  dirs.push(dir)
  const assets = join(dir, 'assets')
  const settings = createSettingsService(createSettingsRepo(t.handle.sqlite))
  const picked = { file: opts.pick ?? null }
  const ports: SettingsPorts = { pickLogo: async () => picked.file, listPrinters: async () => ['HP LaserJet', 'PDF'] }
  const svc = createAppSettingsService({ settings, branches: createBranchRepo(t.handle.sqlite), assetsDir: assets, ports }, { ...(opts.writable === false ? { writable: false } : {}) })
  return { t, svc, settings, dir, assets, picked }
}
const write = (dir: string, name: string, bytes: Uint8Array): string => { const f = join(dir, name); writeFileSync(f, bytes); return f }

describe('appSettingsService', () => {
  it('first read: defaults, local branch with prefix Q3- and next PO Q3-0001', () => {
    const { svc } = mk()
    const s = svc.get()
    expect(s.company).toEqual({ logo: '', name: '', phone: '', address: '', logoDataUrl: '' })
    expect(s.branch).toMatchObject({ prefix: 'Q3-', nextSeq: 1, nextPo: 'Q3-0001', otherPrefixes: [] })
    expect(s.print).toEqual({ rupeeOnTotal: true, silent: false, printer: '' })
    expect(s.behaviour).toEqual({ trashRetentionDays: 30, leftUnlockPresses: 2, autosaveSeconds: 2 })
    expect(s.image).toEqual({ scale: 4 }) // Phase 72
    expect(s.nav).toEqual({ smoothArrows: true }) // Phase 75: default ON
    expect(s.calc).toEqual({ roundOff: true, percentPresets: '18, 5, 3' }) // Phase 77: default ON; Phase 82: default presets
  })

  it('Phase 72 image quality: saved to image.scale and read back; fractional / out-of-range refused and nothing changes', () => {
    const { svc, settings } = mk()
    expect(svc.saveImage({ scale: 5 }).image).toEqual({ scale: 5 })
    expect(settings.get('image.scale')).toBe(5)
    expect(() => svc.saveImage({ scale: 6 })).toThrow('2 to 5')
    expect(() => svc.saveImage({ scale: 3.5 })).toThrow('2 to 5')
    expect(settings.get('image.scale')).toBe(5)
  })

  it('Phase 77 round off: default ON, saved to calc.roundOff, read back; a non-boolean is refused', () => {
    const { svc, settings } = mk()
    expect(svc.saveCalc({ roundOff: false }).calc).toMatchObject({ roundOff: false })
    expect(settings.get('calc.roundOff')).toBe(false)
    expect(svc.saveCalc({ roundOff: true }).calc).toMatchObject({ roundOff: true })
    expect(() => svc.saveCalc({ roundOff: 1 as never })).toThrow('on or off')
    expect(settings.get('calc.roundOff')).toBe(true)
  })

  it('Phase 82 percent presets: default, saved canonical, blank = default, bad / too many refused, round off untouched', () => {
    const { svc, settings } = mk()
    expect(svc.saveCalc({ percentPresets: '12, 5.50 ,28,5.5' }).calc.percentPresets).toBe('12, 5.5, 28')
    expect(settings.get('calc.percentPresets')).toBe('12, 5.5, 28')
    expect(svc.saveCalc({ percentPresets: '' }).calc.percentPresets).toBe('18, 5, 3')
    expect(() => svc.saveCalc({ percentPresets: '0' })).toThrow()
    expect(() => svc.saveCalc({ percentPresets: '1001' })).toThrow()
    expect(() => svc.saveCalc({ percentPresets: '1,2,3,4,5,6,7,8,9' })).toThrow()
    expect(() => svc.saveCalc({})).toThrow()
    expect(svc.get().calc.roundOff).toBe(true)
    expect(svc.saveCalc({ roundOff: false }).calc.percentPresets).toBe('18, 5, 3')
  })

  it('Phase 75 smooth arrows: default ON, saved to nav.smoothArrows, read back; a non-boolean is refused', () => {
    const { svc, settings } = mk()
    expect(svc.saveNav({ smoothArrows: false }).nav).toEqual({ smoothArrows: false })
    expect(settings.get('nav.smoothArrows')).toBe(false)
    expect(svc.saveNav({ smoothArrows: true }).nav).toEqual({ smoothArrows: true })
    expect(() => svc.saveNav({ smoothArrows: 'no' as never })).toThrow('on or off')
    expect(settings.get('nav.smoothArrows')).toBe(true)
  })

  it('saves the company profile and the print settings read it (name, phone, address)', () => {
    const { svc, settings } = mk()
    const s = svc.saveCompany({ name: ' Acme  Traders ', phone: '98765', address: '1 Road\nPune' })
    expect(s.company).toMatchObject({ name: 'Acme Traders', phone: '98765', address: '1 Road\nPune' })
    expect(settings.get('company.profile')).toMatchObject({ name: 'Acme Traders' })
    expect(() => svc.saveCompany({ name: ' ', phone: '', address: '' })).toThrow('Enter your company name.')
    expect(svc.get().company.name).toBe('Acme Traders')
  })

  it('logo: a PNG is checked, copied to assets/, shown as a data URL; a JPEG replaces it; remove deletes the file', async () => {
    const m = mk()
    m.svc.saveCompany({ name: 'Acme', phone: '', address: '' })
    m.picked.file = write(m.dir, 'a.png', pngBytes(300, 100))
    const r = await m.svc.chooseLogo()
    expect(r.cancelled).toBe(false)
    expect(r.state.company.logo).toBe('company-logo.png')
    expect(r.state.company.logoDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(readdirSync(m.assets)).toEqual(['company-logo.png'])

    m.picked.file = write(m.dir, 'b.jpeg', jpegBytes(400, 150))
    const r2 = await m.svc.chooseLogo()
    expect(r2.state.company.logo).toBe('company-logo.jpg')
    expect(readdirSync(m.assets)).toEqual(['company-logo.jpg'])
    expect(m.svc.saveCompany({ name: 'Acme 2', phone: '', address: '' }).company.logo).toBe('company-logo.jpg')

    const s3 = m.svc.removeLogo()
    expect(s3.company.logo).toBe('')
    expect(readdirSync(m.assets)).toEqual([])
  })

  it('logo: cancelled dialog changes nothing; bad files are refused with a reason and the old logo stays', async () => {
    const m = mk()
    m.picked.file = write(m.dir, 'ok.png', pngBytes(200, 80))
    await m.svc.chooseLogo()
    m.picked.file = null
    expect((await m.svc.chooseLogo()).cancelled).toBe(true)
    // An SVG renamed .png is refused by its bytes, not its name.
    m.picked.file = write(m.dir, 'fake.png', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>'))
    await expect(m.svc.chooseLogo()).rejects.toThrow('PNG or JPEG')
    m.picked.file = write(m.dir, 'big.png', pngBytes(200, 80, 600 * 1024))
    await expect(m.svc.chooseLogo()).rejects.toThrow('512 KB')
    m.picked.file = join(m.dir, 'missing.png')
    await expect(m.svc.chooseLogo()).rejects.toThrow('Could not read')
    expect(m.svc.get().company.logo).toBe('company-logo.png')
    expect(existsSync(join(m.assets, 'company-logo.png'))).toBe(true)
  })

  it('PO prefix: changes the NEXT bill only, keeps the counter, writes one audit row, refuses bad / clashing prefixes', () => {
    const { t, svc } = mk()
    const sqlite = t.handle.sqlite
    const branch = getLocalBranch(sqlite)
    expect(allocatePoNumber(sqlite, branch.id).poNumber).toBe('Q3-0001')
    expect(allocatePoNumber(sqlite, branch.id).poNumber).toBe('Q3-0002')
    const s = svc.savePrefix(' pune/ ')
    expect(s.branch).toMatchObject({ prefix: 'PUNE/', nextSeq: 3, nextPo: 'PUNE/0003' })
    expect(allocatePoNumber(sqlite, branch.id).poNumber).toBe('PUNE/0003')
    expect(svc.savePrefix('PUNE/').branch?.prefix).toBe('PUNE/')
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'po_prefix'").get() as { n: number }).n).toBe(1)
    expect(() => svc.savePrefix('bad prefix')).toThrow()
    expect(() => svc.savePrefix('')).toThrow('Enter a prefix')
    // Another known branch uses MUM-: refused case-insensitively, and the DB unique index agrees.
    sqlite.prepare("INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES ('b2', 'Mumbai', 'MUM-', 0, 'x')").run()
    expect(svc.get().branch?.otherPrefixes).toEqual(['MUM-'])
    expect(() => svc.savePrefix('mum-')).toThrow('Another branch already uses MUM-.')
    expect(svc.get().branch?.prefix).toBe('PUNE/')
  })

  it('print defaults: saved and read back; silent needs a printer; printers come from the port', async () => {
    const { svc, settings } = mk()
    expect(() => svc.savePrint({ rupeeOnTotal: true, silent: true, printer: '' })).toThrow('printer')
    const s = svc.savePrint({ rupeeOnTotal: false, silent: true, printer: ' HP LaserJet ' })
    expect(s.print).toEqual({ rupeeOnTotal: false, silent: true, printer: 'HP LaserJet' })
    expect(settings.get('print.printer')).toBe('HP LaserJet')
    expect(await svc.printers()).toEqual(['HP LaserJet', 'PDF'])
  })

  it('behaviour: saved to the keys the rest of the app reads; out-of-range refused and nothing half-saved', () => {
    const { svc, settings } = mk()
    const s = svc.saveBehaviour({ trashRetentionDays: 7, leftUnlockPresses: 1, autosaveSeconds: 10 })
    expect(s.behaviour).toEqual({ trashRetentionDays: 7, leftUnlockPresses: 1, autosaveSeconds: 10 })
    expect(settings.get('trash.retentionDays')).toBe(7)
    expect(() => svc.saveBehaviour({ trashRetentionDays: 7, leftUnlockPresses: 9, autosaveSeconds: 10 })).toThrow('whole number')
    expect(settings.get('trash.retentionDays')).toBe(7)
  })

  it('a read-only database refuses every save', async () => {
    const m = mk({ writable: false })
    expect(m.svc.get().readOnly).toBe(true)
    expect(() => m.svc.saveCompany({ name: 'A', phone: '', address: '' })).toThrow('read-only')
    expect(() => m.svc.savePrefix('AB-')).toThrow('read-only')
    expect(() => m.svc.savePrint({ rupeeOnTotal: true, silent: false, printer: '' })).toThrow('read-only')
    expect(() => m.svc.saveBehaviour({ trashRetentionDays: 7, leftUnlockPresses: 1, autosaveSeconds: 10 })).toThrow('read-only')
    await expect(m.svc.chooseLogo()).rejects.toThrow('read-only')
  })

  it('logoDataUrl only reads the two fixed file names inside assets/', () => {
    const m = mk()
    expect(m.svc.logoDataUrl('../x.png')).toBe('')
    expect(m.svc.logoDataUrl('company-logo.png')).toBe('')
    expect(m.svc.logoDataUrl('company-logo.svg')).toBe('')
  })

  it('IPC: strict validation, a refusal comes back as VALIDATION, round trip works', async () => {
    const m = mk()
    const h = appSettingsHandlers(m.svc)
    for (const [ch, bad] of [['appSettings:get', { x: 1 }], ['appSettings:saveCompany', { name: 'A', phone: '', address: '', extra: 1 }], ['appSettings:saveCompany', {}], ['appSettings:savePrefix', { prefix: 5 }], ['appSettings:savePrint', { rupeeOnTotal: 'yes', silent: false, printer: '' }], ['appSettings:saveBehaviour', { trashRetentionDays: '7', leftUnlockPresses: 1, autosaveSeconds: 2 }]] as const) {
      expect(await h[ch]!(bad)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    }
    expect(await h['appSettings:saveCompany']!({ name: '', phone: '', address: '' })).toMatchObject({ ok: false, error: { code: 'VALIDATION', message: 'Enter your company name.' } })
    expect(await h['appSettings:savePrefix']!({ prefix: 'zz-' })).toMatchObject({ ok: true, data: { branch: { prefix: 'ZZ-' } } })
    expect(await h['appSettings:printers']!({})).toEqual({ ok: true, data: { printers: ['HP LaserJet', 'PDF'] } })
  })

  it('feeds the Professional print: the saved company and its logo end up in the rendered HTML; a changed name changes it', async () => {
    const m = mk()
    m.svc.saveCompany({ name: 'Acme Traders', phone: '98765', address: '1 Road' })
    m.picked.file = write(m.dir, 'a.png', pngBytes(300, 100))
    await m.svc.chooseLogo()
    const port: PrintPort = { measure: async () => 0, print: async () => ({ ok: true }), toPdf: async () => new Uint8Array() }
    const print = createPrintService({ port, settings: m.settings, logoDataUrl: m.svc.logoDataUrl, resourcesRoot: m.dir })
    const bill = { ...printFixture('legacy'), poNumber: 'Q3-0001' }
    const a = await print.resolveOutput({ bill, mode: 'professional' })
    expect(a.html).toContain('Acme Traders')
    expect(a.html).toContain('98765')
    expect(a.html).toContain('data:image/png;base64,')
    m.svc.saveCompany({ name: 'Zenith Exports', phone: '98765', address: '1 Road' })
    const b = await print.resolveOutput({ bill, mode: 'professional' })
    expect(b.html).toContain('Zenith Exports')
    expect(b.html).not.toContain('Acme Traders')
    m.svc.removeLogo()
    const c = await print.resolveOutput({ bill, mode: 'professional' })
    expect(c.html).not.toContain('data:image/png;base64,')
  })
})
