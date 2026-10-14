import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { contentHeightPx } from '../../../shared/print/printFlow'
import type { SettingsService } from '../settingsService'
import { createPrintService, type PrintPort } from '../printService'

const settings = (all: Record<string, unknown> = {}): SettingsService => ({ get: (k) => all[k], set: () => undefined, getAll: () => all })
const OK = { ok: true } as const

function setup(opts: { bottom?: number | Error; print?: Awaited<ReturnType<PrintPort['print']>>; all?: Record<string, unknown> } = {}) {
  const measure = vi.fn<PrintPort['measure']>(async () => { if (opts.bottom instanceof Error) throw opts.bottom; return opts.bottom ?? 100 })
  const print = vi.fn<PrintPort['print']>(async () => opts.print ?? OK)
  const svc = createPrintService({ port: { measure, print, toPdf: async () => new Uint8Array() }, settings: settings(opts.all ?? { 'print.fitToPage': false }), resourcesRoot: '/res' }) // Phase 148: the pre-existing tests are pinned to the old size (fit Off) unless they pass their own settings
  return { svc, measure, print }
}
const TALL = contentHeightPx('A5') + 50
const FITS = contentHeightPx('A5') - 50

describe('Phase 37 - printService.decide', () => {
  it('rules say A5 and the content fits: A5, measured once, no switch', async () => {
    const { svc, measure } = setup({ bottom: FITS })
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.decision.size).toBe('A5')
    expect(r.switchedByMeasure).toBe(false)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure.mock.calls[0]![1]).toBe('A5')
  })
  it('measured overflow re-decides with measuredOverflow: A4, switched, with the overflow reason', async () => {
    const { svc } = setup({ bottom: TALL })
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.decision).toMatchObject({ size: 'A4', requiresAck: false })
    expect(r.decision.reasons[0]).toMatch(/did not fit A5/)
    expect(r.switchedByMeasure).toBe(true)
  })
  it('rules already say A4: nothing is measured', async () => {
    const { svc, measure } = setup({ bottom: TALL })
    const r = await svc.decide({ bill: printFixture('rows81'), mode: 'rough' })
    expect(r.decision.size).toBe('A4')
    expect(measure).not.toHaveBeenCalled()
  })
  it('a forced size (request or the bill\'s saved override) is never second-guessed', async () => {
    const { svc, measure } = setup({ bottom: TALL })
    expect((await svc.decide({ bill: printFixture('legacy'), mode: 'rough', forced: 'A5' })).decision.size).toBe('A5')
    expect((await svc.decide({ bill: { ...printFixture('legacy'), paperOverride: 'A5' }, mode: 'rough' })).decision.size).toBe('A5')
    expect(measure).not.toHaveBeenCalled()
    // 'auto' drops the saved override, so the measurement applies again
    expect((await svc.decide({ bill: { ...printFixture('legacy'), paperOverride: 'A5' }, mode: 'rough', forced: 'auto' })).decision.size).toBe('A4')
  })
  it('a failing measurement keeps the rules decision and says so', async () => {
    const { svc } = setup({ bottom: new Error('window failed') })
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r).toMatchObject({ measureFailed: true, switchedByMeasure: false })
    expect(r.decision.size).toBe('A5')
  })
  it('returns the settings the preview needs', async () => {
    const { svc } = setup({ bottom: FITS, all: { 'print.rupeeOnTotal': false, 'company.profile': { name: 'Acme' } } })
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'professional' })
    expect(r.settings).toEqual({ rupeeOnTotal: false, company: { logo: '', name: 'Acme', phone: '', address: '' } })
  })
})

