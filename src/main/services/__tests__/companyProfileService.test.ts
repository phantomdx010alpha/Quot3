import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BranchRepo } from '../../db/branchRepo'
import { createAppSettingsService } from '../appSettingsService'
import { createCompanyProfileService, type CompanyMasterPort } from '../companyProfileService'
import type { SettingsService } from '../settingsService'
import { SETTING_DEFAULTS } from '../../../shared/settings'
import { MASTER_LOGO_FILE } from '../../../shared/master/profile'
import { LOGO_MAX_BYTES, type ProfileView } from '../../../shared/master/schemas'
import { pngBytes } from '../../../shared/settings/__tests__/imageBytes'

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

const b64 = (u: Uint8Array): string => Buffer.from(u).toString('base64')
const view = (version: number, over: Partial<ProfileView> = {}): ProfileView => ({ version, name: 'Master Co', phone: '111', address: 'Master Road', logo: b64(pngBytes(100, 100, 500)), ...over })

function mk(o: { linked?: boolean; admin?: boolean; fail?: boolean; encode?: (b: Uint8Array, side: number) => Uint8Array | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'q3-cp-'))
  dirs.push(dir)
  const assets = join(dir, 'assets')
  const store = new Map<string, unknown>()
  const settings: SettingsService = {
    get: (k) => (store.has(k) ? store.get(k) : SETTING_DEFAULTS[k] ?? null),
    set: (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))) },
    getAll: () => ({ ...SETTING_DEFAULTS, ...Object.fromEntries(store) })
  }
  const picked = { file: null as string | null }
  const app = createAppSettingsService({
    settings, branches: { local: () => null, otherPrefixes: () => [] } as unknown as BranchRepo, assetsDir: assets,
    ports: { pickLogo: async () => picked.file, listPrinters: async () => [] }
  })
  const st = { linked: o.linked ?? true, admin: o.admin ?? false, fail: o.fail ?? false }
  const calls: { name: string; phone: string; address: string; logo?: string | null }[] = []
  const master: CompanyMasterPort = {
    status: () => ({ linked: st.linked, isAdmin: st.admin }),
    profileSet: async (i) => {
      calls.push(i)
      if (st.fail) throw new Error('The master could not be reached. Try again.')
      return view(9, { name: i.name, phone: i.phone, address: i.address, logo: i.logo ?? null })
    }
  }
  const logs: string[] = []
  const svc = createCompanyProfileService({
    settings, app, assetsDir: assets, master: () => master, encodePng: o.encode ?? (() => null),
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) }
  })
  app.setDecorator(svc.decorate)
  const pick = (name: string, bytes: Uint8Array): void => { const f = join(dir, name); writeFileSync(f, bytes); picked.file = f }
  return { svc, app, settings, store, st, calls, assets, pick, logs }
}

