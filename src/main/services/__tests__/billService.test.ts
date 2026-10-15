import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { billHandlers } from '../../ipc/bills'
import { deserializeBill } from '../../../shared/billModel'
import { blankRow, row } from '../../../shared/__fixtures__/bills'
import type { BillRow } from '../../../shared/types'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  return { t, ...wire(t, opts) }
}
function wire(t: TestDb, opts: { writable?: boolean } = {}) {
  const sqlite = t.handle.sqlite
  const bills = createBillRepo(sqlite)
  const parties = createPartyRepo(sqlite)
  let clock = 0
  const svc = createBillService(
    { sqlite, bills, parties },
    { ...opts, newId: () => `gen-${++n}`, now: () => new Date(Date.UTC(2026, 9, 8, 10, 0, clock++)) }
  )
  return { svc, sqlite, parties }
}

const input = (id: string, over: Partial<SaveBillInput['bill']> = {}, expectedRevision?: number): SaveBillInput => ({
  bill: {
    id, party: { name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' }, formatId: 'non_gst', extraCols: [],
    paperOverride: null, billDate: '2026-10-08',
    rows: [row('Pen', '10', '9'), row('Book', '2', '45.50'), blankRow(), blankRow(), blankRow()],
    ...over
  },
  ...(expectedRevision !== undefined ? { expectedRevision } : {})
})
const count = (db: TestDb['handle']['sqlite'], table: string): number => (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c

describe('billService.save — create', () => {
  it('first save creates bill + rows, PO Q3-0001, revision 1, trailing blank rows are not stored', () => {
    const { svc, sqlite } = mk()
    const r = svc.save(input('b1'))
    expect(r).toMatchObject({ id: 'b1', poNumber: 'Q3-0001', poSeq: 1, revision: 1 })
    const b = sqlite.prepare('SELECT * FROM bills WHERE id = ?').get('b1') as Record<string, unknown>
    expect(b).toMatchObject({ po_number: 'Q3-0001', po_seq: 1, revision: 1, format_id: 'non_gst', bill_date: '2026-10-08', sync_state: 'local_only', deleted_at: null, item_row_count: 2 })
    expect(JSON.parse(b['totals_json'] as string)).toMatchObject({ itemsSubtotal: '181.00', grandTotal: '181.00' })
    expect(JSON.parse(b['party_snapshot_json'] as string)).toEqual({ name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' })
    expect(count(sqlite, 'bill_rows')).toBe(2)
  })

  it('what was stored round-trips through deserializeBill (rows ordered, runs and extras intact)', () => {
    const { svc, sqlite } = mk()
    const styled: BillRow = { ...row('', '1', '100'), nameRuns: [{ t: 'Red ', r: 1, b: 1 }, { t: 'pen' }], extras: { c1: { text: '(125-5)', marked: true } } }
    svc.save(input('b1', { extraCols: [{ key: 'c1', header: 'ruby', kind: 'units' }], rows: [styled, row('Plain', '3', '4')] }))
    const rec = sqlite.prepare('SELECT id, branch_id AS branchId, po_seq AS poSeq, po_number AS poNumber, party_id AS partyId, party_snapshot_json AS partySnapshotJson, format_id AS formatId, extra_cols_json AS extraColsJson, paper_override AS paperOverride, bill_date AS billDate, totals_json AS totalsJson, item_row_count AS itemRowCount, revision, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, sync_state AS syncState FROM bills WHERE id = ?').get('b1')
    const rws = sqlite.prepare('SELECT id, bill_id AS billId, idx, name_runs_json AS nameRunsJson, name_plain AS namePlain, qty, rate, total_override AS totalOverride, gst_rate AS gstRate, extras_json AS extrasJson, cell_style_json AS cellStyleJson FROM bill_rows WHERE bill_id = ? ORDER BY idx').all('b1')
    const out = deserializeBill(rec, rws)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.data.rows[0]!.nameRuns).toEqual([{ t: 'Red ', r: 1, b: 1 }, { t: 'pen' }])
    expect(out.data.rows[0]!.extras).toEqual({ c1: { text: '(125-5)', marked: true } })
    expect(out.data.extraCols).toEqual([{ key: 'c1', header: 'ruby', kind: 'units' }])
    expect(out.data.rows.map((r) => r.idx)).toEqual([0, 1])
    expect(out.data.partyId).not.toBeNull()
  })

  it('second new bill gets Q3-0002; the counter moves on exactly once per new bill', () => {
    const { svc, sqlite } = mk()
    expect(svc.save(input('b1')).poNumber).toBe('Q3-0001')
    expect(svc.save(input('b2')).poNumber).toBe('Q3-0002')
    expect((sqlite.prepare('SELECT next_seq AS s FROM po_counters').get() as { s: number }).s).toBe(3)
  })

  it('the client cannot choose branch / PO / revision (client values are ignored)', () => {
    const { svc, sqlite } = mk()
    const sneaky = input('b1') as unknown as { bill: Record<string, unknown> }
    Object.assign(sneaky.bill, { poNumber: 'EVIL-9', poSeq: 99, revision: 40, branchId: 'other', createdAt: '1999-01-01T00:00:00Z' })
    expect(svc.save(sneaky as unknown as SaveBillInput)).toMatchObject({ poNumber: 'Q3-0001', revision: 1 })
    const b = sqlite.prepare('SELECT branch_id, created_at FROM bills').get() as { branch_id: string; created_at: string }
    expect(b.branch_id).not.toBe('other')
    expect(b.created_at.startsWith('2026-10-08')).toBe(true)
  })

  it('date, format, paper override and extra columns are stored as given', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1', { formatId: 'gst', paperOverride: 'A5', billDate: '2026-01-31', rows: [row('Pen', '2', '100', { gst: '18' })] }))
    expect(sqlite.prepare('SELECT format_id, paper_override, bill_date FROM bills').get()).toEqual({ format_id: 'gst', paper_override: 'A5', bill_date: '2026-01-31' })
    expect(JSON.parse((sqlite.prepare('SELECT totals_json FROM bills').get() as { totals_json: string }).totals_json)).toMatchObject({ itemsSubtotal: '200.00', gstTotal: '36.00' })
  })
})

describe('billService.save — validation writes nothing', () => {
  it('missing party name: VALIDATION, no bill, no rows, no revision, no party, PO counter untouched', () => {
    const { svc, sqlite } = mk()
    expect(() => svc.save(input('b1', { party: { name: '   ', phone: '1', address: '', transport: '' } }))).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    for (const t of ['bills', 'bill_rows', 'bill_revisions', 'parties']) expect(count(sqlite, t)).toBe(0)
    expect((sqlite.prepare('SELECT next_seq AS s FROM po_counters').get() as { s: number }).s).toBe(1)
    expect(svc.save(input('b2')).poNumber).toBe('Q3-0001')
  })

  it('no usable row: VALIDATION and nothing written', () => {
    const { svc, sqlite } = mk()
    expect(() => svc.save(input('b1', { rows: [blankRow(), row('only a name', null, null)] }))).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    expect(() => svc.save(input('b1', { rows: [] }))).toThrow(expect.objectContaining({ code: 'VALIDATION' }))
    for (const t of ['bills', 'bill_rows', 'bill_revisions', 'parties']) expect(count(sqlite, t)).toBe(0)
  })

  it('a failure in the middle of the transaction rolls EVERYTHING back (PO number is not burned)', () => {
    const { t } = mk()
    const sqlite = t.handle.sqlite
    const real = createBillRepo(sqlite)
    // The revision insert fails AFTER the PO allocation, the party insert, the bill insert and the rows.
    const bills = { ...real, insertRevision: () => { throw new Error('boom') } }
    const svc = createBillService({ sqlite, bills, parties: createPartyRepo(sqlite) }, { newId: () => `gen-${++n}` })
    expect(() => svc.save(input('b1'))).toThrow()
    for (const tb of ['bills', 'bill_rows', 'bill_revisions', 'parties']) expect(count(sqlite, tb)).toBe(0)
    expect((sqlite.prepare('SELECT next_seq AS s FROM po_counters').get() as { s: number }).s).toBe(1)
  })

  it('read-only database refuses with DB_ERROR', () => {
    const { svc } = mk({ writable: false })
    expect(() => svc.save(input('b1'))).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
  })
})

describe('billService.save — parties', () => {
  it('a new party name creates the party exactly once (source auto) and links the bill', () => {
    const { svc, sqlite } = mk()
    const r1 = svc.save(input('b1'))
    const p = sqlite.prepare('SELECT * FROM parties').all() as Record<string, unknown>[]
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ name: 'Ruby Traders', name_norm: 'ruby traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL', source: 'auto' })
    expect(r1.partyId).toBe(p[0]!['id'])
    // Same name (different case/spacing) on another bill and on a re-save → still ONE party, same link.
    const r2 = svc.save(input('b2', { party: { name: ' RUBY   traders ', phone: '', address: '', transport: '' } }))
    svc.save(input('b1', {}, 1))
    expect(count(sqlite, 'parties')).toBe(1)
    expect(r2.partyId).toBe(r1.partyId)
    expect((sqlite.prepare('SELECT count(*) AS c FROM bills WHERE party_id = ?').get(r1.partyId) as { c: number }).c).toBe(2)
  })

  it('0.1.11: an existing party takes the phone / address / transport typed on the bill (never the name); a blank never wipes', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    svc.save(input('b2', { party: { name: 'RUBY TRADERS', phone: '000', address: '', transport: 'None' } }))
    expect(sqlite.prepare('SELECT name, phone, address, transport FROM parties').get()).toEqual({ name: 'Ruby Traders', phone: '000', address: '1 Main Rd', transport: 'None' })
    expect(sqlite.prepare('SELECT count(*) AS c FROM parties').get()).toEqual({ c: 1 })
    svc.save(input('b3', { party: { name: 'Ruby Traders', phone: '', address: 'Elsewhere', transport: '' } }))
    expect(sqlite.prepare('SELECT phone, address, transport FROM parties').get()).toEqual({ phone: '000', address: 'Elsewhere', transport: 'None' })
    // the bill keeps its own snapshot

    // ...but the bill's own snapshot is what was typed on that bill.
    const snap = JSON.parse((sqlite.prepare("SELECT party_snapshot_json AS s FROM bills WHERE id = 'b2'").get() as { s: string }).s)
    expect(snap).toMatchObject({ phone: '000', address: '' })
  })

  it('blank optional fields are stored as NULL on the new party; the snapshot keeps empty strings', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1', { party: { name: 'Plain Co', phone: '', address: '', transport: '' } }))
    expect(sqlite.prepare('SELECT phone, address, transport FROM parties').get()).toEqual({ phone: null, address: null, transport: null })
  })

  it('a soft-deleted party with the same name is not re-linked: a new live party is created', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    sqlite.prepare("UPDATE parties SET deleted_at = '2026-10-08T00:00:00Z'").run()
    svc.save(input('b2'))
    expect(sqlite.prepare('SELECT count(*) AS c FROM parties WHERE deleted_at IS NULL').get()).toEqual({ c: 1 })
    expect(count(sqlite, 'parties')).toBe(2)
  })
})

