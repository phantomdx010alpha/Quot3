import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiPanelStore } from '../aiPanelStore'
import type { PartySuggestion } from '@shared/ai/partyHistory'

const row = (name: string): PartySuggestion => ({ nameUsed: name, formatLabel: 'GST', gst: true, lastRate: '90', lastQty: '1', lastUnit: null, lastDate: '2026-10-03', timesBought: 1, tier: 2, score: 1, why: 'looks similar', explanation: 'x' })
type Resolve = (v: unknown) => void
let suggest: ReturnType<typeof vi.fn>
let set: ReturnType<typeof vi.fn>
let getAll: ReturnType<typeof vi.fn>

function install(): void {
  suggest = vi.fn(async (i: { text: string }) => ({ ok: true, data: { suggestions: [row(i.text)], embeddingsUsed: false } }))
  set = vi.fn(async () => ({ ok: true, data: {} }))
  getAll = vi.fn(async () => ({ ok: true, data: { 'ai.enabled': true, 'ai.billingPanel': true } }))
  vi.stubGlobal('window', { quot3: { settings: { set, getAll }, ai: { status: vi.fn(async () => ({ ok: true, data: { state: 'ready' } })), suggestForParty: suggest } } })
}
const live = (): void => useAiPanelStore.setState({ enabled: true, billingPanel: true })

beforeEach(() => {
  vi.useFakeTimers()
  install()
  useAiPanelStore.setState({ enabled: false, billingPanel: false, status: null, partyId: null, partyName: '', cellActive: false, typed: '', rows: [], seq: 0 })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('aiPanelStore (Phase 226)', () => {
  it('asks nothing while off, without a party, or without an active cell', async () => {
    useAiPanelStore.getState().setParty('p1', 'Invented Traders'); useAiPanelStore.getState().setCell(true, 'tom')
    await vi.advanceTimersByTimeAsync(500)
    expect(suggest).not.toHaveBeenCalled()
    live(); useAiPanelStore.getState().setCell(false, '')
    await vi.advanceTimersByTimeAsync(500)
    expect(suggest).not.toHaveBeenCalled()
  })

  it('debounces: several keystrokes inside 150 ms make ONE question, with the last text', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'Invented Traders')
    for (const t of ['t', 'to', 'tom']) { useAiPanelStore.getState().setCell(true, t); await vi.advanceTimersByTimeAsync(50) }
    expect(suggest).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(suggest).toHaveBeenCalledWith({ partyId: 'p1', partyName: 'Invented Traders', text: 'tom' })
    expect(useAiPanelStore.getState().rows.map((r) => r.nameUsed)).toEqual(['tom'])
  })

  it('race: an older answer that arrives after a newer question is ignored', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'A')
    const waits: Resolve[] = []
    suggest.mockImplementation((i: { text: string }) => new Promise((res) => { waits.push(() => res({ ok: true, data: { suggestions: [row(i.text)], embeddingsUsed: false } })) }))
    useAiPanelStore.getState().setCell(true, 'old'); await vi.advanceTimersByTimeAsync(160)
    useAiPanelStore.getState().setCell(true, 'new'); await vi.advanceTimersByTimeAsync(160)
    expect(waits).toHaveLength(2)
    waits[1]!(null); await vi.advanceTimersByTimeAsync(0)
    waits[0]!(null); await vi.advanceTimersByTimeAsync(0)
    expect(useAiPanelStore.getState().rows.map((r) => r.nameUsed)).toEqual(['new'])
  })

  it('a party change drops the rows at once and ignores an answer still in flight', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'A')
    let finish: Resolve = () => undefined
    suggest.mockImplementationOnce(() => new Promise((res) => { finish = () => res({ ok: true, data: { suggestions: [row('stale')], embeddingsUsed: false } }) }))
    useAiPanelStore.getState().setCell(true, 'abc'); await vi.advanceTimersByTimeAsync(160)
    useAiPanelStore.getState().setParty('p2', 'B')
    expect(useAiPanelStore.getState().rows).toEqual([])
    finish(null); await vi.advanceTimersByTimeAsync(0)
    expect(useAiPanelStore.getState().rows).toEqual([])
  })

  it('a bill switch (reset) clears the cell, the party and the rows', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'A'); useAiPanelStore.getState().setCell(true, 'abc'); await vi.advanceTimersByTimeAsync(200)
    expect(useAiPanelStore.getState().rows).toHaveLength(1)
    useAiPanelStore.getState().reset()
    expect(useAiPanelStore.getState()).toMatchObject({ rows: [], cellActive: false, typed: '', partyName: '' })
  })

  it('leaving the cell hides the rows immediately', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'A'); useAiPanelStore.getState().setCell(true, 'abc'); await vi.advanceTimersByTimeAsync(200)
    useAiPanelStore.getState().setCell(false, '')
    expect(useAiPanelStore.getState().rows).toEqual([])
  })

  it('degrades silently: a failing or throwing bridge leaves no rows and throws nothing', async () => {
    live(); useAiPanelStore.getState().setParty('p1', 'A')
    suggest.mockRejectedValueOnce(new Error('boom'))
    useAiPanelStore.getState().setCell(true, 'abc'); await vi.advanceTimersByTimeAsync(200)
    expect(useAiPanelStore.getState().rows).toEqual([])
    suggest.mockResolvedValueOnce({ ok: false, error: { code: 'x', message: 'y' } })
    useAiPanelStore.getState().setCell(true, 'abcd'); await vi.advanceTimersByTimeAsync(200)
    expect(useAiPanelStore.getState().rows).toEqual([])
    vi.stubGlobal('window', {})
    useAiPanelStore.getState().setCell(true, 'abcde'); await vi.advanceTimersByTimeAsync(200)
    await expect(useAiPanelStore.getState().load()).resolves.toBeUndefined()
  })

  it('load reads both switches; toggle writes ai.billingPanel; turning it ON also turns the master on [A], OFF leaves the master alone', async () => {
    await useAiPanelStore.getState().load()
    expect(useAiPanelStore.getState()).toMatchObject({ enabled: true, billingPanel: true })
    useAiPanelStore.setState({ enabled: false, billingPanel: false })
    useAiPanelStore.getState().toggle()
    expect(set).toHaveBeenCalledWith('ai.billingPanel', true)
    expect(set).toHaveBeenCalledWith('ai.enabled', true)
    set.mockClear()
    useAiPanelStore.getState().toggle()
    expect(set).toHaveBeenCalledWith('ai.billingPanel', false)
    expect(set).not.toHaveBeenCalledWith('ai.enabled', expect.anything())
    expect(useAiPanelStore.getState().enabled).toBe(true)
  })
})
