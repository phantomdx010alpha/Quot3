import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import type { PrintService } from '../../services/printService'
import { printHandlers } from '../print'

const payload = (): Record<string, unknown> => {
  const b = printFixture('legacy')
  return { id: b.id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: null, billDate: b.billDate, rows: b.rows, poNumber: 'Q3-0001' }
}
const mk = (): PrintService & { pdf: ReturnType<typeof vi.fn>; openPdf: ReturnType<typeof vi.fn> } => ({
  decide: vi.fn(), print: vi.fn(),
  pdf: vi.fn(async () => ({ saved: true, cancelled: false, filePath: 'C:\\x\\a.pdf', pages: 1, decision: {}, switchedByMeasure: false })),
  openPdf: vi.fn(async () => undefined)
}) as never
const call = (h: Record<string, (r: unknown) => Promise<unknown>>, ch: string, raw: unknown): Promise<{ ok: boolean; data?: unknown; error?: { code: string } }> => h[ch]!(raw) as never

describe('Phase 38 - print:pdf / print:openPdf IPC', () => {
  it('print:pdf validates and passes a full Bill, ack and savePath to the service', async () => {
    const s = mk()
    const r = await call(printHandlers(s), 'print:pdf', { bill: payload(), mode: 'professional', forced: 'A4', ack: true, savePath: 'D:\\out\\a.PDF' })
    expect(r.ok).toBe(true)
    expect(s.pdf.mock.calls[0]![0]).toMatchObject({ mode: 'professional', forced: 'A4', ack: true, savePath: 'D:\\out\\a.PDF', bill: { poNumber: 'Q3-0001', branchId: 'local' } })
  })
  it('accepts drive, UNC and POSIX absolute paths only; rejects relative, traversal-only and non-.pdf names', async () => {
    const s = mk(); const h = printHandlers(s)
    for (const p of ['C:\\a\\b.pdf', 'C:/a/b.pdf', '\\\\server\\share\\b.pdf', '/home/u/b.pdf']) expect((await call(h, 'print:pdf', { bill: payload(), mode: 'rough', savePath: p })).ok).toBe(true)
    for (const p of ['b.pdf', '..\\b.pdf', 'a/b.pdf', 'C:\\a\\b.txt', 'C:\\a\\b.pdf.exe', '']) expect((await call(h, 'print:pdf', { bill: payload(), mode: 'rough', savePath: p })).error?.code).toBe('VALIDATION')
    expect(s.pdf).toHaveBeenCalledTimes(4)
  })
  it('print:pdf is strict: unknown keys, bad mode and bad paper size are VALIDATION and nothing reaches the service', async () => {
    const s = mk(); const h = printHandlers(s)
    expect((await call(h, 'print:pdf', { bill: payload(), mode: 'rough', extra: 1 })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:pdf', { bill: payload(), mode: 'draft' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:pdf', { bill: payload(), mode: 'rough', forced: 'A3' })).error?.code).toBe('VALIDATION')
    expect(s.pdf).not.toHaveBeenCalled()
  })
  it('print:openPdf takes an absolute .pdf path only', async () => {
    const s = mk(); const h = printHandlers(s)
    expect((await call(h, 'print:openPdf', { filePath: 'C:\\a\\b.pdf' })).ok).toBe(true)
    expect(s.openPdf).toHaveBeenCalledWith('C:\\a\\b.pdf')
    expect((await call(h, 'print:openPdf', { filePath: 'C:\\a\\run.exe' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:openPdf', { filePath: 'b.pdf' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:openPdf', { filePath: 'C:\\a\\b.pdf', x: 1 })).error?.code).toBe('VALIDATION')
    expect(s.openPdf).toHaveBeenCalledTimes(1)
  })
  it('a service failure is a Result failure with its code', async () => {
    const s = mk()
    s.pdf.mockRejectedValueOnce(Object.assign(new Error('x'), {}))
    expect((await call(printHandlers(s), 'print:pdf', { bill: payload(), mode: 'rough' })).ok).toBe(false)
  })
})
