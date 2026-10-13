import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBackupRepo } from '../../db/backupRepo'
import { applyPendingRestore, PENDING_MARKER } from '../../db/pendingRestore'
import { applyPendingWipeData } from '../../db/wipeApply'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService } from '../billService'
import { createBackupService, probeDatabase } from '../backupService'
import { createWipeService } from '../wipeService'
import { wipeHandlers, publisherHandlers } from '../../ipc/wipe'
import { WIPE_MARKER } from '../../../shared/wipe/wipeRules'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()) })

let n = 0
function setup(): { t: TestDb; restarts: { n: number }; svc: ReturnType<typeof createWipeService> } {
  const t = openTestDb(); open.push(t)
  const log = { info() {}, warn() {}, error() {} }
  const restarts = { n: 0 }
  const backup = createBackupService(
    { sqlite: t.handle.sqlite, repo: createBackupRepo(t.handle.sqlite), root: t.dir, backupsDir: t.backupsDir, schemaVersion: t.handle.schemaVersion, ports: { pickFile: async () => null, restart() {} }, log },
    {}
  )
  const bills = createBillService({ sqlite: t.handle.sqlite, bills: createBillRepo(t.handle.sqlite), parties: createPartyRepo(t.handle.sqlite) }, { newId: () => `gen-${++n}` })
  for (let i = 0; i < 3; i++) bills.save({ bill: { id: `w-${++n}`, party: { name: `Party ${n}`, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-11', rows: [row('Pen', '1', '10'), blankRow(), blankRow(), blankRow()] } })
  t.handle.sqlite.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('company.name', '\"Acme\"', 'x')").run()
  const svc = createWipeService({ root: t.dir, backup: { create: (k) => backup.create(k) }, restart: () => { restarts.n++ }, log })
  return { t, restarts, svc }
}
const count = (t: TestDb, table: string): number => (t.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
const opts = (level: 1 | 2, extra: object = {}): object => ({ level, poStart: 500, removeBackups: false, removeThemes: false, removeLogs: false, removeAssets: false, ...extra })

describe('Start fresh (Phase 90)', () => {
  it('refuses a wrong word or a bad PO start, and stages nothing', async () => {
    const { t, svc, restarts } = setup()
    await expect(svc.start({ options: opts(1), confirm: 'RESET' })).rejects.toThrow(/START FRESH/)
    await expect(svc.start({ options: opts(2), confirm: 'START FRESH' })).rejects.toThrow(/FACTORY RESET/)
    await expect(svc.start({ options: opts(1, { poStart: 0 }), confirm: 'START FRESH' })).rejects.toThrow(/bill number/i)
    expect(existsSync(join(t.dir, PENDING_MARKER))).toBe(false)
    expect(existsSync(t.backupsDir) ? readdirSync(t.backupsDir) : []).toEqual([])
    expect(restarts.n).toBe(0)
  })

  it('Level 1: pre-wipe backup first, then bills and customers go, settings stay, PO restarts, nothing is queued for sync', async () => {
    const { t, svc, restarts } = setup()
    t.handle.sqlite.prepare("INSERT INTO sync_outbox (bill_id, op, revision, created_at, state) VALUES ('x','upsert',1,'now','pending')").run()
    const r = await svc.start({ options: opts(1), confirm: ' start fresh ' })
    expect(restarts.n).toBe(1)
    expect(r.backup).toMatch(/^pre-wipe-/)
    expect(probeDatabase(join(t.backupsDir, r.backup))).toMatchObject({ ok: true, billCount: 3 }) // the safety copy holds the bills
    expect(count(t, 'bills')).toBe(3) // nothing deleted yet: the wipe happens at the next launch
    expect(applyPendingRestore(t.dir, t.file).applied).toBe('wipe')
    expect(existsSync(join(t.dir, WIPE_MARKER))).toBe(true) // stays until the data step has run
    const w = applyPendingWipeData(t.handle.sqlite, t.dir)
    expect(w.error).toBeNull()
    expect(w.applied).toMatchObject({ level: 1, poStart: 500 })
    for (const tbl of ['bills', 'bill_rows', 'bill_revisions', 'parties', 'drafts', 'sync_outbox']) expect(count(t, tbl)).toBe(0)
    expect(count(t, 'settings')).toBe(1)
    expect(count(t, 'branches')).toBeGreaterThan(0)
    expect((t.handle.sqlite.prepare('SELECT MIN(next_seq) AS m FROM po_counters').get() as { m: number }).m).toBe(500)
    expect(existsSync(join(t.dir, WIPE_MARKER))).toBe(false)
    expect(existsSync(join(t.dir, PENDING_MARKER))).toBe(false)
    expect(applyPendingWipeData(t.handle.sqlite, t.dir)).toEqual({ applied: null, error: null }) // never repeats
  })

  it('Level 2: fresh database (settings gone), chosen folders emptied, pre-wipe backup kept, PO restart applied', async () => {
    const { t, svc } = setup()
    for (const d of ['themes', 'logs', 'assets']) { mkdirSync(join(t.dir, d), { recursive: true }); writeFileSync(join(t.dir, d, 'f.txt'), 'x') }
    mkdirSync(t.backupsDir, { recursive: true }); writeFileSync(join(t.backupsDir, 'manual-20260101-000000.db'), 'old')
    const r = await svc.start({ options: opts(2, { removeBackups: true, removeThemes: true, removeLogs: false, removeAssets: true }), confirm: 'FACTORY RESET' })
    t.handle.close()
    expect(applyPendingRestore(t.dir, t.file).applied).toBe('wipe')
    expect(existsSync(t.file)).toBe(false)
    expect(readdirSync(t.backupsDir).filter((f) => f.endsWith('.db'))).toEqual([r.backup]) // only the safety copy survives
    expect(existsSync(join(t.dir, 'themes', 'f.txt'))).toBe(false)
    expect(existsSync(join(t.dir, 'assets', 'f.txt'))).toBe(false)
    expect(existsSync(join(t.dir, 'logs', 'f.txt'))).toBe(true)
    const h = t.reopen()
    expect(applyPendingWipeData(h.sqlite, t.dir).applied).toMatchObject({ level: 2, poStart: 500 })
    expect((h.sqlite.prepare("SELECT COUNT(*) AS c FROM settings WHERE key = 'company.name'").get() as { c: number }).c).toBe(0)
    expect((h.sqlite.prepare('SELECT MIN(next_seq) AS m FROM po_counters').get() as { m: number }).m).toBe(500)
  })

  it('Level 2 without folder switches keeps backups, themes, logs and assets', async () => {
    const { t, svc } = setup()
    mkdirSync(t.backupsDir, { recursive: true }); writeFileSync(join(t.backupsDir, 'manual-20260101-000000.db'), 'old')
    await svc.start({ options: opts(2), confirm: 'FACTORY RESET' })
    t.handle.close()
    applyPendingRestore(t.dir, t.file)
    expect(readdirSync(t.backupsDir).filter((f) => f.endsWith('.db')).length).toBe(2)
  })

  it('IPC: strict schema, and the publisher actions use only the fixed address', async () => {
    const { svc } = setup()
    const h = wipeHandlers(svc)['wipe:start']!
    expect((await h({ options: opts(1), confirm: 'x', extra: 1 }) as { ok: boolean }).ok).toBe(false)
    expect((await h({ options: opts(1, { poStart: 1.5 }), confirm: 'START FRESH' }) as { ok: boolean }).ok).toBe(false)
    const seen: string[] = []
    const p = publisherHandlers({ writeText: (t) => seen.push(t), openExternal: async (u) => { seen.push(u) } })
    expect(await p['publisher:copyEmail']!({})).toMatchObject({ ok: true })
    expect(await p['publisher:openMail']!({})).toMatchObject({ ok: true })
    expect(await p['publisher:copyEmail']!({ text: 'evil@x.com' })).toMatchObject({ ok: false })
    expect(seen).toEqual(['phantomdx9@gmail.com', 'mailto:phantomdx9@gmail.com?subject=Quot3%20feedback'])
    const bad = publisherHandlers({ writeText() {}, openExternal: async () => { throw new Error('no handler') } })
    expect(await bad['publisher:openMail']!({})).toMatchObject({ ok: false })
  })
})
