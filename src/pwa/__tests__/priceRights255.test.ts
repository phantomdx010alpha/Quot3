import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb } from '../data/db'
import { readCachedPerms, readRightsAsk } from '../data/priceRights'
import { PhoneSyncError } from '../sync/errors'
import { priceSyncLines } from '../sync/priceSyncWords'
import { createPhoneSyncRuntime } from '../sync/runtime'
import { loadPriceSyncStatus } from '../ui/priceSyncStatus'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

// Phase 255 (M24): the phone records the last rights ask, keeps the last good flags on failure, and shows both in the sync status. Invented values only.
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const form = { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon-key-for-tests', licenseKey: LICENSE, email: 'seat2@example.test', password: 'pw-2-secret', branchName: 'Android phone', poPrefix: 'PH' }

async function setup() {
  const server = new InMemorySharedServer({ now: () => Date.parse('2026-11-13T10:00:00.000Z') })
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats: [{ email: 'seat1@example.test', password: 'pw-1-secret' }, { email: 'seat2@example.test', password: 'pw-2-secret' }] })
  server.setPricePerms(orgId, 2, { add: true, edit: true })
  const ctl = { fail: false }
  const db = await openPhoneDb({ factory: new IDBFactory() })
  const rt = createPhoneSyncRuntime({
    db, appVer: '0.1.55-test',
    makeTransport: () => {
      const t = new InMemorySharedTransport(server)
      const real = t.pricePermsGet
      t.pricePermsGet = (a) => (ctl.fail ? Promise.reject(new PhoneSyncError('server', 'The main branch could not be reached.')) : real(a))
      return t
    },
    engine: { storage: async () => ({ quota: null, usage: null }), pollMs: 3_600_000 }
  })
  expect((await rt.link(form)).ok).toBe(true)
  return { db, rt, ctl }
}

describe('Phase 255 - phone rights refresh', () => {
  it('a good ask caches the flags and records "worked"; a failed ask keeps the flags and records the reason', async () => {
    const { db, rt, ctl } = await setup()
    await rt.refreshPriceRights()
    const c = await readCachedPerms(db)
    expect(c?.seatNo).toBe(2)
    expect(c?.flags.edit).toBe(true)
    expect(c?.flags.overwrite).toBe(false)
    expect((await readRightsAsk(db)).error).toBe('')
    ctl.fail = true
    await rt.refreshPriceRights()
    expect((await readCachedPerms(db))?.flags.edit).toBe(true)
    const ask = await readRightsAsk(db)
    expect(ask.error).toBe('The main branch could not be reached.')
    expect(ask.at).not.toBe('')
  })
  it('the sync status shows seat, rights, last check and the failure in plain words', async () => {
    const { db, rt, ctl } = await setup()
    await rt.refreshPriceRights()
    ctl.fail = true
    await rt.refreshPriceRights()
    const lines = priceSyncLines(await loadPriceSyncStatus(db)).join(' | ')
    expect(lines).toContain('Rights: Seat 2')
    expect(lines).toContain('fill empty prices')
    expect(lines).toContain('The last rights check failed: The main branch could not be reached.')
  })
  it('the automatic refresh is throttled and records its ask; a phone that never asked has no rights line "answered"', async () => {
    const { db, rt } = await setup()
    expect((await loadPriceSyncStatus(db)).rights?.rights).toContain('has not answered')
    await rt.autoRefreshPriceRights(false)
    const first = (await readRightsAsk(db)).at
    expect(first).not.toBe('')
    await rt.autoRefreshPriceRights(false) // inside 60 s: no new ask
    expect((await readRightsAsk(db)).at).toBe(first)
  })
})
