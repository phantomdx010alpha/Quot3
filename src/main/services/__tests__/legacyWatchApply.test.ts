import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createLegacyImportRepo } from '../../db/legacyImportRepo'
import { createLegacyWatchRepo } from '../../db/legacyWatchRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SavedInfo } from '../billService'
import { createLegacyImportService } from '../legacyImportService'
import { createLegacyWatchApply, type WatchFile } from '../legacyWatchApply'
import type { AuditInput } from '../../../shared/audit'

// SYNTHETIC data only; temp databases and temp folders, never the owner's data.
const dbs: TestDb[] = []
const dirs: string[] = []
afterEach(() => {
  dbs.splice(0).forEach((t) => t.cleanup())
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

const item = (name: string, qty: string, rate: string): Record<string, unknown> => ({ name, qty, rate, amt: String(Number(qty) * Number(rate)) })
const T1 = Date.UTC(2026, 9, 1, 8, 0, 0)
const legacy = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  bill_no: 'BR1_100', date: '08-10-2026', party: 'ACME TRADERS', phone: '99450', transport: 'VRL', gst: '', format_mode: 'manual', extra_headers: [],
  items: [item('Tomato', '10', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')], total: 380, ...o
})
const file = (name: string, body: Record<string, unknown> | string, mtimeMs = T1): WatchFile => {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { name, text, size: text.length, mtimeMs }
}
const withItems = (items: Array<Record<string, unknown>>, o: Record<string, unknown> = {}): Record<string, unknown> => legacy({ items, ...o })

function mk(over: { writable?: boolean } = {}) {
  const t = openTestDb()
  dbs.push(t)
  const sqlite = t.handle.sqlite
  const backups: string[] = []
  const audit: AuditInput[] = []
  const hook: SavedInfo[] = []
  const billRepo = createBillRepo(sqlite)
  const outboxRepo = createOutboxRepo(sqlite)
  let clock = Date.UTC(2026, 9, 10, 9, 0, 0)
  let n = 0
  const importRepo = createLegacyImportRepo(sqlite)
  const watchRepo = createLegacyWatchRepo(sqlite)
  const apply = createLegacyWatchApply(
    {
      sqlite, repo: watchRepo, importRepo, bills: billRepo,
      backup: { create: async (kind) => { backups.push(kind); return { file: `pre-import-${backups.length}.db`, kind, createdAt: new Date(clock).toISOString(), sizeBytes: 1, billCount: 0, readable: true } } }
    },
    {
      ...(over.writable === false ? { writable: false } : {}), now: () => new Date(clock), newId: () => `id-${++n}`, audit: (a) => audit.push(a),
      outbox: (i) => { hook.push(i); outboxRepo.enqueue({ billId: i.billId, op: i.op ?? 'upsert', revision: i.revision, at: new Date(clock).toISOString(), keepSyncedBefore: '' }) }
    }
  )
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now: () => new Date(clock), newId: () => `gen-${++n}` })
  const count = (table: string, where = '1=1'): number => (sqlite.prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`).get() as { c: number }).c
  const advance = (ms: number): void => { clock += ms }
  const billRow = (id: string): { revision: number; deleted_at: string | null; po_number: string } => sqlite.prepare('SELECT revision, deleted_at, po_number FROM bills WHERE id = ?').get(id) as { revision: number; deleted_at: string | null; po_number: string }
  const names = (id: string): string[] => (sqlite.prepare('SELECT name_plain AS n FROM bill_rows WHERE bill_id = ? ORDER BY idx').all(id) as Array<{ n: string }>).map((r) => r.n)
  return { t, sqlite, apply, bills, watchRepo, backups, audit, hook, count, advance, billRow, names, importRepo, billRepo }
}

describe('legacyWatchApply - new bill', () => {
  it('imports a new bill through the normal write path: revision 1, tags, outbox row, audit, state, activity, ONE backup, batch row', async () => {
    const m = mk()
    const r = await m.apply.applyBatch([file('a.json', legacy())])
    expect(r.counts.imported).toBe(1)
    const id = r.outcomes[0]!.billId!
    expect(m.billRow(id)).toMatchObject({ revision: 1, deleted_at: null })
    expect(m.names(id)).toEqual(['Tomato', 'Onion', 'Potato'])
    expect(m.sqlite.prepare('SELECT legacy_ref AS r, import_batch_id AS b, import_fingerprint AS f FROM bills WHERE id = ?').get(id)).toMatchObject({ r: 'BR1_100' })
    expect(m.count('sync_outbox', `bill_id = '${id}' AND op = 'upsert' AND state = 'pending'`)).toBe(1)
    expect(m.count('bill_revisions', `bill_id = '${id}'`)).toBe(1)
    expect(m.audit.some((a) => a.entity === 'bill' && a.action === 'import')).toBe(true)
    expect(m.backups).toEqual(['pre-import'])
    expect(m.watchRepo.getFile('a.json')).toMatchObject({ lastResult: 'imported', billId: id })
    expect(m.watchRepo.getWatchBill(id)).toMatchObject({ appliedRevision: 1, sourceMtimeMs: T1 })
    expect(m.watchRepo.listActivity()[0]).toMatchObject({ kind: 'imported', billId: id })
    expect(m.count('import_batches', "source_label = 'Legacy watch' AND created = 1")).toBe(1)
  })

  it('a batch of two new bills is applied oldest first with ONE backup, whatever the input order', async () => {
    const m = mk()
    const newer = file('new.json', legacy({ bill_no: 'BR1_101', party: 'ZED CO' }), T1 + 5000)
    const older = file('old.json', legacy({ bill_no: 'BR1_102', party: 'YAK CO' }), T1)
    const r = await m.apply.applyBatch([newer, older])
    expect(r.outcomes.map((o) => o.file)).toEqual(['old.json', 'new.json'])
    expect(m.backups).toHaveLength(1)
    expect(m.count('import_batches', 'created = 2')).toBe(1)
  })

  it('a file that is already known and unchanged is skipped without reading; a bad file is an error and is retried', async () => {
    const m = mk()
    const f = file('a.json', legacy())
    await m.apply.applyBatch([f])
    const again = await m.apply.applyBatch([f])
    expect(again.counts.unchanged).toBe(1)
    expect(m.backups).toHaveLength(1)
    const bad = file('bad.json', '{ not json')
    expect((await m.apply.applyBatch([bad])).counts.error).toBe(1)
    expect(m.watchRepo.getFile('bad.json')?.lastResult).toBe('error')
    expect((await m.apply.applyBatch([bad])).counts.error).toBe(1) // retried, not "unchanged"
  })

  it('a file the manual importer already imported is not imported again', async () => {
    const m = mk()
    const dir = mkdtempSync(join(tmpdir(), 'quot3-watch-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'a.json'), JSON.stringify(legacy()))
    const manual = createLegacyImportService(
      { sqlite: m.sqlite, repo: m.importRepo, bills: m.billRepo, backup: { create: async (kind) => ({ file: 'x.db', kind, createdAt: '', sizeBytes: 1, billCount: 0, readable: true }) } },
      { now: () => new Date(Date.UTC(2026, 9, 10, 9, 0, 0)), newId: () => 'manual-batch' }
    )
    await manual.commit({ kind: 'folder', path: dir })
    expect(m.count('bills')).toBe(1)
    const r = await m.apply.applyBatch([file('a.json', legacy()), file('copy.json', legacy({ bill_no: 'BR1_101' }), T1 + 1000)])
    expect(m.count('bills')).toBe(1)
    expect(r.counts.imported).toBe(0)
    expect(r.counts.duplicate + r.counts.already_imported).toBe(2)
  })
})

describe('legacyWatchApply - duplicates, edits, older copies', () => {
  it('the same bill saved again under another PO number is a duplicate: skipped and logged, no new bill, no backup', async () => {
    const m = mk()
    await m.apply.applyBatch([file('a.json', legacy())])
    const r = await m.apply.applyBatch([file('b.json', legacy({ bill_no: 'BR1_101' }), T1 + 1000)])
    expect(r.counts.duplicate).toBe(1)
    expect(m.count('bills')).toBe(1)
    expect(m.backups).toHaveLength(1)
    expect(m.watchRepo.listActivity()[0]).toMatchObject({ kind: 'duplicate', fileName: 'b.json' })
  })

  it('a newer edited copy updates the bill in place as a NEW revision: same PO, old version kept, outbox row, tracked revision moves', async () => {
    const m = mk()
    const first = await m.apply.applyBatch([file('a.json', legacy())])
    const id = first.outcomes[0]!.billId!
    const po = m.billRow(id).po_number
    m.advance(60_000)
    const edited = withItems([item('Tomato', '12', '20'), item('Onion', '5', '30'), item('Potato', '2', '15'), item('Garlic', '1', '100')], { bill_no: 'BR1_101' })
    const r = await m.apply.applyBatch([file('b.json', edited, T1 + 60_000)])
    expect(r.counts.updated).toBe(1)
    expect(m.count('bills')).toBe(1)
    expect(m.billRow(id)).toMatchObject({ revision: 2, po_number: po })
    expect(m.names(id)).toEqual(['Tomato', 'Onion', 'Potato', 'Garlic'])
    expect(m.count('bill_revisions', `bill_id = '${id}'`)).toBe(2)
    expect(m.hook.filter((h) => h.billId === id).map((h) => h.revision)).toEqual([1, 2])
    expect(m.watchRepo.getWatchBill(id)).toMatchObject({ appliedRevision: 2, sourceMtimeMs: T1 + 60_000 })
    expect(m.backups).toHaveLength(2)
  })

  it('an older edited copy is ignored and logged; the bill is untouched', async () => {
    const m = mk()
    const first = await m.apply.applyBatch([file('a.json', legacy())], )
    const id = first.outcomes[0]!.billId!
    const edited = withItems([item('Tomato', '99', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')])
    const r = await m.apply.applyBatch([file('old.json', edited, T1 - 5000)])
    expect(r.counts.older).toBe(1)
    expect(m.billRow(id).revision).toBe(1)
  })

  it('a bill edited inside Quot3 after import is never overwritten: the newer copy goes to Needs review', async () => {
    const m = mk()
    const first = await m.apply.applyBatch([file('a.json', legacy())])
    const id = first.outcomes[0]!.billId!
    const bill = m.bills.getForEdit(id)
    m.advance(1000)
    m.bills.save({ bill: { id, party: bill.party, formatId: bill.formatId, extraCols: bill.extraCols, paperOverride: null, billDate: bill.billDate, rows: bill.rows.slice(0, 2) }, expectedRevision: 1 })
    expect(m.billRow(id).revision).toBe(2)
    const edited = withItems([item('Tomato', '12', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')])
    const r = await m.apply.applyBatch([file('b.json', edited, T1 + 60_000)])
    expect(r.counts.review).toBe(1)
    expect(m.billRow(id).revision).toBe(2)
    expect(m.names(id)).toEqual(['Tomato', 'Onion'])
    const open = m.watchRepo.openReviews()
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ fileName: 'b.json', why: 'locally_edited', candidateIds: [id], party: 'ACME TRADERS', billDate: '2026-10-08' })
  })

  it('same party and day but a different bill goes to Needs review, and the review item is not duplicated on a re-run', async () => {
    const m = mk()
    await m.apply.applyBatch([file('a.json', legacy())])
    const other = withItems([item('Mango', '3', '80'), item('Banana', '4', '40')], { bill_no: 'BR1_105' })
    const f = file('c.json', other, T1 + 10)
    expect((await m.apply.applyBatch([f])).counts.review).toBe(1)
    m.watchRepo.upsertFile({ ...m.watchRepo.getFile('c.json')!, lastResult: 'error' }) // force the file to be looked at again
    await m.apply.applyBatch([f])
    expect(m.watchRepo.openReviews()).toHaveLength(1)
    expect(m.count('bills')).toBe(1)
  })

  it('a copy in Recently deleted is never revived or overwritten', async () => {
    const m = mk()
    const first = await m.apply.applyBatch([file('a.json', legacy())])
    const id = first.outcomes[0]!.billId!
    m.bills.delete([id])
    const edited = withItems([item('Tomato', '12', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')])
    expect((await m.apply.applyBatch([file('b.json', edited, T1 + 5000)])).counts.review).toBe(1)
    expect((await m.apply.applyBatch([file('c.json', legacy({ bill_no: 'BR1_103' }), T1 + 9000)])).counts.duplicate).toBe(1)
    expect(m.count('bills', 'deleted_at IS NULL')).toBe(0)
  })
})

describe('legacyWatchApply - undo and guards', () => {
  it('undo of an import moves the bill to Recently deleted (never a hard delete), queues a delete, and the file is ignored from then on', async () => {
    const m = mk()
    const f = file('a.json', legacy())
    const r = await m.apply.applyBatch([f])
    const id = r.outcomes[0]!.billId!
    m.advance(1000)
    const res = m.apply.undo(r.outcomes[0]!.activityId!)
    expect(res).toMatchObject({ kind: 'imported', billId: id })
    expect(m.billRow(id).deleted_at).not.toBeNull()
    expect(m.count('bills')).toBe(1)
    expect(m.hook.at(-1)).toMatchObject({ billId: id, op: 'delete' })
    expect(m.count('sync_outbox', `bill_id = '${id}' AND op = 'delete'`)).toBe(1)
    expect(m.watchRepo.getFile('a.json')?.lastResult).toBe('ignored')
    expect((await m.apply.applyBatch([f])).counts.unchanged).toBe(1)
    expect(() => m.apply.undo(r.outcomes[0]!.activityId!)).toThrow(/already been undone/)
  })

  it('undo of an update restores the earlier content as ANOTHER new revision and marks the file ignored', async () => {
    const m = mk()
    const first = await m.apply.applyBatch([file('a.json', legacy())])
    const id = first.outcomes[0]!.billId!
    const edited = withItems([item('Tomato', '12', '20'), item('Onion', '5', '30'), item('Potato', '2', '15'), item('Garlic', '1', '100')])
    const upd = await m.apply.applyBatch([file('b.json', edited, T1 + 60_000)])
    expect(m.names(id)).toHaveLength(4)
    m.advance(1000)
    m.apply.undo(upd.outcomes[0]!.activityId!)
    expect(m.names(id)).toEqual(['Tomato', 'Onion', 'Potato'])
    expect(m.billRow(id)).toMatchObject({ revision: 3, deleted_at: null })
    expect(m.count('bill_revisions', `bill_id = '${id}'`)).toBe(3)
    expect(m.hook.at(-1)).toMatchObject({ billId: id, revision: 3 })
    expect(m.watchRepo.getFile('b.json')?.lastResult).toBe('ignored')
    expect(m.watchRepo.getWatchBill(id)).toMatchObject({ appliedRevision: 3, sourceMtimeMs: T1 })
  })

  it('undo is refused when the bill was changed after the automatic action', async () => {
    const m = mk()
    const r = await m.apply.applyBatch([file('a.json', legacy())])
    const id = r.outcomes[0]!.billId!
    const bill = m.bills.getForEdit(id)
    m.bills.save({ bill: { id, party: bill.party, formatId: bill.formatId, extraCols: bill.extraCols, paperOverride: null, billDate: bill.billDate, rows: bill.rows }, expectedRevision: 1 })
    expect(() => m.apply.undo(r.outcomes[0]!.activityId!)).toThrow(/changed after this action/)
    expect(m.billRow(id).deleted_at).toBeNull()
    expect(() => m.apply.undo('nope')).toThrow(/not found/)
  })

  it('keeps only the last 200 activity events', async () => {
    const m = mk()
    await m.apply.applyBatch([file('a.json', legacy())])
    for (let i = 0; i < 205; i++) m.watchRepo.addActivity({ id: `x${i}`, at: new Date(Date.UTC(2026, 9, 11, 0, 0, i)).toISOString(), kind: 'duplicate', fileName: `d${i}.json`, billId: null, party: '', poNumber: '', detail: '', revision: null, prevRevision: null, prevSourceMtimeMs: null })
    const list = m.watchRepo.listActivity()
    expect(list).toHaveLength(200)
    expect(list[0]!.id).toBe('x204')
    expect(m.count('legacy_watch_activity')).toBe(200)
  })

  it('a read-only database refuses to apply or undo', async () => {
    const m = mk({ writable: false })
    await expect(m.apply.applyBatch([file('a.json', legacy())])).rejects.toThrow(/read-only/)
    expect(() => m.apply.undo('x')).toThrow(/read-only/)
  })
})
