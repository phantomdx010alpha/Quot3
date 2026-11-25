// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { App as AppRaw, type AppProps } from '../App'
import { openPhoneDb, putRecord, txDone, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { resetPhoneData } from '../data/resetData'
import type { MarkerStore } from '../platform/clearedData'
import {
  INSTALL_STEPS_TEXT, PERSIST_BANNER_TEXT, installedWord, markersWord, persistBanner, protectionState, shouldReRequest, unsyncedLine,
  type ProtectionInputs
} from '../platform/protectionState'
import { enqueueManyTx, markAttempt, listPending } from '../sync/outbox'
import { ProtectionLines } from '../ui/ProtectionLines'
import { checkDataClearedTwo, dbMarker, noteHadRecords, readProtection, unsentBills } from '../ui/protectionRead'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const App = AppRaw as FC<AppProps>
// Phase 292 (M25 T49-T52): protection state, banner, unsynced line, second marker. Invented data, fake storage and outbox only.
const health = (persisted: boolean | null) => ({ persistApiAvailable: true, persisted, usageBytes: 1000, quotaBytes: 5000 })
const base = (o: Partial<ProtectionInputs> = {}): ProtectionInputs => ({ health: health(true), installed: true, pending: 0, markerLocal: true, markerDb: true, ...o })

async function freshDb(): Promise<PhoneDb> {
  return openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
}
async function queue(db: PhoneDb, items: { kind: 'bill' | 'party'; recId: string }[]): Promise<void> {
  const tx = db.idb.transaction('sync_outbox', 'readwrite')
  enqueueManyTx(tx, items.map((i) => ({ ...i, op: 'upsert' as const, revision: 1 })), '2026-10-21T10:00:00Z')
  await txDone(tx)
}
function fakeLocal(initial: string | null = null): MarkerStore & { value: string | null } {
  const m = { value: initial, get: () => m.value, set: () => { m.value = '1' } }
  return m
}

describe('T49 protectionState', () => {
  it('maps persisted / installed to yes, no or unknown and keeps the numbers', () => {
    expect(protectionState(base()).persisted).toBe('yes')
    expect(protectionState(base({ health: health(false) })).persisted).toBe('no')
    expect(protectionState(base({ health: health(null) })).persisted).toBe('unknown')
    expect(protectionState(base({ health: null })).persisted).toBe('unknown')
    expect(protectionState(base({ installed: false })).installed).toBe('no')
    expect(protectionState(base({ installed: null })).installed).toBe('unknown')
    const s = protectionState(base())
    expect([s.used, s.quota]).toEqual([1000, 5000])
  })
  it('takes the newest of the push and pull times, and counts the markers', () => {
    expect(protectionState(base({ pushOkAt: '2026-10-21T09:00:00Z', pullOkAt: '2026-10-21T11:00:00Z' })).lastSyncAt).toBe('2026-10-21T11:00:00Z')
    expect(protectionState(base({ pushOkAt: '2026-10-21T12:00:00Z', pullOkAt: null })).lastSyncAt).toBe('2026-10-21T12:00:00Z')
    expect(protectionState(base()).lastSyncAt).toBeNull()
    expect(protectionState(base()).markers).toBe('both')
    expect(protectionState(base({ markerDb: false })).markers).toBe('one')
    expect(protectionState(base({ markerLocal: false, markerDb: false })).markers).toBe('none')
    expect(markersWord('both')).toBe('two')
    expect(installedWord(protectionState(base({ installed: false })))).toContain('browser')
  })
  it('never lets the pending count go negative or fractional', () => {
    expect(protectionState(base({ pending: -3 })).pending).toBe(0)
    expect(protectionState(base({ pending: 2.9 })).pending).toBe(2)
  })
})

describe('T50 the banner only shows when the browser said it is not kept', () => {
  const opts = { persistApi: true, canInstall: false }
  it('is absent when kept (yes) and when unknown (nothing to tap)', () => {
    expect(persistBanner(protectionState(base()), opts)).toBeNull()
    expect(persistBanner(protectionState(base({ health: health(null) })), opts)).toBeNull()
  })
  it('says the calm sentence, offers Keep my data, and the install steps when no install prompt is waiting', () => {
    const b = persistBanner(protectionState(base({ health: health(false), installed: false })), opts)
    expect(b?.text).toBe(PERSIST_BANNER_TEXT)
    expect(b?.actions).toEqual(['keep'])
    expect(b?.steps).toBe(INSTALL_STEPS_TEXT)
  })
  it('offers the Install button when the browser has an install prompt waiting, and no steps then', () => {
    const b = persistBanner(protectionState(base({ health: health(false), installed: false })), { persistApi: true, canInstall: true })
    expect(b?.actions).toEqual(['keep', 'install'])
    expect(b?.steps).toBeNull()
  })
  it('never promises the data cannot be lost', () => {
    const b = persistBanner(protectionState(base({ health: health(false) })), opts)
    expect(`${b?.text} ${b?.steps}`).not.toMatch(/cannot be lost|never lost|safe forever|leak/i)
  })
  it('re-asks after install always, and after the first save only while it is not kept', () => {
    expect(shouldReRequest(null, 'installed')).toBe(true)
    expect(shouldReRequest(protectionState(base()), 'firstSave')).toBe(false)
    expect(shouldReRequest(protectionState(base({ health: health(false) })), 'firstSave')).toBe(true)
    expect(shouldReRequest(null, 'firstSave')).toBe(true)
  })
})

describe('T51 the unsynced line', () => {
  it('shows only for a linked phone with something waiting', () => {
    expect(unsyncedLine(protectionState(base({ pending: 3 })), true)).toBe('3 bills are only on this phone yet. Sync now.')
    expect(unsyncedLine(protectionState(base({ pending: 1 })), true)).toBe('1 bill is only on this phone yet. Sync now.')
    expect(unsyncedLine(protectionState(base({ pending: 3 })), false)).toBeNull()
    expect(unsyncedLine(protectionState(base({ pending: 0 })), true)).toBeNull()
  })
  it('counts unsent and failed BILL rows once each and ignores customers', async () => {
    const db = await freshDb()
    await queue(db, [{ kind: 'bill', recId: 'b1' }, { kind: 'bill', recId: 'b2' }, { kind: 'bill', recId: 'b3' }, { kind: 'party', recId: 'p1' }])
    const failing = (await listPending(db)).find((r) => r.recId === 'b3')!
    for (let i = 0; i < 20; i++) await markAttempt(db, failing, 'boom')
    expect(await unsentBills(db)).toBe(3)
    db.close?.()
  })
})

describe('T52 the second marker', () => {
  const addParty = (db: PhoneDb): Promise<void> => putRecord(db, 'parties', { id: 'p1', name: 'Acme Test', name_norm: 'acme test', deleted_at: null })
  it('is set only when bills or customers exist, and a fresh linked empty phone is never called cleared', async () => {
    const db = await freshDb()
    const local = fakeLocal()
    await noteHadRecords(db)
    expect(await dbMarker(db).has()).toBe(false)
    expect((await checkDataClearedTwo({ bills: 0, customers: 0, linked: true }, local, dbMarker(db))).verdict).toBe('ok')
    await addParty(db)
    await noteHadRecords(db)
    expect(await dbMarker(db).has()).toBe(true)
    local.set()
    expect(await checkDataClearedTwo({ bills: 2, customers: 1, linked: true }, local, dbMarker(db))).toEqual({ verdict: 'ok', markers: 'both' })
  })
  it('reading the check writes nothing (a screen opening must not touch the database)', async () => {
    const db = await freshDb()
    await checkDataClearedTwo({ bills: 5, customers: 2, linked: true }, fakeLocal(), dbMarker(db))
    expect(await dbMarker(db).has()).toBe(false)
  })
  it('catches a loss the localStorage marker misses (login survived, records gone, localStorage cleared)', async () => {
    const db = await freshDb()
    await addParty(db)
    await noteHadRecords(db)
    // the records are lost, the marker row survives; localStorage was cleared as well; the phone is still linked,
    // so the old rule alone would say ok
    const r = await checkDataClearedTwo({ bills: 0, customers: 0, linked: true }, fakeLocal(null), dbMarker(db))
    expect(r.verdict).toBe('cleared')
    expect(r.markers).toBe('both') // the old rule re-sets its localStorage marker for a linked phone, as it always did
  })
  it('keeps the old rule: unlinked and empty with the localStorage marker is cleared; no marker stores is ok', async () => {
    const db = await freshDb()
    expect((await checkDataClearedTwo({ bills: 0, customers: 0, linked: false }, fakeLocal('1'), dbMarker(db))).verdict).toBe('cleared')
    expect((await checkDataClearedTwo({ bills: 0, customers: 0, linked: false }, null, null)).verdict).toBe('ok')
  })
  it('does not write in a read-only tab', async () => {
    const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: false } })
    await noteHadRecords(db)
    expect(await dbMarker(db).has()).toBe(false)
  })
  it('"Reset phone data" clears it, so an erase the person chose is not reported as a browser wipe', async () => {
    const db = await freshDb()
    await addParty(db)
    await noteHadRecords(db)
    expect(await dbMarker(db).has()).toBe(true)
    await resetPhoneData(db)
    expect(await dbMarker(db).has()).toBe(false)
    expect((await checkDataClearedTwo({ bills: 0, customers: 0, linked: true }, null, dbMarker(db))).verdict).toBe('ok')
  })
})

