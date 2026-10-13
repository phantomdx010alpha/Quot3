// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { row } from '@shared/__fixtures__/bills'
import { useBillStore } from '../billStore'
import { createEmptyBill } from '@shared/billModel'
import { getPrerenderMode, IMAGE_PRERENDER_IDLE_MS, prerenderNow, resetPrerenderMemo, setPrerenderMode, startImagePrerender } from '../imagePrerender'

let prerender: ReturnType<typeof vi.fn>
const S = () => useBillStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  prerender = vi.fn(async () => ({ ok: true, data: { cached: false } }))
  ;(window as unknown as { quot3: unknown }).quot3 = { image: { prerender } }
  resetPrerenderMemo(); setPrerenderMode('rough')
  useBillStore.getState().loadBill({ ...createEmptyBill({ branchId: 'b', rowCount: 0 }), party: { name: 'Ruby', phone: '', address: '', transport: '' }, rows: [row('Pen', '5', '2')] })
})
afterEach(() => { vi.useRealTimers(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 71 - idle image pre-render (renderer side)', () => {
  it('prerenderNow sends the open bill with the remembered mode, once per distinct content', async () => {
    expect(await prerenderNow()).toBe(true)
    expect(prerender).toHaveBeenCalledTimes(1)
    expect((prerender.mock.calls[0] as unknown as [{ mode: string }])[0].mode).toBe('rough')
    expect(await prerenderNow()).toBe(false) // unchanged: nothing re-sent
    setPrerenderMode('professional')
    expect(await prerenderNow()).toBe(true)
    expect(getPrerenderMode()).toBe('professional')
  })
  it('does nothing without a bridge method, a bill, or content', async () => {
    delete (window as unknown as { quot3?: unknown }).quot3
    expect(await prerenderNow()).toBe(false)
    ;(window as unknown as { quot3: unknown }).quot3 = { image: { prerender } }
    useBillStore.getState().loadBill({ ...createEmptyBill({ branchId: 'b', rowCount: 0 }) })
    expect(await prerenderNow()).toBe(false)
    expect(prerender).not.toHaveBeenCalled()
  })
  it('the watcher waits for edits to settle: rapid edits give ONE request after the idle delay', async () => {
    const stop = startImagePrerender()
    S().setCellText(S().rows[0]!.id, 'rate', '6')
    await vi.advanceTimersByTimeAsync(IMAGE_PRERENDER_IDLE_MS - 100)
    S().setCellText(S().rows[0]!.id, 'rate', '7')
    await vi.advanceTimersByTimeAsync(IMAGE_PRERENDER_IDLE_MS - 100)
    expect(prerender).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    await vi.runAllTimersAsync()
    expect(prerender).toHaveBeenCalledTimes(1)
    stop()
  })
  it('a rejected bridge call is swallowed and allows a retry', async () => {
    prerender.mockRejectedValueOnce(new Error('boom'))
    await expect(prerenderNow()).resolves.toBe(true)
    expect(await prerenderNow()).toBe(true)
  })
})
