import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBackupRepo } from '../../db/backupRepo'
import { applyPendingRestore, PENDING_MARKER } from '../../db/pendingRestore'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService } from '../billService'
import { backupHandlers } from '../../ipc/backup'
import { createBackupService, probeDatabase, type BackupService } from '../backupService'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()) })

interface Ctx { t: TestDb; svc: BackupService; restarts: { n: number }; picked: { path: string | null }; clock: { now: Date } }
function mk(over: { writable?: boolean; keep?: number } = {}): Ctx {
  const t = openTestDb()
  open.push(t)
  const restarts = { n: 0 }, picked = { path: null as string | null }, clock = { now: new Date(2026, 9, 9, 10, 0, 0) }
  const log = { info() {}, warn() {}, error() {} }
  const svc = createBackupService(
    { sqlite: t.handle.sqlite, repo: createBackupRepo(t.handle.sqlite), root: t.dir, backupsDir: t.backupsDir, schemaVersion: t.handle.schemaVersion,
      ports: { pickFile: async () => picked.path, restart: () => { restarts.n++ } }, log },
    { now: () => clock.now, keepAuto: () => over.keep ?? 14, ...(over.writable === false ? { writable: false } : {}) }
  )
  return { t, svc, restarts, picked, clock }
}
let id = 0
function addBills(c: Ctx, n: number): void {
  const bills = createBillService({ sqlite: c.t.handle.sqlite, bills: createBillRepo(c.t.handle.sqlite), parties: createPartyRepo(c.t.handle.sqlite) }, { newId: () => `gen-${++id}` })
  for (let i = 0; i < n; i++) {
    id++
    bills.save({ bill: { id: `bk-${id}`, party: { name: `Party ${id}`, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-09', rows: [row('Pen', '1', '10'), blankRow(), blankRow(), blankRow()] } })
  }
}

describe('backupService (Phase 50)', () => {
  it('a manual backup of a populated DB opens, verifies and matches the bill count', async () => {
    const c = mk(); addBills(c, 3)
    const b = await c.svc.create()
    expect(b).toMatchObject({ kind: 'manual', billCount: 3, readable: true })
    expect(probeDatabase(join(c.t.backupsDir, b.file))).toMatchObject({ ok: true, billCount: 3 })
    expect(c.svc.list().map((x) => x.file)).toContain(b.file)
    expect(c.svc.status().integrity.ok).toBe(true)
  })

  it('one automatic backup per local day, and only the newest N automatic ones are kept', async () => {
    const c = mk({ keep: 2 })
    const manual = await c.svc.create()
    expect((await c.svc.autoIfDue())?.kind).toBe('auto')
    expect(await c.svc.autoIfDue()).toBeNull()
    for (const d of [10, 11, 12]) { c.clock.now = new Date(2026, 9, d, 9, 0, 0); await c.svc.autoIfDue() }
    expect(c.svc.list().filter((b) => b.kind === 'auto')).toHaveLength(2)
    expect(c.svc.list().map((b) => b.file)).toContain(manual.file)
  })

  it('restore refuses without the word, makes a pre-restore backup, stages the file and restarts; the next launch swaps it in', async () => {
    const c = mk(); addBills(c, 2)
    const b = await c.svc.create()
    addBills(c, 1)
    await expect(c.svc.restore({ file: b.file, confirm: 'nope' })).rejects.toThrow(/type restore/i)
    expect(c.restarts.n).toBe(0)
    const r = await c.svc.restore({ file: b.file, confirm: 'restore' })
    expect(c.restarts.n).toBe(1)
    expect(probeDatabase(join(c.t.backupsDir, r.preRestore)).billCount).toBe(3) // the state before the restore is safe
    c.t.handle.close()
    expect(applyPendingRestore(c.t.dir, c.t.file).applied).toBe('restore')
    expect(existsSync(join(c.t.dir, PENDING_MARKER))).toBe(false)
    expect(probeDatabase(c.t.file).billCount).toBe(2)
    expect(applyPendingRestore(c.t.dir, c.t.file).applied).toBeNull() // never applied twice
  })

  it('corrupt and foreign files are shown as unreadable and refused; names cannot escape the folder', async () => {
    const c = mk()
    await c.svc.create()
    writeFileSync(join(c.t.backupsDir, 'manual-corrupt.db'), 'not a database at all')
    expect(c.svc.list().find((b) => b.file === 'manual-corrupt.db')?.readable).toBe(false)
    await expect(c.svc.restore({ file: 'manual-corrupt.db', confirm: 'RESTORE' })).rejects.toThrow(/cannot be restored/i)
    await expect(c.svc.restore({ file: '../quot3.db', confirm: 'RESTORE' })).rejects.toThrow(/not a backup/i)
    expect(() => c.svc.delete('..\\x.db')).toThrow(/not a backup/i)
    expect(() => c.svc.delete('manual-missing.db')).toThrow(/no longer/i)
    expect(c.restarts.n).toBe(0)
  })

  it('pre-migration copies from Phase 5 are adopted into the list', async () => {
    const c = mk()
    const b = await c.svc.create()
    copyFileSync(join(c.t.backupsDir, b.file), join(c.t.backupsDir, 'pre-migration-v0-to-v1-x.db'))
    expect(c.svc.list().find((x) => x.file === 'pre-migration-v0-to-v1-x.db')).toMatchObject({ kind: 'pre-migration', readable: true })
  })

  it('import copies a good file in as `imported`, refuses garbage, and cancel changes nothing', async () => {
    const c = mk(); addBills(c, 2)
    const b = await c.svc.create()
    c.picked.path = null
    expect(await c.svc.importFile()).toEqual({ cancelled: true })
    c.picked.path = join(c.t.backupsDir, b.file)
    const imp = await c.svc.importFile()
    expect(imp.backup).toMatchObject({ kind: 'imported', billCount: 2 })
    writeFileSync(join(c.t.dir, 'junk.db'), 'junk')
    c.picked.path = join(c.t.dir, 'junk.db')
    await expect(c.svc.importFile()).rejects.toThrow(/not a usable/i)
  })

  it('reset needs the word, backs up first, and the next launch removes the database', async () => {
    const c = mk(); addBills(c, 1)
    await expect(c.svc.resetLocalData({ confirm: 'x' })).rejects.toThrow(/type reset/i)
    const r = await c.svc.resetLocalData({ confirm: 'RESET' })
    expect(probeDatabase(join(c.t.backupsDir, r.preRestore)).billCount).toBe(1)
    c.t.handle.close()
    expect(applyPendingRestore(c.t.dir, c.t.file).applied).toBe('reset')
    expect(existsSync(c.t.file)).toBe(false)
  })

  it('a read-only database refuses create / restore / import / reset but still lists', async () => {
    const c = mk({ writable: false })
    await expect(c.svc.create()).rejects.toThrow(/read-only/i)
    await expect(c.svc.restore({ file: 'manual-1.db', confirm: 'RESTORE' })).rejects.toThrow(/read-only/i)
    await expect(c.svc.resetLocalData({ confirm: 'RESET' })).rejects.toThrow(/read-only/i)
    expect(c.svc.list()).toEqual([])
    expect(c.svc.status().readOnly).toBe(true)
  })

  it('IPC: strict validation, and a round trip through the handlers', async () => {
    const c = mk(); const h = backupHandlers(c.svc)
    expect(await h['backup:create']!({ extra: 1 })).toMatchObject({ ok: false })
    expect(await h['backup:restore']!({ file: 'a.db' })).toMatchObject({ ok: false })
    const made = await h['backup:create']!({}) as { ok: boolean; data: { file: string } }
    expect(made.ok).toBe(true)
    const list = await h['backup:list']!({}) as { ok: boolean; data: { file: string }[] }
    expect(list.data.map((x) => x.file)).toContain(made.data.file)
    expect(await h['backup:delete']!({ file: made.data.file })).toMatchObject({ ok: true })
    expect(readFileSync(c.t.file).length).toBeGreaterThan(0)
  })
})
