// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb } from '../data/db'
import { SEAT_RIGHTS_STATUS_KEY, getSeatRightsSnapshot, publishSeatRights, readCachedSeatRights, readRightsStatus, resolveSeatRights, seatRightsAskDue, EVERYTHING_SNAPSHOT } from '../data/seatRights'
import { putRecord } from '../data/db'
import { PhoneSyncError } from '../sync/errors'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { useSeatRights } from '../ui/useSeatRights'
import { ALL_SEAT_RIGHTS, PRESETS } from '../../shared/seatRights'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 288 (M25): the phone knows its rights and keeps them fresh. In-memory server, fake IndexedDB, invented values only.
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const form = { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon-key-for-tests', licenseKey: LICENSE, email: 'seat2@example.test', password: 'pw-2-secret', branchName: 'Andheri', poPrefix: 'AN' }

async function setup(o: { installed?: boolean } = {}) {
  const server = new InMemorySharedServer({ now: () => Date.parse('2026-11-24T10:00:00.000Z') })
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats: [{ email: 'seat1@example.test', password: 'pw-1-secret' }, { email: 'seat2@example.test', password: 'pw-2-secret' }] })
  if (o.installed === false) server.setRightsInstalled(orgId, false)
  const ctl = { fail: false, calls: 0 }
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const rt = createPhoneSyncRuntime({
    db, appVer: '0.1.63-test',
    makeTransport: () => {
      const t = new InMemorySharedTransport(server)
      const real = t.seatRightsGet
      t.seatRightsGet = (a) => { ctl.calls++; return ctl.fail ? Promise.reject(new PhoneSyncError('offline')) : real(a) }
      return t
    },
    engine: { storage: async () => ({ quota: null, usage: null }), pollMs: 3_600_000 }
  })
  return { server, orgId, db, rt, ctl }
}
const link = async (rt: Awaited<ReturnType<typeof setup>>['rt']) => { expect((await rt.link(form)).ok).toBe(true) }