describe('billService.save — editing a saved bill', () => {
  it('re-save keeps PO number / created_at, bumps revision, replaces the rows, stores a revision snapshot each time', () => {
    const { svc, sqlite } = mk()
    const first = svc.save(input('b1'))
    const second = svc.save(input('b1', { rows: [row('Only', '1', '5')] }, 1))
    expect(second).toMatchObject({ poNumber: 'Q3-0001', poSeq: 1, revision: 2, createdAt: first.createdAt })
    expect(second.updatedAt > first.updatedAt).toBe(true)
    expect(count(sqlite, 'bills')).toBe(1)
    expect(sqlite.prepare('SELECT name_plain FROM bill_rows ORDER BY idx').all()).toEqual([{ name_plain: 'Only' }])
    expect((sqlite.prepare('SELECT next_seq AS s FROM po_counters').get() as { s: number }).s).toBe(2) // an edit never allocates a PO
    const revs = sqlite.prepare('SELECT revision, snapshot_json FROM bill_revisions ORDER BY revision').all() as { revision: number; snapshot_json: string }[]
    expect(revs.map((r) => r.revision)).toEqual([1, 2])
    expect(JSON.parse(revs[0]!.snapshot_json).rows).toHaveLength(2)
    expect(JSON.parse(revs[1]!.snapshot_json).rows).toHaveLength(1)
    expect(JSON.parse(revs[1]!.snapshot_json).bill.revision).toBe(2)
  })

  it('a stale expectedRevision → CONFLICT_REVISION and nothing is written', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    svc.save(input('b1', { rows: [row('v2', '1', '1')] }, 1))
    expect(() => svc.save(input('b1', { rows: [row('stale', '1', '1')] }, 1))).toThrow(expect.objectContaining({ code: 'CONFLICT_REVISION' }))
    expect((sqlite.prepare('SELECT revision FROM bills').get() as { revision: number }).revision).toBe(2)
    expect(sqlite.prepare('SELECT name_plain FROM bill_rows').all()).toEqual([{ name_plain: 'v2' }])
    expect(count(sqlite, 'bill_revisions')).toBe(2)
  })

  it('without expectedRevision an existing bill is still updated (last write wins by design for local callers)', () => {
    const { svc } = mk()
    svc.save(input('b1'))
    expect(svc.save(input('b1')).revision).toBe(2)
  })

  it('a soft-deleted bill cannot be saved over → NOT_FOUND', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    sqlite.prepare("UPDATE bills SET deleted_at = '2026-10-08T00:00:00Z'").run()
    expect(() => svc.save(input('b1'))).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('revisions are capped to the newest 50 per bill', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    for (let i = 0; i < 54; i++) svc.save(input('b1'))
    const revs = (sqlite.prepare('SELECT revision FROM bill_revisions ORDER BY revision').all() as { revision: number }[]).map((r) => r.revision)
    expect(revs).toHaveLength(50)
    expect(revs[0]).toBe(6)
    expect(revs[49]).toBe(55)
  })
})

