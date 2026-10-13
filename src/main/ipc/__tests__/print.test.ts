import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import type { PrintService } from '../../services/printService'
import { printHandlers } from '../print'

const payload = (): Record<string, unknown> => {
  const b = printFixture('legacy')
  return { id: b.id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: null, billDate: b.billDate, rows: b.rows, poNumber: 'Q3-0001' }
}
const svc = (): PrintService & { decide: ReturnType<typeof vi.fn>; print: ReturnType<typeof vi.fn> } => ({
  decide: vi.fn(async () => ({ decision: {}, settings: {}, switchedByMeasure: false, measureFailed: false })),
  print: vi.fn(async () => ({ printed: true, cancelled: false, decision: {}, switchedByMeasure: false }))
}) as never
const call = (h: Record<string, (r: unknown) => Promise<unknown>>, ch: string, raw: unknown): Promise<{ ok: boolean; error?: { code: string } }> => h[ch]!(raw) as never

describe('Phase 37 - print:* IPC', () => {
  it('print:decide validates and passes a complete Bill to the service', async () => {
    const s = svc()
    const r = await call(printHandlers(s), 'print:decide', { bill: payload(), mode: 'rough', forced: 'auto' })
    expect(r.ok).toBe(true)
    const arg = s.decide.mock.calls[0]![0]
    expect(arg).toMatchObject({ mode: 'rough', forced: 'auto', bill: { poNumber: 'Q3-0001', branchId: 'local', deletedAt: null, syncState: 'local_only' } })
  })
  it('print:print forwards ack', async () => {
    const s = svc()
    await call(printHandlers(s), 'print:print', { bill: payload(), mode: 'professional', forced: 'A4', ack: true })
    expect(s.print.mock.calls[0]![0]).toMatchObject({ mode: 'professional', forced: 'A4', ack: true })
  })
  it('rejects unknown keys, bad modes, bad papers and oversize bills (strict schemas)', async () => {
    const s = svc()
    const h = printHandlers(s)
    expect((await call(h, 'print:decide', { bill: payload(), mode: 'rough', extra: 1 })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:decide', { bill: payload(), mode: 'draft' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:print', { bill: payload(), mode: 'rough', forced: 'A3' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:decide', { bill: { ...payload(), rows: Array.from({ length: 2001 }, () => printFixture('legacy').rows[0]) }, mode: 'rough' })).error?.code).toBe('VALIDATION')
    expect((await call(h, 'print:decide', { bill: { ...payload(), unknown: 1 }, mode: 'rough' })).error?.code).toBe('VALIDATION')
    expect(s.decide).not.toHaveBeenCalled()
    expect(s.print).not.toHaveBeenCalled()
  })
  it('a thrown service error becomes a Result failure (never a rejection)', async () => {
    const s = svc()
    s.print.mockRejectedValueOnce(Object.assign(new Error('boom'), {}))
    const r = await call(printHandlers(s), 'print:print', { bill: payload(), mode: 'rough' })
    expect(r.ok).toBe(false)
  })
})

describe('Phase 73 - print:decideQuick', () => {
  it('validates like print:decide and calls decideQuick only', async () => {
    const s = svc() as unknown as { decide: ReturnType<typeof vi.fn>; decideQuick: ReturnType<typeof vi.fn> }
    s.decideQuick = vi.fn(async () => ({ provisional: true }))
    const h = printHandlers(s as never)
    expect((await call(h, 'print:decideQuick', { bill: payload(), mode: 'rough' })).ok).toBe(true)
    expect(s.decideQuick).toHaveBeenCalledTimes(1)
    expect(s.decide).not.toHaveBeenCalled()
    expect((await call(h, 'print:decideQuick', { bill: payload(), mode: 'draft' })).error?.code).toBe('VALIDATION')
  })
})