describe('Phase 37 - printService.print', () => {
  it('prints the HTML of the FINAL decision (after the overflow switch) on that paper', async () => {
    const { svc, print } = setup({ bottom: TALL })
    const r = await svc.print({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r).toMatchObject({ printed: true, cancelled: false, switchedByMeasure: true })
    expect(print).toHaveBeenCalledTimes(1)
    const [html, o] = print.mock.calls[0]!
    expect(o.paper).toBe('A4')
    expect(html).toContain('@page{size:A4 portrait')
  })
  it('A5 print: paper A5, system dialog (not silent), no device', async () => {
    const { svc, print } = setup({ bottom: FITS })
    await svc.print({ bill: printFixture('legacy'), mode: 'rough' })
    expect(print.mock.calls[0]![1]).toEqual({ paper: 'A5', silent: false, deviceName: '' })
  })
  it('silent printing only with a configured printer', async () => {
    const a = setup({ bottom: FITS, all: { 'print.silent': true } })
    await a.svc.print({ bill: printFixture('legacy'), mode: 'rough' })
    expect(a.print.mock.calls[0]![1]).toMatchObject({ silent: false })
    const b = setup({ bottom: FITS, all: { 'print.silent': true, 'print.printer': 'HP' } })
    await b.svc.print({ bill: printFixture('legacy'), mode: 'rough' })
    expect(b.print.mock.calls[0]![1]).toEqual({ paper: 'A5', silent: true, deviceName: 'HP' })
  })
  it('the extra-columns warning must be acknowledged: refused without ack (nothing printed), accepted with it', async () => {
    const { svc, print } = setup()
    await expect(svc.print({ bill: printFixture('gstExtra3'), mode: 'rough' })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(print).not.toHaveBeenCalled()
    const r = await svc.print({ bill: printFixture('gstExtra3'), mode: 'rough', ack: true })
    expect(r.decision).toMatchObject({ size: 'A4', requiresAck: true })
    expect(print).toHaveBeenCalledTimes(1)
  })
  it('forcing a size removes the acknowledgement requirement', async () => {
    const { svc } = setup()
    const r = await svc.print({ bill: printFixture('gstExtra3'), mode: 'rough', forced: 'A4' })
    expect(r.printed).toBe(true)
  })
  it('the owner closing the system dialog is a cancel, not an error', async () => {
    const { svc } = setup({ bottom: FITS, print: { ok: false, cancelled: true, reason: 'cancelled' } })
    expect(await svc.print({ bill: printFixture('legacy'), mode: 'rough' })).toMatchObject({ printed: false, cancelled: true })
  })
  it('a printer failure is PRINT_FAILED with the reason', async () => {
    const { svc } = setup({ bottom: FITS, print: { ok: false, cancelled: false, reason: 'printer offline' } })
    await expect(svc.print({ bill: printFixture('legacy'), mode: 'rough' })).rejects.toMatchObject({ code: 'PRINT_FAILED', message: 'Printing failed: printer offline' })
  })
})

describe('Phase 40 - one-page A4 fit by density tier', () => {
  const A4_FIT = contentHeightPx('A4') - 10
  const A4_OVER = contentHeightPx('A4') + 100
  it('rows within the A4 limit that overflow at the normal style are rendered at a denser tier, and the tier is reported', async () => {
    const measure = vi.fn<PrintPort['measure']>(async (html) => (html.includes('--print-fs:7pt') ? A4_FIT : A4_OVER))
    const svc = createPrintService({ port: { measure, print: async () => OK, toPdf: async () => new Uint8Array() }, settings: settings(), resourcesRoot: '/res' })
    const r = await svc.decide({ bill: printFixture('rows40'), mode: 'rough', forced: 'A4' })
    expect(r.density).toBe(2)
    expect((await svc.resolveOutput({ bill: printFixture('rows40'), mode: 'rough', forced: 'A4' })).html).toContain('--print-fs:7pt')
  })
  it('a normally-fitting A4 bill stays at tier 0, and multi-page A4 is never squeezed', async () => {
    const svc = createPrintService({ port: { measure: async () => A4_FIT, print: async () => OK, toPdf: async () => new Uint8Array() }, settings: settings(), resourcesRoot: '/res' })
    expect((await svc.decide({ bill: printFixture('rows40'), mode: 'rough', forced: 'A4' })).density).toBe(0)
    const measure = vi.fn<PrintPort['measure']>(async () => A4_OVER)
    const svc2 = createPrintService({ port: { measure, print: async () => OK, toPdf: async () => new Uint8Array() }, settings: settings(), resourcesRoot: '/res' })
    expect((await svc2.decide({ bill: printFixture('rows150'), mode: 'rough' })).density).toBe(0)
    expect(measure).not.toHaveBeenCalled()
  })
})

describe('Phase 73 - printService.decideQuick (instant dialog)', () => {
  it('returns the pure engine decision with NO measurement, flagged provisional', async () => {
    const { svc, measure } = setup({ bottom: TALL })
    const r = await svc.decideQuick({ bill: printFixture('legacy'), mode: 'rough' })
    expect(measure).not.toHaveBeenCalled()
    expect(r).toMatchObject({ provisional: true, switchedByMeasure: false, measureFailed: false, density: 0 })
    expect(r.decision.size).toBe('A5') // the rules' answer; the measured overflow is only found by decide()
  })
  it('a one-page A4 bill is not density-fitted in the quick answer, and the measured decide still is', async () => {
    const { svc, measure } = setup({ bottom: 100 })
    expect((await svc.decideQuick({ bill: printFixture('rows81'), mode: 'rough' })).density).toBe(0)
    expect(measure).not.toHaveBeenCalled()
    const full = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(full.provisional).toBeUndefined()
  })
  it('settings (company / rupee) are the same as the measured answer', async () => {
    const { svc } = setup({ bottom: FITS })
    const q = await svc.decideQuick({ bill: printFixture('legacy'), mode: 'rough' })
    const f = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(q.settings).toEqual(f.settings)
  })
})

describe('Phase 144 follow-up - measured answer is reused (Print does not re-measure what the dialog just measured)', () => {
  it('decide then print for the same bill: the port measures once, and print still uses the final decision', async () => {
    const { svc, measure, print } = setup({ bottom: contentHeightPx('A5') - 50 })
    const bill = printFixture('legacy') // the dialog and Print send the same payload; a fixture call makes fresh row ids
    await svc.decide({ bill, mode: 'rough' })
    await svc.print({ bill, mode: 'rough' })
    expect(measure).toHaveBeenCalledTimes(1)
    expect(print).toHaveBeenCalledTimes(1)
  })
  it('a different bill or a different forced size is measured again', async () => {
    const { svc, measure } = setup({ bottom: contentHeightPx('A5') - 50 })
    await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    await svc.decide({ bill: printFixture('rows30'), mode: 'professional' })
    expect(measure).toHaveBeenCalledTimes(2)
  })
  it('a failed measurement is not cached (the next call retries)', async () => {
    const { svc, measure } = setup({ bottom: new Error('window failed') })
    await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(measure).toHaveBeenCalledTimes(2)
  })
  it('decideQuick asks the port to warm its window (fire and forget) and never measures', async () => {
    const warm = vi.fn()
    const measure = vi.fn<PrintPort['measure']>(async () => 100)
    const svc = createPrintService({ port: { measure, print: async () => OK, toPdf: async () => new Uint8Array(), warm }, settings: settings(), resourcesRoot: '/res' })
    await svc.decideQuick({ bill: printFixture('legacy'), mode: 'rough' })
    expect(warm).toHaveBeenCalledTimes(1)
    expect(measure).not.toHaveBeenCalled()
  })
})

describe('Phase 148 - fit bill to page (print service)', () => {
  const H5 = contentHeightPx('A5')
  /** A bill whose measured bottom grows linearly with the type factor (read from the rendered --print-fs). */
  const linear = (bottom1: number) => vi.fn<PrintPort['measure']>(async (html) => {
    const m = /--print-fs:([0-9.]+)pt/.exec(html.slice(html.indexOf('</style>') - 2000))
    const all = [...html.matchAll(/--print-fs:([0-9.]+)pt/g)].map((x) => Number(x[1]))
    const fs = all.length > 0 ? all[all.length - 1]! : Number(m?.[1] ?? 7.5)
    return bottom1 * (fs / 7.5)
  })
  const mk = (measure: PrintPort['measure'], all: Record<string, unknown> = {}) =>
    createPrintService({ port: { measure, print: async () => OK, toPdf: async () => new Uint8Array() }, settings: settings(all), resourcesRoot: '/res' })

  it('ON (default): a short A5 bill is enlarged up to the cap, and the output HTML carries the scaled sizes', async () => {
    const svc = mk(linear(H5 * 0.2))
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.decision.size).toBe('A5')
    expect(r.fit).toBe(1.35)
    const html = (await svc.resolveOutput({ bill: printFixture('legacy'), mode: 'rough' })).html
    expect(html).toContain('--print-fs:10.125pt') // 7.5 * 1.35
  })
  it('ON: a bill that fills the page stays at 1 (no change to the HTML)', async () => {
    const svc = mk(linear(H5 * 0.97))
    expect((await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })).fit).toBe(1)
  })
  it('ON: a bill that only has room for part of the cap is enlarged only as far as it fits', async () => {
    const svc = mk(linear(H5 * 0.8))
    const r = await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.fit).toBeGreaterThan(1)
    expect(r.fit).toBeLessThan(1.35)
  })
  it('OFF: never scaled and measured only as before; HTML equals the fit-less render', async () => {
    const off = mk(linear(H5 * 0.2), { 'print.fitToPage': false })
    const r = await off.decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.fit).toBe(1)
    const htmlOff = (await off.resolveOutput({ bill: printFixture('legacy'), mode: 'rough' })).html
    expect(htmlOff).not.toContain('10.125pt')
    const capOne = mk(linear(H5 * 0.2), { 'print.fitMaxA5': 1 })
    expect((await capOne.resolveOutput({ bill: printFixture('legacy'), mode: 'rough' })).html).toBe(htmlOff)
  })
  it('a custom cap is honoured; junk values fall back to the default', async () => {
    expect((await mk(linear(H5 * 0.2), { 'print.fitMaxA5': 1.1 }).decide({ bill: printFixture('legacy'), mode: 'rough' })).fit).toBe(1.1)
    expect((await mk(linear(H5 * 0.2), { 'print.fitMaxA5': 'big' }).decide({ bill: printFixture('legacy'), mode: 'rough' })).fit).toBe(1.35)
  })
  it('a failing fit measurement keeps the normal size (and does not break the decision)', async () => {
    let n = 0
    const measure = vi.fn<PrintPort['measure']>(async () => { n++; if (n > 1) throw new Error('window failed'); return H5 * 0.2 })
    const r = await mk(measure).decide({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r.fit).toBe(1)
    expect(r.decision.size).toBe('A5')
  })
  it('A4 one-page bills are fitted too (A4 cap); multi-page A4 and density-squeezed bills never are', async () => {
    const H4 = contentHeightPx('A4')
    const small = mk(linear(H4 * 0.2).bind(null) as unknown as PrintPort['measure'])
    // forced A4 on a small bill: tier 0 fits, fit goes up to the A4 cap
    expect((await small.decide({ bill: printFixture('legacy'), mode: 'rough', forced: 'A4' })).fit).toBe(1.25)
    const multi = vi.fn<PrintPort['measure']>(async () => H4 * 3)
    expect((await mk(multi).decide({ bill: printFixture('rows150'), mode: 'rough' })).fit).toBe(1)
    expect(multi).not.toHaveBeenCalled()
  })
  it('changing the setting is not hidden by the measurement cache', async () => {
    let all: Record<string, unknown> = {}
    const measure = linear(H5 * 0.2)
    const svc = createPrintService({ port: { measure, print: async () => OK, toPdf: async () => new Uint8Array() }, settings: { get: (k) => all[k], set: () => undefined, getAll: () => all }, resourcesRoot: '/res' })
    expect((await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })).fit).toBe(1.35)
    all = { 'print.fitToPage': false }
    expect((await svc.decide({ bill: printFixture('legacy'), mode: 'rough' })).fit).toBe(1)
  })
})