describe('readProtection (fake storage, fake engine)', () => {
  it('reads the browser answer, the unsent bills, the link and the newest sync time', async () => {
    const db = await freshDb()
    await setMetaValue(db, 'branch_id', 'branch-phone')
    await queue(db, [{ kind: 'bill', recId: 'b1' }, { kind: 'bill', recId: 'b2' }])
    const env = { storage: { persisted: async () => false, estimate: async () => ({ usage: 2048, quota: 4096 }), persist: async () => false } }
    const engine = { status: async () => ({ push: { lastSuccessAt: '2026-10-21T08:00:00Z' }, pull: { lastSuccessAt: '2026-10-21T09:30:00Z' } }) }
    const r = await readProtection(db, { env, installed: false, engine, local: fakeLocal('1') })
    expect(r.linked).toBe(true)
    expect(r.health.persistApiAvailable).toBe(true)
    expect(r.state).toMatchObject({ persisted: 'no', installed: 'no', pending: 2, lastSyncAt: '2026-10-21T09:30:00Z', used: 2048, quota: 4096 })
    expect(r.state.markers).toBe('one')
  })
  it('survives a missing storage API and a failing engine', async () => {
    const db = await freshDb()
    const engine = { status: async () => { throw new Error('down') } }
    const r = await readProtection(db, { env: {}, installed: null, engine })
    expect(r.state).toMatchObject({ persisted: 'unknown', installed: 'unknown', pending: 0, lastSyncAt: null })
    expect(r.linked).toBe(false)
  })
})