describe('Phase 270 company profile service', () => {
  it('not linked: exactly the old behaviour, no master call, no extra state', async () => {
    const m = mk({ linked: false })
    const s = await m.svc.saveCompany({ name: 'Mine', phone: '1', address: 'A' })
    expect(s.company).toMatchObject({ name: 'Mine', phone: '1', address: 'A' })
    expect(s.companyMaster).toBeUndefined()
    expect(m.calls).toHaveLength(0)
    expect(m.svc.effective()).toMatchObject({ name: 'Mine' })
  })

  it('applyProfile stores the text and the logo file; get() shows the default for another seat', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1))
    expect(existsSync(join(m.assets, MASTER_LOGO_FILE))).toBe(true)
    const s = m.svc.get()
    expect(s.company).toMatchObject({ name: 'Master Co', phone: '111', address: 'Master Road', logo: MASTER_LOGO_FILE })
    expect(s.company.logoDataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(s.companyMaster).toMatchObject({ linked: true, isAdmin: false, version: 1, overrides: { name: false, phone: false, address: false, logo: false } })
  })

  it('an older profile never replaces a newer one; a profile without a logo removes the file', async () => {
    const m = mk()
    await m.svc.applyProfile(view(5))
    await m.svc.applyProfile(view(4, { name: 'Old' }))
    expect(m.svc.effective().name).toBe('Master Co')
    await m.svc.applyProfile(view(6, { logo: null }))
    expect(existsSync(join(m.assets, MASTER_LOGO_FILE))).toBe(false)
    expect(m.svc.effective().logo).toBe('')
  })

  it('a downloaded logo that is not a PNG is not written', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1, { logo: Buffer.from('not a png at all!!').toString('base64') }))
    expect(existsSync(join(m.assets, MASTER_LOGO_FILE))).toBe(false)
    expect(m.svc.effective().logo).toBe('')
  })

  it('a local edit sets only that field\'s override; it survives a master update for the other fields only', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1))
    const s = await m.svc.saveCompany({ name: 'Master Co', phone: '999', address: 'Master Road' })
    expect(s.companyMaster?.overrides).toEqual({ name: false, phone: true, address: false, logo: false })
    expect(s.company.phone).toBe('999')
    await m.svc.applyProfile(view(2, { name: 'New Master', phone: '222', address: 'New Road' }))
    const e = m.svc.effective()
    expect(e).toMatchObject({ name: 'New Master', phone: '999', address: 'New Road' })
    expect(e.sources).toMatchObject({ name: 'master', phone: 'local', address: 'master' })
  })

  it('"Use company default" clears the override; typing the default back also drops it', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1))
    await m.svc.saveCompany({ name: 'Mine', phone: '111', address: 'Master Road' })
    expect(m.svc.get().companyMaster?.overrides.name).toBe(true)
    const s = m.svc.useDefault('name')
    expect(s.companyMaster?.overrides.name).toBe(false)
    expect(s.company.name).toBe('Master Co')
    await m.svc.saveCompany({ name: 'Mine again', phone: '111', address: 'Master Road' })
    const back = await m.svc.saveCompany({ name: 'Master Co', phone: '111', address: 'Master Road' })
    expect(back.companyMaster?.overrides.name).toBe(false)
  })

  it('another seat\'s logo change / removal is an override of the logo; the default comes back with "Use company default"', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1))
    m.pick('mine.png', pngBytes(120, 120, 800))
    const c = await m.svc.chooseLogo()
    expect(c.cancelled).toBe(false)
    expect(c.state.companyMaster?.overrides.logo).toBe(true)
    expect(c.state.company.logo).toBe('company-logo.png')
    expect(m.svc.useDefault('logo').company.logo).toBe(MASTER_LOGO_FILE)
    const r = await m.svc.removeLogo()
    expect(r.companyMaster?.overrides.logo).toBe(true)
    expect(r.company.logo).toBe('')
  })

  it('linked but no default downloaded yet: plain behaviour, nothing is flagged', async () => {
    const m = mk()
    const s = await m.svc.saveCompany({ name: 'Mine', phone: '', address: '' })
    expect(s.company.name).toBe('Mine')
    expect(s.companyMaster?.overrides.name).toBe(false)
    expect(s.companyMaster?.default).toBeNull()
  })

  it('seat 1: saves on this PC, then publishes; the master answer is not required for the local save', async () => {
    const m = mk({ admin: true })
    const s = await m.svc.saveCompany({ name: 'Boss Co', phone: '12345', address: 'Main St' })
    expect(m.calls).toEqual([{ name: 'Boss Co', phone: '12345', address: 'Main St' }])
    expect(s.company.name).toBe('Boss Co')
    expect(s.companyMaster).toMatchObject({ linked: true, isAdmin: true, notice: '' })
  })

  it('seat 1: text over 200 characters is refused before anything is saved or sent', async () => {
    const m = mk({ admin: true })
    await expect(m.svc.saveCompany({ name: 'x'.repeat(201), phone: '', address: '' })).rejects.toThrow('200')
    expect(m.calls).toHaveLength(0)
    expect(m.app.get().company.name).toBe('')
  })

  it('seat 1 while the master is down: local save kept, plain-words notice, no throw', async () => {
    const m = mk({ admin: true, fail: true })
    const s = await m.svc.saveCompany({ name: 'Boss Co', phone: '', address: '' })
    expect(s.company.name).toBe('Boss Co')
    expect(s.companyMaster?.notice).toContain('not shared')
    expect(s.companyMaster?.notice).toContain('could not be reached')
    m.st.fail = false
    expect((await m.svc.saveCompany({ name: 'Boss Co', phone: '', address: '' })).companyMaster?.notice).toBe('')
  })

  it('seat 1 logo: a small PNG is published as it is; one that cannot be made small enough stays local with a notice', async () => {
    const m = mk({ admin: true })
    await m.svc.saveCompany({ name: 'Boss Co', phone: '', address: '' })
    m.pick('logo.png', pngBytes(200, 100, 4000))
    await m.svc.chooseLogo()
    const sent = m.calls[m.calls.length - 1]!
    expect(sent.logo).toBe(b64(readFileSync(join(m.assets, 'company-logo.png'))))
    const big = mk({ admin: true, encode: () => pngBytes(10, 10, LOGO_MAX_BYTES + 5) })
    big.pick('big.png', pngBytes(2000, 2000, LOGO_MAX_BYTES + 9))
    const r = await big.svc.chooseLogo()
    expect(r.state.companyMaster?.notice).toContain('150 KB')
    expect(r.state.company.logo).toBe('company-logo.png')
    expect(big.calls).toHaveLength(0)
  })

  it('seat 1 removing the logo publishes "no logo"', async () => {
    const m = mk({ admin: true })
    await m.svc.saveCompany({ name: 'Boss Co', phone: '', address: '' })
    await m.svc.removeLogo()
    expect(m.calls[m.calls.length - 1]).toMatchObject({ logo: null })
  })

  it('unlinking later brings back the local record untouched', async () => {
    const m = mk()
    await m.svc.saveCompany({ name: 'Local first', phone: '', address: '' })
    await m.svc.applyProfile(view(1))
    expect(m.svc.effective().name).toBe('Master Co')
    m.st.linked = false
    expect(m.svc.effective().name).toBe('Local first')
    expect(m.svc.get().companyMaster).toBeUndefined()
  })

  it('the stored default carries no secret and logs name no values', async () => {
    const m = mk()
    await m.svc.applyProfile(view(1))
    await m.svc.applyProfile(view(2, { name: 'Changed' }))
    expect(m.logs.join(' ')).not.toContain('Changed')
    expect(JSON.stringify([...m.store.entries()])).not.toMatch(/password|token|service_role/i)
  })
})
