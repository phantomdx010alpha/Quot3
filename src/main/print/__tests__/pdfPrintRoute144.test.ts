import { describe, expect, it } from 'vitest'
import { buildPdfPrintOptions, parsePrintRoute } from '../../../shared/print/printFlow'
import { printViaPdf, type PdfRouteDeps } from '../pdfPrintRoute'

/** Phase 144 follow-up - PDF-first printing: orchestration with stubs (no Electron, no printer). */
function deps(over: Partial<PdfRouteDeps> = {}): { d: PdfRouteDeps; log: string[]; opts: unknown[] } {
  const log: string[] = [], opts: unknown[] = []
  const d: PdfRouteDeps = {
    toPdf: async (_h, p) => { log.push(`toPdf:${p}`); return new Uint8Array([1, 2, 3]) },
    writeTemp: (b) => { log.push(`write:${b.length}`); return '/tmp/x/bill.pdf' },
    removeTemp: (f) => { log.push(`remove:${f}`) },
    printFile: async (f, o) => { log.push(`print:${f}`); opts.push(o) },
    ...over
  }
  return { d, log, opts }
}
describe('Phase 144 follow-up - PDF-first print route', () => {
  it('route default is pdf; only the exact value html selects the old path', () => {
    expect(parsePrintRoute(undefined)).toBe('pdf')
    expect(parsePrintRoute('pdf')).toBe('pdf')
    expect(parsePrintRoute('html')).toBe('html')
    expect(parsePrintRoute('HTML')).toBe('pdf')
  })
  it('options: actual size, explicit paper, portrait; no printer -> the print dialog; printer + silent -> silent', () => {
    expect(buildPdfPrintOptions({ paper: 'A4', silent: false, deviceName: '' })).toEqual({ silent: false, printDialog: true, scale: 'noscale', paperSize: 'A4', orientation: 'portrait' })
    expect(buildPdfPrintOptions({ paper: 'A5', silent: true, deviceName: 'HP LaserJet' })).toEqual({ printer: 'HP LaserJet', silent: true, printDialog: false, scale: 'noscale', paperSize: 'A5', orientation: 'portrait' })
    expect(buildPdfPrintOptions({ paper: 'A4', silent: false, deviceName: 'HP' })).toMatchObject({ printer: 'HP', silent: false, printDialog: true })
    expect(buildPdfPrintOptions({ paper: 'A4', silent: true, deviceName: '' }).printDialog).toBe(true) // silent with nowhere to send it -> dialog
  })
  it('renders the PDF, writes it, prints that file with the options, then removes the temp file (in that order)', async () => {
    const { d, log, opts } = deps()
    expect(await printViaPdf(d, '<html/>', { paper: 'A4', silent: false, deviceName: '' })).toEqual({ ok: true })
    expect(log).toEqual(['toPdf:A4', 'write:3', 'print:/tmp/x/bill.pdf', 'remove:/tmp/x/bill.pdf'])
    expect(opts[0]).toMatchObject({ scale: 'noscale', paperSize: 'A4' })
  })
  it('a printing failure is reported (so the caller can fall back) and the temp file is still removed', async () => {
    const { d, log } = deps({ printFile: async () => { throw new Error('Operating System not supported') } })
    expect(await printViaPdf(d, 'x', { paper: 'A5', silent: false, deviceName: '' })).toEqual({ ok: false, reason: 'Operating System not supported' })
    expect(log.at(-1)).toBe('remove:/tmp/x/bill.pdf')
  })
  it('a PDF render failure never writes or prints anything', async () => {
    const { d, log } = deps({ toPdf: async () => { throw new Error('Print page took too long to load') } })
    const r = await printViaPdf(d, 'x', { paper: 'A4', silent: false, deviceName: '' })
    expect(r.ok).toBe(false)
    expect(log).toEqual([])
  })
  it('a failing temp cleanup does not turn a successful print into a failure', async () => {
    const { d } = deps({ removeTemp: () => { throw new Error('EBUSY') } })
    expect(await printViaPdf(d, 'x', { paper: 'A4', silent: false, deviceName: '' })).toEqual({ ok: true })
  })
})
