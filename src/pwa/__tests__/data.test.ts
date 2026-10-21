import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { DB_NAME, DB_VERSION, PhoneDbError, STORE_NAMES, countRecords, openPhoneDb, putRecord, type PhoneDb } from '../data/db'
import { ensureMeta, getMeta, getMetaValue, setMetaValue } from '../data/metaRepo'
import { getAllSettings, getSetting, resetSetting, setSetting } from '../data/settingsRepo'
import { computeBackupStatus, exportBackup, getBackupStatus, importBackup, parseBackup } from '../data/backup'
import { acquireWriterLock, type ChannelLike, type LockManagerLike } from '../platform/writerLock'
import { formatBytes, readStorageHealth, requestPersistence } from '../platform/storage'

const NOW = new Date('2026-10-21T10:00:00.000Z')
const fresh = (writer?: { held: boolean }): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer })

describe('open and upgrade', () => {
  it('creates every store with its indexes at DB_VERSION', async () => {
    const db = await fresh()
    expect(db.idb.name).toBe(DB_NAME)
    expect(db.idb.version).toBe(DB_VERSION)
    expect([...db.idb.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort())
    const bills = db.idb.transaction('bills').objectStore('bills')
    expect([...bills.indexNames].sort()).toEqual(['bill_date', 'deleted_at', 'party_id', 'po_number'])
    expect(db.idb.transaction('bill_revisions').objectStore('bill_revisions').keyPath).toEqual(['bill_id', 'revision'])
    expect(db.idb.transaction('sync_aside').objectStore('sync_aside').keyPath).toEqual(['kind', 'rec_id'])
    db.close()
  })
  it('reopening keeps data; a database newer than the app is refused with "newer-version"', async () => {
    const factory = new IDBFactory()
    const a = await openPhoneDb({ factory })
    await setSetting(a, 'theme.name', 'light')
    a.close()
    const b = await openPhoneDb({ factory })
    expect(await getSetting(b, 'theme.name')).toBe('light')
    b.close()
    // Simulate a newer app having upgraded the database.
    await new Promise<void>((res, rej) => {
      const r = factory.open(DB_NAME, DB_VERSION + 1)
      r.onsuccess = () => { r.result.close(); res() }
      r.onerror = () => rej(r.error)
    })
    await expect(openPhoneDb({ factory })).rejects.toMatchObject({ code: 'newer-version' })
  })
  it('reports unavailable when there is no IndexedDB', async () => {
    await expect(openPhoneDb({ factory: { open: () => { throw new Error('no') } } as unknown as IDBFactory })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('meta and settings', () => {
  it('meta has defaults, writes created_at once, and round-trips values', async () => {
    const db = await fresh()
    expect((await getMeta(db)).po_counter).toBe(0)
    const m = await ensureMeta(db, NOW)
    expect(m.created_at).toBe(NOW.toISOString())
    await ensureMeta(db, new Date('2027-01-01T00:00:00Z'))
    expect((await getMeta(db)).created_at).toBe(NOW.toISOString())
    await setMetaValue(db, 'po_prefix', 'PH')
    await setMetaValue(db, 'po_counter', 7)
    expect(await getMetaValue(db, 'po_prefix')).toBe('PH')
    expect(await getMetaValue(db, 'po_counter')).toBe(7)
  })
  it('settings return defaults, round-trip, reset, and accept free keys', async () => {
    const db = await fresh()
    expect(await getSetting(db, 'backup.reminderDays')).toBe(14)
    expect(await getSetting(db, 'appLock.enabled')).toBe(false)
    await setSetting(db, 'company.profile', { name: 'Test Co', phone: '1', address: 'A', logoDataUrl: null })
    expect((await getSetting(db, 'company.profile')).name).toBe('Test Co')
    await setSetting(db, 'custom.flag', { a: 1 })
    expect(await getSetting(db, 'custom.flag', null)).toEqual({ a: 1 })
    await resetSetting(db, 'company.profile')
    expect((await getSetting(db, 'company.profile')).name).toBe('')
    expect(Object.keys(await getAllSettings(db))).toEqual(['custom.flag'])
  })
})

describe('single writer', () => {
  it('a read-only db reads but every write throws "read-only"', async () => {
    const w = { held: true }
    const db = await fresh(w)
    await setSetting(db, 'theme.name', 'light')
    w.held = false
    expect(await getSetting(db, 'theme.name')).toBe('light')
    await expect(setSetting(db, 'theme.name', 'navy-ember')).rejects.toMatchObject({ code: 'read-only' })
    await expect(setMetaValue(db, 'po_counter', 1)).rejects.toBeInstanceOf(PhoneDbError)
  })
  it('Web Locks: the first tab holds, the second does not, and it can after release', async () => {
    let held = false
    const waiters: (() => void)[] = []
    const locks: LockManagerLike = {
      request: async (_n, _o, cb) => {
        if (held) return cb(null)
        held = true
        const p = cb({}) as Promise<void>
        void p.then(() => { held = false; waiters.forEach((f) => f()) })
        return p
      }
    }
    const tab1 = await acquireWriterLock({ locks })
    const tab2 = await acquireWriterLock({ locks })
    expect(tab1.held).toBe(true)
    expect(tab2.held).toBe(false)
    tab1.release()
    await new Promise((r) => setTimeout(r, 0))
    const tab3 = await acquireWriterLock({ locks })
    expect(tab3.held).toBe(true)
  })
  it('BroadcastChannel fallback: a second tab sees the first and stays read-only', async () => {
    const listeners: ((e: { data: unknown }) => void)[][] = []
    const make = (): ChannelLike => {
      const mine: ((e: { data: unknown }) => void)[] = []
      listeners.push(mine)
      return {
        postMessage: (m) => listeners.forEach((l) => { if (l !== mine) l.forEach((f) => f({ data: m })) }),
        addEventListener: (_t, fn) => { mine.push(fn) },
        close: () => {}
      }
    }
    const t1 = await acquireWriterLock({ createChannel: make, fallbackWaitMs: 5 })
    const t2 = await acquireWriterLock({ createChannel: make, fallbackWaitMs: 5 })
    expect(t1.held).toBe(true)
    expect(t2.held).toBe(false)
  })
  it('with no primitive at all the lock reports method "none" and held', async () => {
    const l = await acquireWriterLock({})
    expect(l).toMatchObject({ held: true, method: 'none' })
  })
})

describe('backup', () => {
  async function seeded(): Promise<PhoneDb> {
    const db = await fresh()
    await ensureMeta(db, NOW)
    await setSetting(db, 'theme.name', 'light')
    await setSetting(db, 'secret.session', { token: 'x' })
    await putRecord(db, 'bills', { id: 'b1', bill_date: '2026-10-21', party_id: 'p1', po_number: 'PH-1', deleted_at: null, totals: { grand: '1250.50' } })
    await putRecord(db, 'bill_rows', { id: 'r1', bill_id: 'b1', idx: 0, name: 'Pipe', qty: '2', rate: '625.25' })
    await putRecord(db, 'bill_revisions', { bill_id: 'b1', revision: 1, snapshot: {} })
    await putRecord(db, 'parties', { id: 'p1', name: 'Acme', name_norm: 'acme', phone: '9' })
    await putRecord(db, 'sync_record_state', { kind: 'bill', rec_id: 'b1', base_version: 3 })
    return db
  }
  it('export then import into a fresh db restores every row; money strings are unchanged', async () => {
    const src = await seeded()
    const file = await exportBackup(src, { appVersion: '0.1.16', now: () => NOW })
    expect(file.fileName).toMatch(/^quot3-phone-backup-2026-10-2[01]\.json$/)
    expect(file.counts.bills).toBe(1)
    expect(await getMetaValue(src, 'last_export_at')).toBe(NOW.toISOString())
    const dst = await fresh()
    const res = await importBackup(dst, file.blob, () => NOW)
    expect(res.counts).toMatchObject({ bills: 1, bill_rows: 1, parties: 1, sync_record_state: 1 })
    const row = await new Promise<{ totals: { grand: string } }>((resolve) => {
      const r = dst.idb.transaction('bills').objectStore('bills').get('b1')
      r.onsuccess = () => resolve(r.result)
    })
    expect(row.totals.grand).toBe('1250.50')
    expect(await getSetting(dst, 'theme.name')).toBe('light')
    expect(await getMetaValue(dst, 'last_import_at')).toBe(NOW.toISOString())
    expect(await countRecords(dst, 'bill_revisions')).toBe(1)
  })
  it('never exports secret.* settings and keeps the local ones on import', async () => {
    const src = await seeded()
    const file = await exportBackup(src, { appVersion: '0.1.16', now: () => NOW })
    expect(await file.blob.text()).not.toContain('secret.session')
    const dst = await fresh()
    await setSetting(dst, 'secret.session', { token: 'mine' })
    await importBackup(dst, file.blob)
    expect(await getSetting(dst, 'secret.session', null)).toEqual({ token: 'mine' })
  })
  it('import replaces existing data rather than merging', async () => {
    const src = await seeded()
    const file = await exportBackup(src, { appVersion: '0.1.16', now: () => NOW })
    const dst = await fresh()
    await putRecord(dst, 'parties', { id: 'old', name: 'Old', name_norm: 'old', phone: '1' })
    await importBackup(dst, file.blob)
    expect(await countRecords(dst, 'parties')).toBe(1)
  })
  it('rejects non-backups, newer formats and unknown parts without changing anything', async () => {
    const dst = await fresh()
    await putRecord(dst, 'parties', { id: 'keep', name: 'Keep', name_norm: 'keep', phone: '1' })
    await expect(importBackup(dst, 'not json')).rejects.toMatchObject({ code: 'bad-backup' })
    await expect(importBackup(dst, JSON.stringify({ hello: 1 }))).rejects.toMatchObject({ code: 'bad-backup' })
    const base = { format: 'quot3-phone-backup', app_version: '9', exported_at: NOW.toISOString() }
    await expect(importBackup(dst, JSON.stringify({ ...base, format_version: 2, stores: {} }))).rejects.toMatchObject({ code: 'newer-backup' })
    await expect(importBackup(dst, JSON.stringify({ ...base, format_version: 1, stores: { evil: [] } }))).rejects.toMatchObject({ code: 'bad-backup' })
    expect(await countRecords(dst, 'parties')).toBe(1)
  })
  it('a damaged row aborts the whole import (atomic)', async () => {
    const dst = await fresh()
    await putRecord(dst, 'parties', { id: 'keep', name: 'Keep', name_norm: 'keep', phone: '1' })
    const bad = JSON.stringify({
      format: 'quot3-phone-backup', format_version: 1, app_version: '1', exported_at: NOW.toISOString(),
      stores: { parties: [{ id: 'new', name: 'New', name_norm: 'new', phone: '2' }], bills: [{ no_id_here: true }] }
    })
    await expect(importBackup(dst, bad)).rejects.toMatchObject({ code: 'bad-backup' })
    expect(await countRecords(dst, 'parties')).toBe(1)
    expect(await countRecords(dst, 'bills')).toBe(0)
  })
  it('a read-only tab cannot import but can still export (and does not stamp last_export_at)', async () => {
    const w = { held: true }
    const db = await fresh(w)
    w.held = false
    await expect(importBackup(db, '{}')).rejects.toMatchObject({ code: 'read-only' })
    const f = await exportBackup(db, { appVersion: '1', now: () => NOW })
    expect(f.counts.bills).toBe(0)
    expect(await getMetaValue(db, 'last_export_at')).toBeNull()
  })
  it('parseBackup accepts a good file without a database', async () => {
    const p = await parseBackup(JSON.stringify({ format: 'quot3-phone-backup', format_version: 1, app_version: '1', exported_at: 'x', stores: {} }))
    expect(p.format_version).toBe(1)
  })
})

describe('last export is old', () => {
  const base = { now: NOW, reminderDays: 14 }
  it('never only when data exists; old at the threshold; ok before it', () => {
    expect(computeBackupStatus({ ...base, lastExportAt: null, hasData: false })).toEqual({ state: 'ok', daysSince: null })
    expect(computeBackupStatus({ ...base, lastExportAt: null, hasData: true })).toEqual({ state: 'never', daysSince: null })
    expect(computeBackupStatus({ ...base, lastExportAt: '2026-10-08T10:00:00.000Z', hasData: true })).toEqual({ state: 'ok', daysSince: 13 })
    expect(computeBackupStatus({ ...base, lastExportAt: '2026-10-07T10:00:00.000Z', hasData: true })).toEqual({ state: 'old', daysSince: 14 })
  })
  it('uses 14 days by default and the stored reminder when set', async () => {
    const db = await fresh()
    await putRecord(db, 'bills', { id: 'b', bill_date: 'x', party_id: 'p', po_number: '1', deleted_at: null })
    await setMetaValue(db, 'last_export_at', '2026-10-01T10:00:00.000Z')
    expect(await getBackupStatus(db, NOW)).toEqual({ state: 'old', daysSince: 20 })
    await setSetting(db, 'backup.reminderDays', 30)
    expect(await getBackupStatus(db, NOW)).toEqual({ state: 'ok', daysSince: 20 })
  })
})

describe('storage health', () => {
  it('requests persistence once, tolerates failures, and reads usage', async () => {
    let persisted = false
    let calls = 0
    const env = { storage: { persisted: async () => persisted, persist: async () => { calls++; persisted = true; return true }, estimate: async () => ({ usage: 5_242_880, quota: 1_073_741_824 }) } }
    expect(await requestPersistence(env)).toBe(true)
    expect(await requestPersistence(env)).toBe(true)
    expect(calls).toBe(1)
    expect(await readStorageHealth(env)).toEqual({ persistApiAvailable: true, persisted: true, usageBytes: 5_242_880, quotaBytes: 1_073_741_824 })
    expect(await requestPersistence({})).toBe(false)
    expect(await readStorageHealth({})).toEqual({ persistApiAvailable: false, persisted: null, usageBytes: null, quotaBytes: null })
    expect(await requestPersistence({ storage: { persist: async () => { throw new Error('x') } } })).toBe(false)
  })
  it('formats bytes', () => {
    expect(formatBytes(null)).toBe('unknown')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(5_242_880)).toBe('5.0 MB')
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB')
  })
})
