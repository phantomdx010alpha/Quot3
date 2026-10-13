import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createBootstrapRepo } from '../../db/bootstrapRepo'
import { createBranchRepo } from '../../db/branchRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { getLocalBranch } from '../../db/seed'
import { bootstrapHandlers } from '../../ipc/bootstrap'
import { createBillService } from '../../services/billService'
import { createBootstrapService, type BootstrapService } from '../bootstrapService'
import { chooseBootstrapPrefix, suggestFreePrefix } from '../../../shared/sync/bootstrap'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))
let n = 0
const log = { info() {}, warn() {}, error() {} }

/** A computer with a few saved bills; its local branch gets `prefix`. */
function branchWithBills(prefix: string, count: number, name = 'Main shop'): { t: TestDb; ids: string[] } {
  const t = openTestDb(); open.push(t)
  const sqlite = t.handle.sqlite
  sqlite.prepare('UPDATE branches SET po_prefix = ?, name = ? WHERE is_local = 1').run(prefix, name)
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties: createPartyRepo(sqlite) }, { newId: () => `src-${++n}` })
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const id = `bs-${++n}`
    ids.push(id)
    bills.save({ bill: { id, party: { name: `Party ${i % 2}`, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-09', rows: [row('Pen', '2', '10'), row('Ink', '1', '5'), blankRow()] } })
  }
  // a second revision on the first bill (history travels too)
  bills.save({ bill: { id: ids[0]!, party: { name: 'Party 0', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-09', rows: [row('Pen', '3', '10'), blankRow()] } })
  return { t, ids }
}

interface Ctx { t: TestDb; svc: BootstrapService; sqlite: TestDb['handle']['sqlite']; safety: { n: number; fail: boolean }; activated: { on: boolean }; fileFrom: (src: TestDb, name?: string) => Promise<string> }
function mkNew(over: { prefix?: string } = {}): Ctx {
  const t = openTestDb(); open.push(t)
  const sqlite = t.handle.sqlite
  if (over.prefix) sqlite.prepare('UPDATE branches SET po_prefix = ? WHERE is_local = 1').run(over.prefix)
  mkdirSync(t.backupsDir, { recursive: true })
  const safety = { n: 0, fail: false }, activated = { on: false }
  const svc = createBootstrapService({
    repo: createBootstrapRepo(sqlite), branches: createBranchRepo(sqlite), backupsDir: t.backupsDir, schemaVersion: t.handle.schemaVersion,
    safetyBackup: async () => { if (safety.fail) throw new Error('disk full'); safety.n++; return 'manual-safety.db' }, isActivated: () => activated.on, log
  })
  const fileFrom = async (src: TestDb, name = 'imported-20261010-100000.db'): Promise<string> => { await src.handle.sqlite.backup(join(t.backupsDir, name)); return name }
  return { t, svc, sqlite, safety, activated, fileFrom }
}
const count = (c: Ctx, sql: string): number => (c.sqlite.prepare(sql).get() as { n: number }).n

describe('new-branch bootstrap import (Phase 58)', () => {
  it('pure helpers: free prefix suggestion and the prefix choice', () => {
    expect(suggestFreePrefix('Q3-', ['AA-'])).toBe('Q3-')
    expect(suggestFreePrefix('Q3-', ['q3-'])).toBe('Q3B-')
    expect(suggestFreePrefix('Q3-', ['Q3-', 'Q3B-'])).toBe('Q3C-')
    expect(chooseBootstrapPrefix('Q3-', undefined, ['Q3-'], [])).toMatchObject({ ok: false })
    expect(chooseBootstrapPrefix('Q3-', '', ['AA-'], [])).toEqual({ ok: true, prefix: 'Q3-' })
    expect(chooseBootstrapPrefix('Q3-', 'nb-', ['AA-'], [])).toEqual({ ok: true, prefix: 'NB-' })
    expect(chooseBootstrapPrefix('Q3-', 'AA-', ['AA-'], [])).toMatchObject({ ok: false })
  })

  it('preview is a dry run: right counts, the clash is flagged, nothing is written', async () => {
    const src = branchWithBills('Q3-', 3)
    const c = mkNew()
    const p = c.svc.preview(await c.fileFrom(src.t))
    expect(p).toMatchObject({ billsAdded: 3, branchesAdded: 1, partiesAdded: 2, skippedExisting: 0, skippedTrashed: 0, prefixClash: true, suggestedPrefix: 'Q3B-', activated: false })
    expect(p.rowsAdded).toBe(5) // blank rows are not stored: 1 (re-saved first bill) + 2 + 2
    expect(p.branches).toHaveLength(1)
    expect(p.branches[0]).toMatchObject({ name: 'Main shop', poPrefix: 'Q3-', bills: 3, newBills: 3 })
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills')).toBe(0)
    expect(count(c, 'SELECT COUNT(*) AS n FROM branches')).toBe(1)
    expect(c.safety.n).toBe(0)
  })

  it('apply: bills keep PO numbers / ids / rows / revisions, are marked synced, are never queued, and the sync state here is untouched', async () => {
    const src = branchWithBills('AA-', 3)
    const c = mkNew({ prefix: 'NB-' })
    c.sqlite.prepare("INSERT INTO sync_state (key, value) VALUES ('license.orgId', 'org-1'), ('sync.pullCursor', '77')").run()
    const file = await c.fileFrom(src.t)
    const before = src.t.handle.sqlite.prepare('SELECT id, po_number, po_seq, branch_id, revision FROM bills ORDER BY po_seq').all()
    const r = await c.svc.apply({ file })
    expect(r).toMatchObject({ billsAdded: 3, branchesAdded: 1, prefix: 'NB-', prefixChanged: false, safetyBackup: 'manual-safety.db' })
    expect(c.safety.n).toBe(1)
    expect(c.sqlite.prepare('SELECT id, po_number, po_seq, branch_id, revision FROM bills ORDER BY po_seq').all()).toEqual(before)
    expect(count(c, "SELECT COUNT(*) AS n FROM bills WHERE sync_state = 'synced'")).toBe(3)
    expect(count(c, 'SELECT COUNT(*) AS n FROM sync_outbox')).toBe(0)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bill_rows')).toBeGreaterThanOrEqual(3)
    expect(count(c, `SELECT COUNT(*) AS n FROM bill_revisions WHERE bill_id = '${src.ids[0]}'`)).toBe(2)
    expect(count(c, 'SELECT COUNT(*) AS n FROM parties')).toBe(2)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills WHERE party_id IS NOT NULL')).toBe(3)
    expect(count(c, "SELECT COUNT(*) AS n FROM sync_state WHERE key IN ('license.orgId', 'sync.pullCursor')")).toBe(2)
    expect(count(c, 'SELECT COUNT(*) AS n FROM branches WHERE is_local = 1')).toBe(1)
    expect(count(c, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bootstrap_import'")).toBe(1)
  })

  it('a clashing prefix is refused until a new one is given; the new prefix is used by the next local bill (sequence 1)', async () => {
    const src = branchWithBills('Q3-', 2)
    const c = mkNew()
    const file = await c.fileFrom(src.t)
    await expect(c.svc.apply({ file })).rejects.toThrow(/different prefix/)
    await expect(c.svc.apply({ file, prefix: 'Q3-' })).rejects.toThrow(/already uses/)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills')).toBe(0)
    expect(c.safety.n).toBe(0)
    const r = await c.svc.apply({ file, prefix: 'nb-' })
    expect(r).toMatchObject({ prefix: 'NB-', prefixChanged: true, billsAdded: 2 })
    const bills = createBillService({ sqlite: c.sqlite, bills: createBillRepo(c.sqlite), parties: createPartyRepo(c.sqlite) }, { newId: () => `own-${++n}` })
    const saved = bills.save({ bill: { id: `own-bill-${++n}`, party: { name: 'X', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '1'), blankRow()] } })
    expect(saved.poNumber).toBe('NB-0001')
    expect(c.sqlite.prepare("SELECT po_number FROM bills WHERE branch_id = ? ORDER BY po_seq").all(getLocalBranch(c.sqlite).id)).toEqual([{ po_number: 'NB-0001' }])
    expect(count(c, "SELECT COUNT(*) AS n FROM bills WHERE po_number LIKE 'Q3-%'")).toBe(2)
    expect(count(c, 'SELECT COUNT(*) AS n FROM sync_outbox')).toBe(0)
  })

  it('importing the same file again adds nothing (dedupe by bill id); trashed bills are not imported', async () => {
    const src = branchWithBills('AA-', 3)
    src.t.handle.sqlite.prepare("UPDATE bills SET deleted_at = '2026-10-09T00:00:00.000Z' WHERE id = ?").run(src.ids[2])
    const c = mkNew({ prefix: 'NB-' })
    const file = await c.fileFrom(src.t)
    expect(await c.svc.apply({ file })).toMatchObject({ billsAdded: 2, skippedTrashed: 1, skippedExisting: 0 })
    const again = await c.svc.apply({ file })
    expect(again).toMatchObject({ billsAdded: 0, branchesAdded: 0, partiesAdded: 0, skippedExisting: 2, skippedTrashed: 1 })
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills')).toBe(2)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bill_revisions WHERE bill_id = \'' + src.ids[0] + '\'')).toBe(2)
  })

  it('a bill that is already here is kept as it is here; the same branch + PO sequence under another id is skipped, not overwritten', async () => {
    const src = branchWithBills('AA-', 2)
    const c = mkNew({ prefix: 'NB-' })
    await c.svc.apply({ file: await c.fileFrom(src.t) })
    c.sqlite.prepare("UPDATE bills SET party_snapshot_json = '{\"name\":\"EDITED HERE\"}' WHERE id = ?").run(src.ids[0])
    // a different id with the same branch + po_seq in a second file
    const other = branchWithBills('ZZ-', 1)
    other.t.handle.sqlite.prepare('DELETE FROM bills').run()
    const srcBranch = (src.t.handle.sqlite.prepare('SELECT * FROM branches WHERE is_local = 1').get()) as { id: string; name: string; created_at: string }
    other.t.handle.sqlite.prepare('INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES (?, ?, ?, 0, ?)').run(srcBranch.id, srcBranch.name, 'AA-', srcBranch.created_at)
    const b1 = src.t.handle.sqlite.prepare('SELECT * FROM bills WHERE id = ?').get(src.ids[0]) as Record<string, unknown>
    other.t.handle.sqlite.prepare(
      `INSERT INTO bills (id, branch_id, po_seq, po_number, party_snapshot_json, format_id, bill_date, created_at, updated_at) VALUES ('dup-id', ?, ?, ?, '{}', 'non_gst', '2026-10-09', 'x', 'x')`
    ).run(b1['branch_id'], b1['po_seq'], b1['po_number'])
    const r = await c.svc.apply({ file: await c.fileFrom(other.t, 'imported-20261010-110000.db') })
    expect(r).toMatchObject({ billsAdded: 0, skippedClash: 1, branchesAdded: 1 })
    expect(c.sqlite.prepare('SELECT party_snapshot_json AS j FROM bills WHERE id = ?').get(src.ids[0])).toEqual({ j: '{"name":"EDITED HERE"}' })
    expect(count(c, "SELECT COUNT(*) AS n FROM bills WHERE id = 'dup-id'")).toBe(0)
  })

  it('all or nothing: a failure part-way (prefix owned by another branch here) leaves everything, including this prefix, as it was', async () => {
    const src = branchWithBills('ZZ-', 2)
    const c = mkNew({ prefix: 'NB-' })
    c.sqlite.prepare("INSERT INTO branches (id, name, po_prefix, is_local, created_at) VALUES ('someone', 'Other', 'ZZ-', 0, '2026-01-01T00:00:00.000Z')").run()
    const file = await c.fileFrom(src.t)
    await expect(c.svc.apply({ file, prefix: 'NEW-' })).rejects.toThrow(/nothing was changed/)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills')).toBe(0)
    expect(count(c, 'SELECT COUNT(*) AS n FROM parties')).toBe(0)
    expect(count(c, 'SELECT COUNT(*) AS n FROM branches')).toBe(2)
    expect(getLocalBranch(c.sqlite).poPrefix).toBe('NB-')
    expect(() => c.svc.preview(file)).toThrow(/cannot be merged/)
  })

  it('refuses unsafe names, missing files, non-Quot3 files, newer backups, a read-only database, and stops when the safety backup fails', async () => {
    const src = branchWithBills('AA-', 1)
    const c = mkNew({ prefix: 'NB-' })
    expect(() => c.svc.preview('../x.db')).toThrow(/not a backup file name/)
    expect(() => c.svc.preview('imported-nope.db')).toThrow(/no longer there/)
    const file = await c.fileFrom(src.t)
    const newer = createBootstrapService({ repo: createBootstrapRepo(c.sqlite), branches: createBranchRepo(c.sqlite), backupsDir: c.t.backupsDir, schemaVersion: 0, safetyBackup: async () => 'x', isActivated: () => false, log })
    expect(() => newer.preview(file)).toThrow(/newer version/)
    const ro = createBootstrapService({ repo: createBootstrapRepo(c.sqlite), branches: createBranchRepo(c.sqlite), backupsDir: c.t.backupsDir, schemaVersion: c.t.handle.schemaVersion, safetyBackup: async () => 'x', isActivated: () => false, log }, { writable: false })
    await expect(ro.apply({ file })).rejects.toThrow(/read-only/)
    c.safety.fail = true
    await expect(c.svc.apply({ file })).rejects.toThrow(/disk full/)
    expect(count(c, 'SELECT COUNT(*) AS n FROM bills')).toBe(0)
  })

  it('reports whether sync is activated, and the strict IPC schemas reject extra fields', async () => {
    const src = branchWithBills('AA-', 1)
    const c = mkNew({ prefix: 'NB-' })
    c.activated.on = true
    const file = await c.fileFrom(src.t)
    expect(c.svc.preview(file).activated).toBe(true)
    const h = bootstrapHandlers(c.svc)
    expect(await h['bootstrap:preview']!({ file, extra: 1 })).toMatchObject({ ok: false })
    expect(await h['bootstrap:apply']!({ file, prefix: 5 })).toMatchObject({ ok: false })
    expect(await h['bootstrap:preview']!({ file })).toMatchObject({ ok: true })
    expect(await h['bootstrap:apply']!({ file })).toMatchObject({ ok: true, data: { activated: true, billsAdded: 1 } })
  })
})
