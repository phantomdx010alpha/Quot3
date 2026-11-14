/** Phase 271 (M24): print / PDF / image / copy read the company block through the one effective getter. Synthetic data only. */
import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { effectiveProfile, NO_OVERRIDES } from '../../../shared/master/profile'
import type { SettingsService } from '../settingsService'
import { createPrintService, type PrintPort } from '../printService'

const settings = (all: Record<string, unknown>): SettingsService => ({ get: (k) => all[k], set: () => undefined, getAll: () => all })
const LOCAL = { logo: '', name: 'Local Traders', phone: '111', address: 'Local Road' }

function setup(all: Record<string, unknown>, extra: { effectiveCompany?: () => typeof LOCAL; logoDataUrl?: (f: string) => string } = {}) {
  const port: PrintPort = { measure: vi.fn(async () => 100), print: vi.fn(async () => ({ ok: true } as const)), toPdf: async () => new Uint8Array() }
  return createPrintService({ port, settings: settings({ 'print.fitToPage': false, ...all }), resourcesRoot: '/res', ...extra })
}
const run = (svc: ReturnType<typeof setup>) => svc.decide({ bill: printFixture('legacy'), mode: 'professional' })

describe('Phase 271 - printService uses the effective company', () => {
  it('no getter: the local company.profile exactly as before', async () => {
    const r = await run(setup({ 'company.profile': LOCAL }))
    expect(r.settings.company).toEqual(LOCAL)
  })
  it('master default: the company default is printed, not the local record', async () => {
    const eff = () => effectiveProfile({ version: 3, name: 'Company Default', phone: '999', address: 'Head Office', logoFile: '' }, LOCAL, NO_OVERRIDES)
    const r = await run(setup({ 'company.profile': LOCAL }, { effectiveCompany: eff }))
    expect(r.settings.company).toEqual({ logo: '', name: 'Company Default', phone: '999', address: 'Head Office' })
  })
  it('an override on one field keeps this PC\'s value for that field only', async () => {
    const eff = () => effectiveProfile({ version: 3, name: 'Company Default', phone: '999', address: 'Head Office', logoFile: '' }, LOCAL, { ...NO_OVERRIDES, phone: true })
    const r = await run(setup({ 'company.profile': LOCAL }, { effectiveCompany: eff }))
    expect(r.settings.company).toMatchObject({ name: 'Company Default', phone: '111', address: 'Head Office' })
  })
  it('the downloaded logo file name becomes a data URL for the template', async () => {
    const eff = () => ({ ...LOCAL, logo: 'company-logo-master.png' })
    const r = await run(setup({ 'company.profile': LOCAL }, { effectiveCompany: eff, logoDataUrl: (f) => `data:image/png;base64,${f}` }))
    expect(r.settings.company?.logo).toBe('data:image/png;base64,company-logo-master.png')
  })
  it('the same company reaches the HTML that is printed / saved / copied', async () => {
    const port: PrintPort = { measure: vi.fn(async () => 100), print: vi.fn(async () => ({ ok: true } as const)), toPdf: async () => new Uint8Array() }
    const svc = createPrintService({ port, settings: settings({ 'print.fitToPage': false, 'company.profile': LOCAL }), effectiveCompany: () => ({ ...LOCAL, name: 'Company Default' }), resourcesRoot: '/res' })
    await svc.print({ bill: printFixture('legacy'), mode: 'professional' }).catch(() => undefined)
    const html = String((port.print as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '')
    expect(html).toContain('Company Default')
    expect(html).not.toContain('Local Traders')
  })
  it('a failing getter falls back to the local record and never throws', async () => {
    const r = await run(setup({ 'company.profile': LOCAL }, { effectiveCompany: () => { throw new Error('boom') } }))
    expect(r.settings.company).toEqual(LOCAL)
  })
})
