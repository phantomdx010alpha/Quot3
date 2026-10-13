import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { contentHeightPx } from '../../../shared/print/printFlow'
import type { SettingsService } from '../settingsService'
import { createPrintService, type PdfFilePort, type PrintPort } from '../printService'

const settings = (): SettingsService => ({ get: () => undefined, set: () => undefined, getAll: () => ({}) })
const enc = (pages: number): Uint8Array => new TextEncoder().encode('%PDF-1.4\n<</Type /Pages>>\n' + '<</Type /Page>>\n'.repeat(pages))

function setup(o: { chosen?: string | null; bottom?: number; pages?: number; toPdfErr?: Error; writeErr?: Error; exists?: boolean; openResult?: string; noFiles?: boolean } = {}) {
  const toPdf = vi.fn<PrintPort['toPdf']>(async () => { if (o.toPdfErr) throw o.toPdfErr; return enc(o.pages ?? 1) })
  const measure = vi.fn<PrintPort['measure']>(async () => o.bottom ?? 100)
  const print = vi.fn<PrintPort['print']>(async () => ({ ok: true }))
  const chooseSavePath = vi.fn<PdfFilePort['chooseSavePath']>(async () => (o.chosen === undefined ? 'C:\\Users\\x\\Documents\\out.pdf' : o.chosen))
  const write = vi.fn<PdfFilePort['write']>(async () => { if (o.writeErr) throw o.writeErr })
  const open = vi.fn<PdfFilePort['open']>(async () => o.openResult ?? '')
  const files: PdfFilePort = { chooseSavePath, write, exists: () => o.exists ?? true, open }
  const svc = createPrintService({ port: { measure, print, toPdf }, settings: settings(), resourcesRoot: '/res', ...(o.noFiles ? {} : { files }) })
  return { svc, toPdf, measure, chooseSavePath, write, open, print }
}

describe('Phase 38 - printService.pdf', () => {
  it('uses the print decision: rules size, the HTML of that decision, default name from the PO, writes the bytes', async () => {
    const { svc, toPdf, chooseSavePath, write } = setup({ pages: 1 })
    const bill = { ...printFixture('legacy'), poNumber: 'Q3-0007' }
    const r = await svc.pdf({ bill, mode: 'rough' })
    expect(r).toMatchObject({ saved: true, cancelled: false, filePath: 'C:\\Users\\x\\Documents\\out.pdf', pages: 1, switchedByMeasure: false })
    expect(r.decision.size).toBe('A5')
    expect(chooseSavePath).toHaveBeenCalledWith(`Q3-0007-${bill.billDate}.pdf`)
    expect(toPdf.mock.calls[0]![1]).toBe('A5')
    expect(toPdf.mock.calls[0]![0]).toContain('@page')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]![0]).toBe('C:\\Users\\x\\Documents\\out.pdf')
  })
  it('the PDF is the SAME html as the one that prints (measured-overflow switch to A4 included)', async () => {
    const tall = setup({ bottom: contentHeightPx('A5') + 50, pages: 1 })
    const pdf = await tall.svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })
    await tall.svc.print({ bill: printFixture('legacy'), mode: 'rough' })
    expect(pdf).toMatchObject({ switchedByMeasure: true })
    expect(pdf.decision.size).toBe('A4')
    expect(tall.toPdf.mock.calls[0]![1]).toBe('A4')
    expect(tall.toPdf.mock.calls[0]![0]).toBe(tall.print.mock.calls[0]![0])
  })
  it('a forced size is honoured and not measured; 81 rough rows -> A4 with the page count read from the file', async () => {
    const a = setup({ pages: 1 })
    expect((await a.svc.pdf({ bill: printFixture('legacy'), mode: 'rough', forced: 'A4' })).decision.size).toBe('A4')
    expect(a.measure.mock.calls.every((c) => c[1] !== 'A5')).toBe(true) // forced size: no A5 overflow measurement (Phase 40 only measures the A4 density fit)
    const b = setup({ pages: 2 })
    const r = await b.svc.pdf({ bill: printFixture('rows81'), mode: 'rough' })
    expect(r.decision.size).toBe('A4')
    expect(r.pages).toBe(2)
  })
  it('requiresAck: refuses without ack and asks for no path; with ack it saves', async () => {
    const { svc, chooseSavePath, toPdf } = setup()
    const bill = printFixture('gstExtra3')
    await expect(svc.pdf({ bill, mode: 'rough' })).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(chooseSavePath).not.toHaveBeenCalled()
    expect(toPdf).not.toHaveBeenCalled()
    const r = await svc.pdf({ bill, mode: 'rough', ack: true })
    expect(r.saved).toBe(true)
  })
  it('closing the Save dialog is a quiet cancel: nothing rendered, nothing written', async () => {
    const { svc, toPdf, write } = setup({ chosen: null })
    const r = await svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })
    expect(r).toMatchObject({ saved: false, cancelled: true, filePath: null, pages: 0 })
    expect(toPdf).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
  it('an explicit savePath skips the Save dialog; a path without .pdf is refused; a chosen path gets .pdf added', async () => {
    const a = setup()
    const r = await a.svc.pdf({ bill: printFixture('legacy'), mode: 'rough', savePath: 'D:\\q\\one.pdf' })
    expect(a.chooseSavePath).not.toHaveBeenCalled()
    expect(r.filePath).toBe('D:\\q\\one.pdf')
    await expect(a.svc.pdf({ bill: printFixture('legacy'), mode: 'rough', savePath: 'D:\\q\\one.txt' })).rejects.toMatchObject({ code: 'VALIDATION' })
    const b = setup({ chosen: 'E:\\two' })
    expect((await b.svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })).filePath).toBe('E:\\two.pdf')
  })
  it('render and write failures become PRINT_FAILED with the reason; the bill is never touched', async () => {
    await expect(setup({ toPdfErr: new Error('renderer crashed') }).svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })).rejects.toMatchObject({ code: 'PRINT_FAILED', message: expect.stringContaining('renderer crashed') })
    await expect(setup({ writeErr: new Error('EBUSY: file is open in another program') }).svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })).rejects.toMatchObject({ code: 'PRINT_FAILED', message: expect.stringContaining('EBUSY') })
  })
  it('without a file port PDF export says so', async () => {
    await expect(setup({ noFiles: true }).svc.pdf({ bill: printFixture('legacy'), mode: 'rough' })).rejects.toMatchObject({ code: 'PRINT_FAILED' })
  })
  it('Professional mode renders the Professional header into the PDF html', async () => {
    const { svc, toPdf } = setup()
    await svc.pdf({ bill: { ...printFixture('legacy'), poNumber: 'Q3-0009' }, mode: 'professional' })
    expect(toPdf.mock.calls[0]![0]).toContain('Q3-0009')
  })
})

describe('Phase 38 - printService.openPdf', () => {
  it('opens an existing .pdf; refuses other extensions and missing files; reports a viewer failure', async () => {
    const ok = setup()
    await ok.svc.openPdf('C:\\a\\b.pdf')
    expect(ok.open).toHaveBeenCalledWith('C:\\a\\b.pdf')
    await expect(ok.svc.openPdf('C:\\a\\b.exe')).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(ok.open).toHaveBeenCalledTimes(1)
    await expect(setup({ exists: false }).svc.openPdf('C:\\a\\b.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(setup({ openResult: 'no application' }).svc.openPdf('C:\\a\\b.pdf')).rejects.toMatchObject({ code: 'PRINT_FAILED' })
  })
})
