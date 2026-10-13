import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createLegacyImportRepo } from '../../db/legacyImportRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { getLocalBranch } from '../../db/seed'
import { createBillService, type SavedInfo } from '../billService'
import { createLegacyImportService, type LegacySource } from '../legacyImportService'
import { createTrashRepo } from '../../db/trashRepo'
import { createTrashService } from '../trashService'
import type { AuditInput } from '../../../shared/audit'
import { MAX_FILES } from '../../../shared/legacyImport'
import { readCorpus } from '../../../shared/legacyImport/__tests__/corpus'
import { row } from '../../../shared/__fixtures__/bills'

// All tests use temp databases and temp folders: never the owner's data folder.
const dbs: TestDb[] = []
const dirs: string[] = []
afterEach(() => {
  dbs.splice(0).forEach((t) => t.cleanup())
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }))
})

const legacy = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  bill_no: 356, date: '08-10-2026', party: 'ROOPESH TAILOR', phone: '99450', transport: 'VRL', gst: '', format_mode: 'manual', extra_headers: [],
  items: [{ name: 'Shirt', qty: '2', rate: '100', amt: '200' }], total: 200, ...o
})
function folderOf(files: Record<string, Record<string, unknown> | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'quot3-legacy-'))
  dirs.push(dir)
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body))
  return dir
}