describe('billService.save — concurrency', () => {
  it('two saves fired together (Promise.all) never share a PO number', async () => {
    const { svc } = mk()
    const out = await Promise.all([1, 2, 3, 4, 5].map((i) => Promise.resolve().then(() => svc.save(input(`p${i}`)))))
    expect(new Set(out.map((o) => o.poNumber)).size).toBe(5)
    expect(out.map((o) => o.poNumber).sort()).toEqual(['Q3-0001', 'Q3-0002', 'Q3-0003', 'Q3-0004', 'Q3-0005'])
  })

  it('two connections to the same file (two app instances) get different PO numbers: the counter lives in the database', () => {
    const { t, svc } = mk()
    const second = openTestDbOn(t)
    const a = svc.save(input('a1'))
    const b = second.svc.save(input('b1'))
    const c = svc.save(input('a2'))
    expect([a.poNumber, b.poNumber, c.poNumber]).toEqual(['Q3-0001', 'Q3-0002', 'Q3-0003'])
    second.close()
  })

  it('the unique (branch, po_seq) index would refuse a duplicate even if the counter were bypassed', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    sqlite.prepare('UPDATE po_counters SET next_seq = 1').run() // sabotage: hand out PO 1 again
    expect(() => svc.save(input('b2'))).toThrow()
    expect(count(sqlite, 'bills')).toBe(1)
  })
})