describe('ProtectionLines (every layout renders it once, above the home screen)', () => {
  let root: Root | null = null
  afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
  async function show(props: Parameters<typeof ProtectionLines>[0]): Promise<HTMLElement> {
    const host = document.createElement('div'); document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root!.render(createElement(ProtectionLines, props)) })
    return host
  }
  const common = { linked: true, persistApi: true, canInstall: false, canSync: true, onAction: () => undefined }

  it('renders nothing for null, for a kept phone with nothing waiting (classic stays unchanged)', async () => {
    expect((await show({ ...common, state: null })).innerHTML).toBe('')
    root && act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    expect((await show({ ...common, state: protectionState(base()) })).innerHTML).toBe('')
  })
  it('shows the banner with Keep my data and fires the action', async () => {
    const fired: string[] = []
    const host = await show({ ...common, state: protectionState(base({ health: health(false), installed: false })), onAction: (id) => fired.push(id) })
    expect(host.textContent).toContain(PERSIST_BANNER_TEXT)
    const keep = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Ask the browser to keep my data')!
    await act(async () => { keep.click() })
    expect(fired).toEqual(['keep'])
  })
  it('shows the unsynced line with Sync now; nothing is blocked (the button is enabled on a writable phone)', async () => {
    const fired: string[] = []
    const host = await show({ ...common, state: protectionState(base({ pending: 4 })), onAction: (id) => fired.push(id) })
    expect(host.querySelector('[data-testid="protect-unsynced"]')?.textContent).toContain('4 bills are only on this phone yet. Sync now.')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sync now')!
    expect(btn.disabled).toBe(false)
    await act(async () => { btn.click() })
    expect(fired).toEqual(['sync'])
  })
  it('shows no unsynced line for a phone that is not linked, and no Sync button when there is no engine', async () => {
    expect((await show({ ...common, linked: false, state: protectionState(base({ pending: 4 })) })).innerHTML).toBe('')
    root && act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const host = await show({ ...common, canSync: false, state: protectionState(base({ pending: 4 })) })
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Sync now')).toBe(false)
  })
})

describe('the Dashboard of the new layouts shows the unsynced line; classic stays as pinned', () => {
  let root: Root | null = null
  afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
  async function home(layout: 'classic' | 'tidy'): Promise<HTMLElement> {
    const db = await freshDb()
    await setMetaValue(db, 'branch_id', 'branch-phone')
    await queue(db, [{ kind: 'bill', recId: 'b1' }, { kind: 'bill', recId: 'b2' }])
    const host = document.createElement('div'); document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root!.render(createElement(App, { services: { db, now: () => new Date('2026-10-21T10:00:00Z'), engine: null, layout }, backEnv: null })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    return host
  }
  it('tidy: "2 bills are only on this phone yet. Sync now." with nothing blocked and no banner class', async () => {
    const h = await home('tidy')
    expect(h.querySelector('[data-testid="protect-unsynced"]')?.textContent).toContain('2 bills are only on this phone yet. Sync now.')
    expect(h.querySelector('.q3-banner')).toBeNull()
  })
  it('classic: no protection lines (its DOM is pinned by classicParity)', async () => {
    const h = await home('classic')
    expect(h.querySelector('[data-testid="protection-lines"]')).toBeNull()
  })
})
