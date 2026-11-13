import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceActivityAccess, PriceActivityPage } from '@shared/pricelist/api'
import type { PriceLogRow } from '@shared/pricelist/apiLog'
import { LOG_RETENTION_RANGE, PRICELIST_KEYS } from '@shared/pricelist/settings'
import { usePriceActivityStore } from '../priceActivityStore'

// Phase 243 (M23): the Activity store. The bridge is mocked; invented entries only.
const st = () => usePriceActivityStore.getState()
const ok = <T,>(data: T) => ({ ok: true as const, data })
const bad = (message: string) => ({ ok: false as const, error: { code: 'VALIDATION', message } })
const entry = (id: number): PriceLogRow => ({ id, at: '2026-11-13T00:00:00Z', seatNo: 1, deviceKind: 'pc', kind: 'row', recId: `r${id}`, entity: 'row', op: 'add', path: `A › B › Item ${id}`, count: 1 }) as unknown as PriceLogRow
let access: PriceActivityAccess
let pages: PriceActivityPage[]
let calls: string[]
let setReply: () => unknown

beforeEach(() => {
  access = { canView: true, visible: true, source: 'server', retentionDays: 365 }
  pages = [{ rows: [entry(3), entry(2)], next: 2, source: 'server' }, { rows: [entry(1)], source: 'server' }]
  calls = []
  setReply = () => ok(true)
  vi.stubGlobal('window', { quot3: {
    pricelist: {
      activityAccess: async () => { calls.push('access'); return ok(access) },
      activity: async (q: { limit?: number; beforeId?: number }) => { calls.push(`activity:${q.beforeId ?? 'first'}`); return ok(q.beforeId === undefined ? pages[0]! : pages[1]!) },
      activityCsv: async () => { calls.push('csv'); return ok({ csv: 'When,Seat\r\n', count: 1, truncated: false }) }
    },
    settings: { set: async (k: string, v: unknown) => { calls.push(`set:${k}=${String(v)}`); return setReply() } }
  } })
  usePriceActivityStore.getState().reset()
})

describe('priceActivityStore (Phase 243)', () => {
  it('load shows the list only when the view is allowed AND switched on', async () => {
    await st().load()
    expect(st().rows.map((r) => r.id)).toEqual([3, 2])
    expect(st().source).toBe('server')
    access = { ...access, visible: false }
    await st().load()
    expect(st().rows).toEqual([])
    expect(calls.filter((c) => c.startsWith('activity:')).length).toBe(1)
    access = { canView: false, visible: true, source: null, retentionDays: 365 }
    await st().load()
    expect(st().access?.canView).toBe(false)
    expect(st().rows).toEqual([])
  })
  it('more pages older entries after the last id and stops at the end', async () => {
    await st().load()
    await st().more()
    expect(st().rows.map((r) => r.id)).toEqual([3, 2, 1])
    expect(st().next).toBeNull()
    await st().more()
    expect(calls.filter((c) => c === 'activity:2').length).toBe(1)
  })
  it('setVisible saves the key and reloads; a refused save shows the words and does not reload', async () => {
    access = { ...access, visible: false }
    await st().load()
    access = { ...access, visible: true }
    await st().setVisible(true)
    expect(calls).toContain(`set:${PRICELIST_KEYS.logVisible}=true`)
    expect(st().rows.length).toBe(2)
    setReply = () => bad('No.')
    const n = calls.length
    await st().setVisible(false)
    expect(st().error).toBe('No.')
    expect(calls.slice(n)).toEqual([`set:${PRICELIST_KEYS.logVisible}=false`])
  })
  it('setRetention clamps to the allowed range and keeps the access in step', async () => {
    await st().load()
    await st().setRetention(1e9)
    expect(st().access?.retentionDays).toBe(LOG_RETENTION_RANGE.max)
    await st().setRetention(-5)
    expect(st().access?.retentionDays).toBe(LOG_RETENTION_RANGE.min)
  })
  it('exportCsv builds a Blob download; a refusal is shown in words', async () => {
    const click = vi.fn()
    const made: Blob[] = []
    const el = { href: '', download: '', click, remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => el, body: { appendChild: vi.fn() } })
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { made.push(b); return 'blob:x' }, revokeObjectURL: vi.fn() })
    expect(await st().exportCsv()).toBe(true)
    expect(click).toHaveBeenCalled()
    expect(el.download).toBe('price-list-activity.csv')
    expect(await made[0]!.text()).toContain('When,Seat')
    ;(window as unknown as { quot3: { pricelist: { activityCsv: () => Promise<unknown> } } }).quot3.pricelist.activityCsv = async () => bad('Only the main branch can export.')
    expect(await st().exportCsv()).toBe(false)
    expect(st().error).toBe('Only the main branch can export.')
  })
  it('a failed list call shows words and never throws', async () => {
    ;(window as unknown as { quot3: { pricelist: { activity: () => Promise<unknown> } } }).quot3.pricelist.activity = async () => bad('Offline.')
    await expect(st().load()).resolves.toBeUndefined()
    expect(st().error).toBe('Offline.')
    expect(st().rows).toEqual([])
  })
})