describe('billService.newDefaults + outbox hook', () => {
  it('returns the default format, the local date, the local branch id and the next PO preview (which advances after a save)', () => {
    const { svc, sqlite } = mk()
    const d = svc.newDefaults()
    expect(d.formatId).toBe('non_gst')
    expect(d.billDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(d.branchId).toBe((sqlite.prepare('SELECT id FROM branches WHERE is_local = 1').get() as { id: string }).id)
    expect(d.nextPoPreview).toBe('Q3-0001')
    svc.save(input('b1'))
    expect(svc.newDefaults().nextPoPreview).toBe('Q3-0002')
  })

  it('the outbox hook runs inside the save, once per save, with created=true only for a new bill', () => {
    const t = openTestDb()
    open.push(t)
    const seen: unknown[] = []
    const svc = createBillService({ sqlite: t.handle.sqlite, bills: createBillRepo(t.handle.sqlite), parties: createPartyRepo(t.handle.sqlite) }, { outbox: (i) => { seen.push(i) } })
    svc.save(input('b1'))
    svc.save(input('b1'))
    expect(seen).toMatchObject([{ billId: 'b1', revision: 1, created: true }, { billId: 'b1', revision: 2, created: false }])
  })
})

describe('bills:* IPC validation', () => {
  const h = (svcOpts = {}) => { const { svc } = mk(svcOpts); return billHandlers(svc) }

  it('save round trip through the handler', async () => {
    const handlers = h()
    const r = (await handlers['bills:save']!(input('b1'))) as { ok: boolean; data?: { poNumber: string } }
    expect(r.ok).toBe(true)
    expect(r.data?.poNumber).toBe('Q3-0001')
  })

  it('unknown keys, bad dates, too many rows, wrong types and extra top-level input are rejected before the service', async () => {
    const { svc, sqlite } = mk()
    const handlers = billHandlers(svc)
    const bad = async (v: unknown) => ((await handlers['bills:save']!(v)) as { ok: boolean; error?: { code: string } })
    const base = input('b1')
    for (const v of [
      { ...base, extra: 1 },
      { bill: { ...base.bill, billDate: '08/10/2026' } },
      { bill: { ...base.bill, hacker: true } },
      { bill: { ...base.bill, rows: Array.from({ length: 2001 }, (_, i) => ({ ...row('x', '1', '1'), id: `r${i}` })) } },
      { bill: { ...base.bill, paperOverride: 'A3' } },
      { bill: { ...base.bill, formatId: '' } },
      { bill: { ...base.bill, rows: [{ ...row('x', '1', '1'), qty: 5 }] } },
      { bill: { ...base.bill, party: { name: 'x' } } },
      { ...base, expectedRevision: 0 },
      'nope',
      null
    ]) {
      const r = await bad(v)
      expect(r.ok).toBe(false)
      expect(r.error?.code).toBe('VALIDATION')
    }
    expect(count(sqlite, 'bills')).toBe(0)
  })

  it('service errors become stable result codes (validation, conflict)', async () => {
    const handlers = h()
    const call = async (v: unknown) => (await handlers['bills:save']!(v)) as { ok: boolean; error?: { code: string } }
    expect((await call(input('b1', { rows: [] }))).error?.code).toBe('VALIDATION')
    await call(input('b1'))
    expect((await call(input('b1', {}, 9))).error?.code).toBe('CONFLICT_REVISION')
  })

  it('newDefaults takes no input', async () => {
    const handlers = h()
    expect(((await handlers['bills:newDefaults']!({})) as { ok: boolean }).ok).toBe(true)
    expect(((await handlers['bills:newDefaults']!({ x: 1 })) as { ok: boolean }).ok).toBe(false)
  })
})

/** A second connection (own `openDatabase`) to the first test database's file. */
function openTestDbOn(t: TestDb): { svc: ReturnType<typeof createBillService>; close: () => void } {
  const db = new Database(t.file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  const svc = createBillService({ sqlite: db, bills: createBillRepo(db), parties: createPartyRepo(db) }, { newId: () => `x-${++n}` })
  return { svc, close: () => db.close() }
}

describe('billService.getForEdit (Phase 28)', () => {
  it('returns the saved bill (rows by idx, runs/extras intact, PO and revision), without grid padding', () => {
    const { svc } = mk()
    const styled: BillRow = { ...row('', '1', '100'), nameRuns: [{ t: 'Red', r: 1 }], extras: { c1: { text: '(1-1)' } } }
    const saved = svc.save(input('b1', { extraCols: [{ key: 'c1', header: 'h', kind: 'units' }], rows: [row('Pen', '2', '3'), styled, blankRow()] }))
    const b = svc.getForEdit('b1')
    expect(b).toMatchObject({ id: 'b1', poNumber: 'Q3-0001', revision: 1, partyId: saved.partyId, formatId: 'non_gst', billDate: '2026-10-08' })
    expect(b.rows.map((r) => r.idx)).toEqual([0, 1])
    expect(b.rows[1]!.nameRuns).toEqual([{ t: 'Red', r: 1 }])
    expect(b.rows[1]!.extras).toEqual({ c1: { text: '(1-1)' } })
    expect(b.party.name).toBe('Ruby Traders')
  })
  it('unknown id and trashed bill → NOT_FOUND', () => {
    const { svc, sqlite } = mk()
    expect(() => svc.getForEdit('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    svc.save(input('b1'))
    sqlite.prepare("UPDATE bills SET deleted_at = '2026-10-08T00:00:00Z'").run()
    expect(() => svc.getForEdit('b1')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })
  it('a damaged stored row → DB_ERROR, never a crash', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    sqlite.prepare("UPDATE bills SET party_snapshot_json = '{not json'").run()
    expect(() => svc.getForEdit('b1')).toThrow(expect.objectContaining({ code: 'DB_ERROR' }))
  })
  it('save → edit → save through getForEdit keeps one PO and bumps the revision', () => {
    const { svc } = mk()
    svc.save(input('b1'))
    const b = svc.getForEdit('b1')
    const again = svc.save({ bill: { id: b.id, party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate, rows: b.rows }, expectedRevision: b.revision })
    expect(again).toMatchObject({ poNumber: 'Q3-0001', revision: 2 })
  })
  it('IPC: getForEdit validates input and returns the bill', async () => {
    const { svc } = mk()
    svc.save(input('b1'))
    const h = billHandlers(svc)
    expect(((await h['bills:getForEdit']!({ id: 'b1' })) as { ok: boolean }).ok).toBe(true)
    expect(((await h['bills:getForEdit']!({ id: '' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['bills:getForEdit']!({ id: 'b1', x: 1 })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['bills:getForEdit']!({ id: 'zzz' })) as { error?: { code: string } }).error?.code).toBe('NOT_FOUND')
  })
})

describe('billService.delete (Phase 42, soft delete)', () => {
  it('marks the bill deleted (row kept, revision + 1), hides it from getForEdit, never frees its PO number', () => {
    const { svc, sqlite } = mk()
    svc.save(input('b1'))
    svc.save(input('b2'))
    const r = svc.delete(['b1'])
    expect(r).toEqual({ deleted: ['b1'], missing: [] })
    const row1 = sqlite.prepare('SELECT deleted_at, revision, po_number FROM bills WHERE id = ?').get('b1') as { deleted_at: string | null; revision: number; po_number: string }
    expect(row1.deleted_at).not.toBeNull()
    expect(row1.revision).toBe(2)
    expect(row1.po_number).toBe('Q3-0001')
    expect(count(sqlite, 'bill_rows')).toBe(4) // rows stay for restore (Phase 43)
    expect(() => svc.getForEdit('b1')).toThrow(/not found/i)
    expect(svc.save(input('b3')).poNumber).toBe('Q3-0003')
  })

  it('bulk: unknown and already-deleted ids come back in `missing`, duplicates are deleted once; saving a trashed bill is refused', () => {
    const { svc } = mk()
    svc.save(input('b1'))
    svc.save(input('b2'))
    expect(svc.delete(['b1', 'b1', 'nope'])).toEqual({ deleted: ['b1'], missing: ['nope'] })
    expect(svc.delete(['b1', 'b2'])).toEqual({ deleted: ['b2'], missing: ['b1'] })
    expect(() => svc.save(input('b1'))).toThrow(/trash/)
  })

  it('a read-only database refuses; the outbox hook sees each deletion', () => {
    const ro = mk({ writable: false })
    expect(() => ro.svc.delete(['x'])).toThrow(/read-only/)
    const t = openTestDb()
    open.push(t)
    const seen: Array<{ billId: string; revision: number; created: boolean }> = []
    const svc = createBillService({ sqlite: t.handle.sqlite, bills: createBillRepo(t.handle.sqlite), parties: createPartyRepo(t.handle.sqlite) }, { outbox: (i) => seen.push(i) })
    svc.save(input('o1'))
    svc.delete(['o1'])
    expect(seen.map((s) => [s.billId, s.revision, s.created])).toEqual([['o1', 1, true], ['o1', 2, false]])
  })

  it('IPC bills:delete validates ids (1..500, strings) and the history list stops showing the bill', async () => {
    const { svc } = mk()
    svc.save(input('b1'))
    const h = billHandlers(svc)['bills:delete']!
    for (const bad of [{}, { ids: [] }, { ids: [''] }, { ids: [1] }, { ids: Array(501).fill('a') }, { ids: ['a'], x: 1 }]) expect(await h(bad)).toMatchObject({ ok: false })
    expect(await h({ ids: ['b1'] })).toEqual({ ok: true, data: { deleted: ['b1'], missing: [] } })
  })
})
