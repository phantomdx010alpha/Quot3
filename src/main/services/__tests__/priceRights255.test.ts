import { describe, expect, it } from 'vitest'
import { AppError } from '../../ipc/envelope'
import { AUTO_REFRESH_MS, PERMS_STATE_KEY, createPriceRightsService, type PriceRightsDeps } from '../priceRightsService'
import { AUTO_REFRESH_MS as SHARED_MS, REFUSED_REFRESH_MS, autoRefreshDue, rightsStatusView, ALL_RIGHTS, NO_RIGHTS } from '../../../shared/pricelist/perms'

// Phase 255 (M24): the rights status, the recorded error and the throttled automatic refresh. Fake store + fake server answer; invented values only.
function make(o: { seat?: number | null; active?: boolean } = {}) {
  const store = new Map<string, string>()
  const t = { at: Date.parse('2026-11-13T10:00:00.000Z') }
  const server = { fail: null as Error | null, calls: 0, answer: { seatNo: 2, flags: { add: true, edit: true, overwrite: false, delete: false, structure: false } as Record<string, boolean> } }
  const deps: PriceRightsDeps = {
    sync: { get: (k) => store.get(k), set: (k, v) => { store.set(k, v) } },
    syncActive: () => o.active !== false,
    seatNo: () => (o.seat === undefined ? 2 : o.seat),
    connect: async () => {
      if (server.fail) throw server.fail
      return { transport: { pricePermsGet: async () => { server.calls++; return server.answer } } as never, creds: { license: 'Q3-TEST' } }
    },
    log: { info: () => undefined, warn: () => undefined }
  }
  const svc = createPriceRightsService(deps, { now: () => new Date(t.at) })
  return { svc, store, t, server }
}

describe('Phase 255 - a seat that never heard from the server, and a refresh that fails', () => {
  it('FINDING: before any answer a non-seat-1 PC has no rights; the failed ask is now RECORDED (it was a silent info line)', async () => {
    const m = make()
    m.server.fail = new Error('socket hang up')
    expect(m.svc.own()).toEqual(NO_RIGHTS)
    const i = await m.svc.refresh()
    expect(i.flags).toEqual(NO_RIGHTS)
    expect(i.answeredAt).toBeNull()
    expect(i.checkedAt).not.toBeNull()
    expect(i.lastError).not.toBe('')
  })
  it('a good answer is cached, clears the error; a later failure keeps the last good flags and records the reason', async () => {
    const m = make()
    const ok = await m.svc.refresh()
    expect(ok.flags.edit).toBe(true)
    expect(ok.lastError).toBe('')
    expect(ok.answeredAt).not.toBeNull()
    m.server.fail = new AppError('VALIDATION', 'Could not reach the main branch.')
    const bad = await m.svc.refresh()
    expect(bad.flags.edit).toBe(true)
    expect(bad.lastError).toBe('Could not reach the main branch.')
    m.server.fail = null
    expect((await m.svc.refresh()).lastError).toBe('')
  })
  it('a server answer for another seat number is never used locally and says so', async () => {
    const m = make({ seat: 3 })
    const i = await m.svc.refresh() // the server answers seat 2
    expect(i.flags).toEqual(NO_RIGHTS)
    expect(i.lastError).toContain('seat 2')
    expect(m.store.get(PERMS_STATE_KEY)).toBeDefined()
  })
  it('without shared sync nothing is asked and every right stays', async () => {
    const m = make({ active: false })
    expect((await m.svc.refresh()).flags).toEqual(ALL_RIGHTS)
    await m.svc.auto(false)
    expect(m.server.calls).toBe(0)
  })
})

describe('Phase 255 - automatic refresh is throttled and skips seat 1', () => {
  it('first call asks; again inside 60 s does not; after 60 s it does', async () => {
    const m = make()
    await m.svc.auto(false)
    await m.svc.auto(false)
    expect(m.server.calls).toBe(1)
    m.t.at += AUTO_REFRESH_MS + 1
    await m.svc.auto(false)
    expect(m.server.calls).toBe(2)
  })
  it('after a refused push it may ask again after 10 s (not 60)', async () => {
    const m = make()
    await m.svc.auto(false)
    m.t.at += REFUSED_REFRESH_MS + 1
    await m.svc.auto(false)
    expect(m.server.calls).toBe(1)
    await m.svc.auto(true)
    expect(m.server.calls).toBe(2)
  })
  it('seat 1 never asks automatically', async () => {
    const m = make({ seat: 1 })
    await m.svc.auto(true)
    expect(m.server.calls).toBe(0)
  })
  it('a failed automatic ask is recorded, never thrown', async () => {
    const m = make()
    m.server.fail = new Error('offline')
    await expect(m.svc.auto(false)).resolves.toBeUndefined()
    expect(m.svc.info().lastError).not.toBe('')
  })
})

describe('Phase 255 - shared words and throttle rule', () => {
  it('the constants are shared and the due rule is pure', () => {
    expect(AUTO_REFRESH_MS).toBe(SHARED_MS)
    expect(autoRefreshDue('', 1000, false)).toBe(true)
    expect(autoRefreshDue('not a date', 1000, false)).toBe(true)
    const at = '2026-11-13T10:00:00.000Z'
    const ms = Date.parse(at)
    expect(autoRefreshDue(at, ms + 59_000, false)).toBe(false)
    expect(autoRefreshDue(at, ms + 11_000, true)).toBe(true)
  })
  it('status words: sync off, seat 1, never answered, read only, some rights, an error', () => {
    const base = { seatNo: 2, syncActive: true, flags: { ...NO_RIGHTS }, checkedAt: null, answeredAt: null, lastError: '' }
    expect(rightsStatusView({ ...base, syncActive: false }).seat).toContain('off')
    expect(rightsStatusView({ ...base, seatNo: 1, flags: { ...ALL_RIGHTS } }).rights).toBe('Everything is allowed.')
    expect(rightsStatusView(base).rights).toContain('has not answered')
    expect(rightsStatusView(base).checked).toBe('Not checked yet.')
    const got = { ...base, answeredAt: 'A', checkedAt: 'B' }
    expect(rightsStatusView(got).rights).toContain('Read only')
    expect(rightsStatusView({ ...got, flags: { ...NO_RIGHTS, edit: true } }).rights).toContain('fill empty prices')
    expect(rightsStatusView({ ...got, lastError: 'No connection.' }).error).toBe('No connection.')
  })
})
