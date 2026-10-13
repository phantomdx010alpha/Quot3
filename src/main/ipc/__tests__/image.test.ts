import { describe, expect, it, vi } from 'vitest'
import { printFixture } from '../../../shared/__fixtures__/printBills'
import { imageHandlers } from '../image'

const fx = printFixture('legacy')
const bill = { id: fx.id, party: fx.party, formatId: fx.formatId, extraCols: fx.extraCols, paperOverride: null, billDate: fx.billDate, rows: fx.rows, poNumber: 'Q3-0001' }

describe('Phase 39 - image:copy IPC', () => {
  it('validates, builds a full Bill and calls the service', async () => {
    const copy = vi.fn(async (_req: unknown) => ({ width: 10, height: 20, paper: 'A5' as const, cached: false, scale: 3, scaleApplied: true }))
    const h = imageHandlers({ copy, prerender: vi.fn(), warm: vi.fn(), dispose: vi.fn() })['image:copy']!
    const r = (await h({ bill, mode: 'rough' })) as { ok: boolean; data?: unknown }
    expect(r.ok).toBe(true)
    expect(copy).toHaveBeenCalledTimes(1)
    expect((copy.mock.calls[0] as unknown as [{ mode: string }])[0].mode).toBe('rough')
  })
  it('accepts a bill with round-off on, footer extras and tail rows (same shape as print; was "Invalid request")', async () => {
    const copy = vi.fn(async (_req: unknown) => ({ width: 10, height: 20, paper: 'A5' as const, cached: false, scale: 3, scaleApplied: true }))
    const h = imageHandlers({ copy, prerender: vi.fn(async () => ({ cached: false })), warm: vi.fn(), dispose: vi.fn() })
    const b = { ...bill, roundOff: 1, tailRows: [{ extras: {} }], footerExtras: {} }
    expect(((await h['image:copy']!({ bill: b, mode: 'rough' })) as { ok: boolean }).ok).toBe(true)
    expect(((await h['image:prerender']!({ bill: b, mode: 'professional' })) as { ok: boolean }).ok).toBe(true)
    expect((copy.mock.calls[0] as unknown as [{ bill: { roundOff?: number } }])[0].bill.roundOff).toBe(1)
  })
  it('rejects unknown keys and bad modes without calling the service', async () => {
    const copy = vi.fn()
    const h = imageHandlers({ copy, prerender: vi.fn(), warm: vi.fn(), dispose: vi.fn() })['image:copy']!
    expect(((await h({ bill, mode: 'rough', extra: 1 })) as { ok: boolean }).ok).toBe(false)
    expect(((await h({ bill, mode: 'fancy' })) as { ok: boolean }).ok).toBe(false)
    expect(copy).not.toHaveBeenCalled()
  })
  it('Phase 71: image:prerender validates like copy and calls prerender only', async () => {
    const prerender = vi.fn(async () => ({ cached: false }))
    const h = imageHandlers({ copy: vi.fn(), prerender, warm: vi.fn(), dispose: vi.fn() })['image:prerender']!
    const r = (await h({ bill, mode: 'professional' })) as { ok: boolean; data?: unknown }
    expect(r.ok).toBe(true)
    expect(prerender).toHaveBeenCalledTimes(1)
    expect(((await h({ bill, mode: 'x' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h({ bill, mode: 'rough', extra: 1 })) as { ok: boolean }).ok).toBe(false)
    expect(prerender).toHaveBeenCalledTimes(1)
  })
})