function mk(over: { writable?: boolean; failAuditOn?: number; logs?: boolean } = {}) {
  const t = openTestDb()
  dbs.push(t)
  const sqlite = t.handle.sqlite
  const calls: string[] = []
  const audit: AuditInput[] = []
  const outbox: SavedInfo[] = []
  const billRepo = createBillRepo(sqlite)
  const partyRepo = createPartyRepo(sqlite)
  const logsDir = join(t.dir, 'logs')
  let clock = Date.UTC(2026, 9, 10, 9, 0, 0)
  let n = 0
  let importAudits = 0
  const svc = createLegacyImportService(
    {
      sqlite, repo: createLegacyImportRepo(sqlite), bills: billRepo,
      backup: {
        create: async (kind) => {
          calls.push(`backup:${kind}:bills=${(sqlite.prepare('SELECT count(*) AS c FROM bills').get() as { c: number }).c}`)
          return { file: 'pre-import-test.db', kind, createdAt: new Date(clock).toISOString(), sizeBytes: 1, billCount: 0, readable: true }
        }
      },
      ...(over.logs === false ? {} : { logsDir })
    },
    {
      ...(over.writable === false ? { writable: false } : {}),
      now: () => new Date(clock), newId: () => `batch-${++n}`,
      audit: (a) => {
        if (over.failAuditOn !== undefined && a.entity === 'bill' && a.action === 'import' && ++importAudits === over.failAuditOn) throw new Error('boom')
        audit.push(a)
      },
      outbox: (i) => outbox.push(i)
    }
  )
  const bills = createBillService({ sqlite, bills: billRepo, parties: partyRepo }, { now: () => new Date(clock), newId: () => `gen-${++n}` })
  const trash = createTrashService({ repo: createTrashRepo(sqlite), branchId: () => getLocalBranch(sqlite).id }, { now: () => new Date(clock) })
  const count = (table: string, where = '1=1'): number => (sqlite.prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`).get() as { c: number }).c
  const nextSeq = (): number => (sqlite.prepare('SELECT next_seq AS n FROM po_counters').get() as { n: number }).n
  const advance = (ms: number): void => { clock += ms }
  return { t, sqlite, svc, bills, trash, calls, audit, outbox, count, nextSeq, advance, logsDir }
}
const folder = (dir: string): LegacySource => ({ kind: 'folder', path: dir })

describe('legacyImportService - schema', () => {
  it('migration 0004 adds the three bill columns, the batches table and the partial unique fingerprint index', () => {
    const { sqlite } = mk()
    const cols = (sqlite.prepare("SELECT name FROM pragma_table_info('bills')").all() as { name: string }[]).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['legacy_ref', 'import_batch_id', 'import_fingerprint']))
    expect(sqlite.prepare("SELECT count(*) AS c FROM sqlite_master WHERE name = 'import_batches'").get()).toEqual({ c: 1 })
    // NULL fingerprints may repeat (every non-imported bill); a real one may not.
    const q = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'bills_import_fingerprint_uq'").get() as { sql: string }
    expect(q.sql).toMatch(/UNIQUE/i)
    expect(q.sql).toMatch(/WHERE/i)
  })
})

describe('legacyImportService - reading a source', () => {
  it('reads only .json files, strips a BOM, never reads an oversize file, and turns a bad file into an error row', async () => {
    const dir = folderOf({
      'Bill_1_A.json': '\ufeff' + JSON.stringify(legacy({ bill_no: 1, party: 'A' })),
      'notes.txt': 'ignore me',
      'broken.json': '{ not json',
      'Bill_2_B.JSON': legacy({ bill_no: 2, party: 'B' })
    })
    writeFileSync(join(dir, 'huge.json'), Buffer.alloc(2 * 1024 * 1024 + 10, 0x20))
    const { svc, count } = mk()
    const progress: number[] = []
    const p = await svc.preview(folder(dir), undefined, { onProgress: (x) => progress.push(x.done) })
    expect(p.report.filesFound).toBe(4)
    expect(p.report.created).toBe(2)
    expect(p.report.errors.map((e) => e.file).sort()).toEqual(['broken.json', 'huge.json'])
    expect(progress.at(-1)).toBe(4)
    expect(p.sourceLabel).toBe(dir.split(/[\\/]/).pop())
    expect(count('bills')).toBe(0) // a preview writes nothing
  })

  it('refuses more than 20 000 files with a clear message, before reading any', async () => {
    const { svc } = mk()
    const paths = Array.from({ length: MAX_FILES + 1 }, (_, i) => join(tmpdir(), `nope-${i}.json`))
    await expect(svc.preview({ kind: 'files', paths })).rejects.toThrow(/limit is 20000/)
  })

  it('a folder that cannot be opened is an IO error, not a crash', async () => {
    const { svc } = mk()
    await expect(svc.preview(folder(join(tmpdir(), 'definitely-not-here-quot3')))).rejects.toThrow(/could not be opened/)
  })

  it('picks individual .json files', async () => {
    const dir = folderOf({ 'a.json': legacy({ bill_no: 5, party: 'A' }), 'b.json': legacy({ bill_no: 6, party: 'B' }) })
    const { svc } = mk()
    const p = await svc.preview({ kind: 'files', paths: [join(dir, 'a.json'), join(dir, 'a.json'), join(dir, 'x.txt')] })
    expect(p.report.filesFound).toBe(1)
    expect(p.sourceLabel).toBe('1 file')
  })
})

describe('legacyImportService - commit', () => {
  const files = {
    'one.json': legacy({ bill_no: 10, party: 'ROOPESH TAILOR', phone: '99450', items: [{ name: 'Shirt', qty: '2', rate: '100', amt: '200' }, { kind: 'adjustment', label: 'GST', value: 20, extras: [] }], total: 200 }),
    'two.json': legacy({ bill_no: 'BR1_11', party: 'Ruby Traders', date: '09-10-2026', format_mode: 'gst', items: [{ name: 'Pen', qty: '10', rate: '9', amt: '90', gst: '18' }], total: 90 }),
    'three.json': legacy({ bill_no: 12, party: 'roopesh  tailor', date: '10-10-2026' })
  }

  it('backs up FIRST (before any write), then imports every bill with its PO, tags, revision 1, parties, counter, audit and a report file', async () => {
    const { svc, calls, count, sqlite, nextSeq, audit, logsDir } = mk()
    const dir = folderOf(files)
    const r = await svc.commit(folder(dir))
    expect(calls).toEqual(['backup:pre-import:bills=0'])
    expect(r.batchId).toBe('batch-1')
    expect(r.backupFile).toBe('pre-import-test.db')
    expect(r.report.created).toBe(3)
    expect(r.report.nextPoAfter).toBe('Q3-0013')
    expect(nextSeq()).toBe(13)

    const rows = sqlite.prepare('SELECT po_number AS po, po_seq AS seq, legacy_ref AS ref, import_batch_id AS batch, import_fingerprint AS fp, revision, sync_state AS ss, round_off AS ro FROM bills ORDER BY po_seq').all() as Array<Record<string, unknown>>
    expect(rows.map((x) => [x.po, x.ref, x.batch, x.revision, x.ss, x.ro])).toEqual([
      ['Q3-0010', '10', 'batch-1', 1, 'local_only', 0],
      ['Q3-0011', 'BR1_11', 'batch-1', 1, 'local_only', 0],
      ['Q3-0012', '12', 'batch-1', 1, 'local_only', 0]
    ])
    expect(rows.every((x) => typeof x.fp === 'string' && (x.fp as string).length === 64)).toBe(true)
    expect(count('bill_revisions')).toBe(3)
    expect(count('bill_rows', "bill_id IN (SELECT id FROM bills)")).toBeGreaterThanOrEqual(4)

    // 'ROOPESH TAILOR' and 'roopesh  tailor' are the SAME party (exact normalised name); Ruby is the second.
    expect(count('parties')).toBe(2)
    expect(count('parties', "source = 'import'")).toBe(2)
    expect(count('bills', 'party_id IS NOT NULL')).toBe(3)

    expect(audit.filter((a) => a.entity === 'bill' && a.action === 'import')).toHaveLength(3)
    expect(audit.filter((a) => a.entity === 'import_batch')).toHaveLength(1)

    expect(r.reportFile).toMatch(/^import-.*\.json$/)
    const saved = JSON.parse(readFileSync(join(logsDir, r.reportFile as string), 'utf8')) as { batchId: string; report: { created: number } }
    expect(saved.batchId).toBe('batch-1')
    expect(saved.report.created).toBe(3)
    expect(svc.listBatches()).toHaveLength(1)
    expect(svc.listBatches()[0]).toMatchObject({ id: 'batch-1', created: 3, newParties: 2, poFirst: 10, poLast: 12, reportFile: r.reportFile, undoneAt: null })
  })

  it('the next NEW bill continues from the import, and a PO counter is never lowered', async () => {
    const { svc, bills, nextSeq, sqlite } = mk()
    sqlite.prepare('UPDATE po_counters SET next_seq = 500').run()
    await svc.commit(folder(folderOf(files))) // highest legacy number is 12: the counter must stay 500
    expect(nextSeq()).toBe(500)
    const saved = bills.save({ bill: { id: 'new1', party: { name: 'Fresh', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '5')] } })
    expect(saved.poNumber).toBe('Q3-0500')
  })

  it('imports only after the bump: a fresh database continues at highest + 1', async () => {
    const { svc, bills } = mk()
    await svc.commit(folder(folderOf(files)))
    const saved = bills.save({ bill: { id: 'new1', party: { name: 'Fresh', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '5')] } })
    expect(saved.poNumber).toBe('Q3-0013')
  })

  it('an existing party is linked and never modified; a new one is created once', async () => {
    const { svc, bills, sqlite } = mk()
    bills.save({ bill: { id: 'mine', party: { name: 'Ruby Traders', phone: 'KEEP-ME', address: 'My Road', transport: 'MINE' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-01', rows: [row('Pen', '1', '5')] } })
    const before = sqlite.prepare("SELECT id, phone, address, transport, source, updated_at FROM parties WHERE name = 'Ruby Traders'").get()
    await svc.commit(folder(folderOf(files)))
    expect(sqlite.prepare("SELECT id, phone, address, transport, source, updated_at FROM parties WHERE name = 'Ruby Traders'").get()).toEqual(before)
    expect(sqlite.prepare("SELECT count(*) AS c FROM parties WHERE name_norm = 'ruby traders'").get()).toEqual({ c: 1 })
    expect(sqlite.prepare("SELECT count(*) AS c FROM bills WHERE legacy_ref = 'BR1_11' AND party_id = (SELECT id FROM parties WHERE name = 'Ruby Traders')").get()).toEqual({ c: 1 })
  })

  it('imported bills are ordinary bills: they open, edit (revision 2), and keep their legacy tags', async () => {
    const { svc, bills, sqlite } = mk()
    await svc.commit(folder(folderOf(files)))
    const id = (sqlite.prepare("SELECT id FROM bills WHERE legacy_ref = 'BR1_11'").get() as { id: string }).id
    const b = bills.getForEdit(id)
    expect(b.poNumber).toBe('Q3-0011')
    expect(b.formatId).toBe('gst')
    const saved = bills.save({
      bill: { id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate, rows: b.rows.map((r) => (r.idx === 0 ? { ...r, qty: '20' } : r)) },
      expectedRevision: 1
    })
    expect(saved.revision).toBe(2)
    expect(saved.poNumber).toBe('Q3-0011')
    const tags = sqlite.prepare('SELECT legacy_ref AS ref, import_batch_id AS batch, length(import_fingerprint) AS fp FROM bills WHERE id = ?').get(id)
    expect(tags).toEqual({ ref: 'BR1_11', batch: 'batch-1', fp: 64 })
  })

  it('re-importing the same folder is a no-op: no backup, no batch row, nothing written', async () => {
    const { svc, calls, count } = mk()
    const dir = folderOf(files)
    await svc.commit(folder(dir))
    const before = { bills: count('bills'), parties: count('parties'), audit: count('audit_log') }
    const again = await svc.commit(folder(dir))
    expect(again.batchId).toBeNull()
    expect(again.report.created).toBe(0)
    expect(again.report.skipped.length).toBe(3)
    expect(calls).toHaveLength(1) // only the first import took a backup
    expect({ bills: count('bills'), parties: count('parties'), audit: count('audit_log') }).toEqual(before)
    expect(count('import_batches')).toBe(1)
  })

  it('a bill deleted to Recently deleted still counts as "already here" and is not imported again', async () => {
    const { svc, trash, bills, count, sqlite } = mk()
    const dir = folderOf(files)
    await svc.commit(folder(dir))
    const id = (sqlite.prepare("SELECT id FROM bills WHERE legacy_ref = '10'").get() as { id: string }).id
    bills.delete([id])
    expect(trash.list()).toHaveLength(1)
    const again = await svc.commit(folder(dir))
    expect(again.batchId).toBeNull()
    expect(count('bills')).toBe(3)
  })

  it('is all-or-nothing: a failure on the 3rd bill rolls back bills, parties, batch row and counter, and says so', async () => {
    const { svc, count, nextSeq, calls } = mk({ failAuditOn: 3 })
    await expect(svc.commit(folder(folderOf(files)))).rejects.toThrow(/rolled back; nothing was changed/)
    expect(calls).toHaveLength(1) // the backup was taken first, as always
    expect(count('bills')).toBe(0)
    expect(count('bill_rows')).toBe(0)
    expect(count('bill_revisions')).toBe(0)
    expect(count('parties')).toBe(0)
    expect(count('import_batches')).toBe(0)
    expect(nextSeq()).toBe(1)
  })

  it('cancel is honoured before the transaction: nothing is written and no backup is taken', async () => {
    const { svc, calls, count } = mk()
    const ctl = new AbortController()
    ctl.abort()
    await expect(svc.commit(folder(folderOf(files)), undefined, { signal: ctl.signal })).rejects.toThrow(/cancelled/)
    expect(calls).toHaveLength(0)
    expect(count('bills')).toBe(0)
  })

  it('refuses on a read-only database and writes no report when there is no logs folder', async () => {
    const ro = mk({ writable: false })
    await expect(ro.svc.commit(folder(folderOf(files)))).rejects.toThrow(/read-only/)
    const noLogs = mk({ logs: false })
    const r = await noLogs.svc.commit(folder(folderOf(files)))
    expect(r.reportFile).toBeNull()
    expect(r.report.created).toBe(3)
  })

  it('clash choices from the preview are honoured', async () => {
    const dir = folderOf({
      'a.json': legacy({ bill_no: 7, party: 'ALPHA', date: '01-10-2026' }),
      'b.json': legacy({ bill_no: 7, party: 'BETA', date: '02-10-2026' })
    })
    const { svc, count } = mk()
    const p = await svc.preview(folder(dir))
    expect(p.report.clashGroups).toHaveLength(1)
    const r = await svc.commit(folder(dir), { 'b.json': 'skip' })
    expect(r.report.created).toBe(1)
    expect(count('bills')).toBe(1)
  })

  it('a file whose bill the normal save rules would refuse (no usable row) becomes an error row; the rest still import', async () => {
    const dir = folderOf({ 'ok.json': legacy({ bill_no: 1, party: 'OK' }), 'empty.json': legacy({ bill_no: 2, party: 'EMPTY', items: [{ name: '', qty: '', rate: '', amt: '' }] }) })
    const { svc, count } = mk()
    const r = await svc.commit(folder(dir))
    expect(r.report.created).toBe(1)
    expect(r.report.errors.map((e) => e.file)).toContain('empty.json')
    expect(count('bills')).toBe(1)
    expect(count('parties', "name = 'EMPTY'")).toBe(0)
  })
})

describe('legacyImportService - undo', () => {
  const files = {
    'a.json': legacy({ bill_no: 1, party: 'ALPHA' }),
    'b.json': legacy({ bill_no: 2, party: 'ALPHA', date: '09-10-2026' }),
    'c.json': legacy({ bill_no: 3, party: 'GAMMA', date: '10-10-2026' })
  }

  it('moves exactly the batch to Recently deleted, removes the parties it made, never lowers the counter, and cannot run twice', async () => {
    const { svc, bills, trash, count, nextSeq, outbox, audit, advance } = mk()
    bills.save({ bill: { id: 'mine', party: { name: 'Mine Co', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-01', rows: [row('Pen', '1', '5')] } })
    await svc.commit(folder(folderOf(files)))
    expect(count('bills')).toBe(4)
    const counter = nextSeq()
    advance(60_000)
    const u = svc.undo(svc.listBatches()[0]!.id)
    expect(u).toEqual({ deleted: 3, keptEdited: [], alreadyDeleted: 0, partiesRemoved: 2 })
    expect(count('bills', 'deleted_at IS NULL')).toBe(1) // only the owner's own bill is still live
    expect(count('bills', "id = 'mine' AND deleted_at IS NULL")).toBe(1)
    expect(trash.list()).toHaveLength(3)
    expect(count('parties', 'deleted_at IS NULL')).toBe(1) // 'Mine Co' only
    expect(nextSeq()).toBe(counter)
    expect(outbox).toHaveLength(3)
    expect(outbox.every((o) => o.op === 'delete' && o.created === false)).toBe(true)
    expect(audit.some((a) => a.entity === 'import_batch' && a.action === 'undo')).toBe(true)
    expect(svc.listBatches()[0]?.undoneAt).not.toBeNull()
    expect(() => svc.undo(svc.listBatches()[0]!.id)).toThrow(/already been undone/)
    expect(() => svc.undo('nope')).toThrow(/not found/)
  })

  it('keeps a bill that was edited since the import (and its party), and lists it', async () => {
    const { svc, bills, sqlite, count } = mk()
    await svc.commit(folder(folderOf(files)))
    const id = (sqlite.prepare("SELECT id FROM bills WHERE legacy_ref = '3'").get() as { id: string }).id
    const b = bills.getForEdit(id)
    bills.save({ bill: { id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate, rows: b.rows.map((r) => (r.idx === 0 ? { ...r, qty: '9' } : r)) } })
    const u = svc.undo(svc.listBatches()[0]!.id)
    expect(u.deleted).toBe(2)
    expect(u.keptEdited).toEqual([{ id, poNumber: 'Q3-0003' }])
    expect(count('bills', 'deleted_at IS NULL')).toBe(1)
    expect(count('parties', "name = 'GAMMA' AND deleted_at IS NULL")).toBe(1) // still has a live bill
    expect(count('parties', "name = 'ALPHA' AND deleted_at IS NULL")).toBe(0)
  })

  it('a party the owner started using after the import is not removed', async () => {
    const { svc, bills, count } = mk()
    await svc.commit(folder(folderOf(files)))
    bills.save({ bill: { id: 'later', party: { name: 'alpha', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-10', rows: [row('Pen', '1', '5')] } })
    const u = svc.undo(svc.listBatches()[0]!.id)
    expect(u.partiesRemoved).toBe(1) // GAMMA only
    expect(count('parties', "name = 'ALPHA' AND deleted_at IS NULL")).toBe(1)
  })

  it('after undo, importing again does not duplicate (the bills sit in Recently deleted); once they are purged it imports and revives the party without a key clash', async () => {
    const { svc, trash, count, sqlite } = mk()
    const dir = folderOf(files)
    await svc.commit(folder(dir))
    svc.undo(svc.listBatches()[0]!.id)
    expect((await svc.commit(folder(dir))).batchId).toBeNull()
    const ids = trash.list().map((t) => t.id)
    trash.purge(ids)
    expect(count('bills')).toBe(0)
    const r = await svc.commit(folder(dir))
    expect(r.report.created).toBe(3)
    expect(count('bills', 'deleted_at IS NULL')).toBe(3)
    expect(count('parties', 'deleted_at IS NULL')).toBe(2) // ALPHA and GAMMA are back
    expect(sqlite.prepare("SELECT count(*) AS c FROM parties WHERE name = 'ALPHA'").get()).toEqual({ c: 1 })
  })
})

describe('legacyImportService - the owner corpus (private data; only counts are asserted)', () => {
  const corpus = readCorpus()
  const run = corpus ? it : it.skip

  run('imports the whole folder in one transaction: spec acceptance numbers, idempotent, undo removes exactly the batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quot3-corpus-'))
    dirs.push(dir)
    mkdirSync(dir, { recursive: true })
    for (const f of corpus ?? []) writeFileSync(join(dir, f.name), f.text)
    expect(readdirSync(dir).length).toBe(768)

    const { svc, bills, calls, count, sqlite, nextSeq } = mk()
    // an unrelated bill that must survive everything
    bills.save({ bill: { id: 'mine', party: { name: 'Not In The Corpus', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-01', rows: [row('Pen', '1', '5')] } })

    const p = await svc.preview(folder(dir))
    expect(p.report.filesRead).toBe(768)
    expect(p.report.errors).toHaveLength(0)
    expect(count('bills')).toBe(1) // preview wrote nothing

    const r = await svc.commit(folder(dir))
    expect(calls).toHaveLength(1)
    expect(r.report.created).toBe(760)
    expect(count('bills', 'import_batch_id IS NOT NULL')).toBe(760)
    // no two imported bills share a PO number (the unique (branch, po_seq) index would have rolled the import back)
    expect(count('bills', 'import_batch_id IS NOT NULL AND revision = 1 AND deleted_at IS NULL')).toBe(760)
    expect(sqlite.prepare('SELECT count(DISTINCT po_seq) AS c FROM bills WHERE import_batch_id IS NOT NULL').get()).toEqual({ c: 760 })
    expect(nextSeq()).toBe(r.report.nextSeqAfter)
    expect(r.report.nextPoAfter).toBe(`Q3-${String(r.report.nextSeqAfter).padStart(4, '0')}`)
    expect(count('parties', "source = 'import'")).toBe(r.report.newParties)
    expect(r.report.totalDifferences.length).toBeGreaterThan(300)

    // idempotent: the second run changes nothing
    const again = await svc.commit(folder(dir))
    expect(again.batchId).toBeNull()
    expect(again.report.created).toBe(0)
    expect(count('bills')).toBe(761)

    // undo removes exactly the batch
    const u = svc.undo(r.batchId as string)
    expect(u.deleted).toBe(760)
    expect(u.keptEdited).toHaveLength(0)
    expect(u.partiesRemoved).toBe(r.report.newParties)
    expect(count('bills', 'deleted_at IS NULL')).toBe(1)
    expect(count('parties', 'deleted_at IS NULL')).toBe(1)
  }, 60_000)
})