describe('Phase 288 phone seat rights', () => {
  it('a phone with no sync has everything', async () => {
    const { rt } = await setup()
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('not_linked')
    expect(rt.getSeatRights().flags).toEqual(ALL_SEAT_RIGHTS)
  })
  it('linked as seat 2 with no row = Staff (default); after seat 1 saves, the phone gets the row on the next ask', async () => {
    const { rt, server, orgId, db } = await setup()
    await link(rt)
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('default_staff')
    expect(rt.getSeatRights().flags).toEqual(PRESETS.Staff)
    server.setSeatRights(orgId, 2, { ...PRESETS.Viewer })
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('admin')
    expect(rt.getSeatRights().flags).toEqual(PRESETS.Viewer)
    expect((await readCachedSeatRights(db))?.seatNo).toBe(2)
    expect((await readRightsStatus(db)).serverKnows).toBe('yes')
  })
  it('the doorbell (a seat 1 Save) refreshes the rights without a manual call', async () => {
    const { rt, server, orgId } = await setup()
    await link(rt)
    await rt.refreshSeatRights({ force: true })
    server.setSeatRights(orgId, 2, { ...PRESETS.Viewer })
    await rt.refreshSeatRights({ force: true, afterRefused: true })
    expect(rt.getSeatRights().flags.seeSales).toBe(true)
  })
  it('offline keeps the last answer and says so; a later good ask clears it', async () => {
    const { rt, server, orgId, ctl, db } = await setup()
    await link(rt)
    server.setSeatRights(orgId, 2, { ...PRESETS.Viewer })
    await rt.refreshSeatRights({ force: true })
    ctl.fail = true
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('cached_offline')
    expect(rt.getSeatRights().flags).toEqual(PRESETS.Viewer)
    expect((await readRightsStatus(db)).error).not.toBe('')
    ctl.fail = false
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('admin')
  })
  it('no answer yet and the server unreachable = Staff, never everything', async () => {
    const { rt, ctl } = await setup()
    await link(rt)
    ctl.fail = true
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('unknown_staff')
    expect(rt.getSeatRights().flags).toEqual(PRESETS.Staff)
  })
  it('an old company project (no SQL 23): everything except editPayments, asked again at most once per 24 h', async () => {
    const { rt, ctl, db } = await setup({ installed: false })
    await link(rt)
    await rt.refreshSeatRights({ force: true })
    expect(rt.getSeatRights().source).toBe('server_unaware')
    expect(rt.getSeatRights().flags).toEqual({ ...ALL_SEAT_RIGHTS, editPayments: false })
    const calls = ctl.calls
    await rt.refreshSeatRights() // throttled: inside 24 h
    await rt.refreshSeatRights({ afterRefused: true })
    expect(ctl.calls).toBe(calls)
    // a day later it asks again
    await putRecord(db, 'meta', { key: SEAT_RIGHTS_STATUS_KEY, value: { serverKnows: 'no', at: new Date(Date.now() - 25 * 3600_000).toISOString(), error: '' } })
    await rt.refreshSeatRights()
    expect(ctl.calls).toBe(calls + 1)
  })
  it('throttle: a normal ask waits 60 s, a refusal 10 s, force always asks', () => {
    const now = Date.parse('2026-11-24T10:01:00.000Z')
    const st = (secAgo: number) => ({ serverKnows: 'yes' as const, at: new Date(now - secAgo * 1000).toISOString(), error: '' })
    const o = { autoMs: 60_000, refusedMs: 10_000 }
    expect(seatRightsAskDue(st(30), now, o)).toBe(false)
    expect(seatRightsAskDue(st(30), now, { ...o, afterRefused: true })).toBe(true)
    expect(seatRightsAskDue(st(5), now, { ...o, afterRefused: true })).toBe(false)
    expect(seatRightsAskDue(st(5), now, { ...o, force: true })).toBe(true)
    expect(seatRightsAskDue({ serverKnows: 'unknown', at: '', error: '' }, now, o)).toBe(true)
  })
  it('seat 1 = everything whatever is cached; unlinked = everything', () => {
    const cached = { seatNo: 1, flags: { ...PRESETS.Viewer }, configured: true, at: '' }
    expect(resolveSeatRights({ linked: true, cached, status: { serverKnows: 'yes', at: '', error: '' } })).toMatchObject({ source: 'seat1', flags: ALL_SEAT_RIGHTS })
    expect(resolveSeatRights({ linked: false, cached: { ...cached, seatNo: 2 }, status: { serverKnows: 'yes', at: '', error: '' } }).flags).toEqual(ALL_SEAT_RIGHTS)
    // a phone that learned it is seat 1 from the Price List answer never gets restricted by the unaware rule
    expect(resolveSeatRights({ linked: true, cached: null, status: { serverKnows: 'no', at: '', error: '' }, seatHint: 1 }).flags).toEqual(ALL_SEAT_RIGHTS)
  })
  it('useSeatRights re-renders when the runtime publishes, and offers can() and plain words', async () => {
    publishSeatRights(EVERYTHING_SNAPSHOT)
    const seen: string[] = []
    function Probe(): null { const r = useSeatRights(); seen.push(`${r.source}:${r.can('deleteBills')}:${r.words.length > 10}`); return null }
    const host = document.createElement('div'); const root = createRoot(host)
    await act(async () => { root.render(createElement(Probe)) })
    await act(async () => { publishSeatRights(resolveSeatRights({ linked: true, cached: { seatNo: 2, flags: { ...PRESETS.Staff }, configured: true, at: 'x' }, status: { serverKnows: 'yes', at: 'x', error: '' } })) })
    expect(seen[0]).toBe('not_linked:true:true')
    expect(seen[seen.length - 1]).toBe('admin:false:true')
    expect(getSeatRightsSnapshot().flags.deleteBills).toBe(false)
    act(() => root.unmount())
    publishSeatRights(EVERYTHING_SNAPSHOT)
  })
})
