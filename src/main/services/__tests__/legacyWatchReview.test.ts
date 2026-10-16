import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createLegacyImportRepo } from '../../db/legacyImportRepo'
import { createLegacyWatchRepo } from '../../db/legacyWatchRepo'
import { createOutboxRepo } from '../../db/outboxRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService } from '../billService'
import { createLegacyWatchApply, type WatchFile } from '../legacyWatchApply'

// Phase 163 - Needs review + Activity. SYNTHETIC data only; temp in-memory databases.
const dbs: TestDb[] = []
afterEach(() => { dbs.splice(0).forEach((t) => t.cleanup()) })
void rmSync

const item = (name: string, qty: string, rate: string): Record<string, unknown> => ({ name, qty, rate, amt: String(Number(qty) * Number(rate)) })
const T1 = Date.UTC(2026, 9, 1, 8, 0, 0)
const legacy = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  bill_no: 'BR1_100', date: '08-10-2026', party: 'ACME TRADERS', phone: '99450', transport: 'VRL', gst: '', format_mode: 'manual', extra_headers: [],
  items: [item('Tomato', '10', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')], total: 380, ...o
})
const file = (name: string, body: Record<string, unknown>, mtimeMs = T1): WatchFile => { const text = JSON.stringify(body); return { name, text, size: text.length, mtimeMs } }
const withItems = (items: Array<Record<string, unknown>>, o: Record<string, unknown> = {}): Record<string, unknown> => legacy({ items, ...o })

function mk() {
  const t = openTestDb(); dbs.push(t)
  const sqlite = t.handle.sqlite
  const backups: string[] = []
  const billRepo = createBillRepo(sqlite)
  const outboxRepo = createOutboxRepo(sqlite)
  let clock = Date.UTC(2026, 9, 10, 9, 0, 0)
  let n = 0
  const watchRepo = createLegacyWatchRepo(sqlite)
  const apply = createLegacyWatchApply(
    { sqlite, repo: watchRepo, importRepo: createLegacyImportRepo(sqlite), bills: billRepo, backup: { create: async (kind) => { backups.push(kind); return { file: `b${backups.length}.db`, kind, createdAt: new Date(clock).toISOString(), sizeBytes: 1, billCount: 0, readable: true } } } },
    { now: () => new Date(clock), newId: () => `id-${++n}`, outbox: (i) => { outboxRepo.enqueue({ billId: i.billId, op: i.op ?? 'upsert', revision: i.revision, at: new Date(clock).toISOString(), keepSyncedBefore: '' }) } }
  )
  const bills = createBillService({ sqlite, bills: billRepo, parties: createPartyRepo(sqlite) }, { now: () => new Date(clock), newId: () => `gen-${++n}` })
  const count = (table: string, where = '1=1'): number => (sqlite.prepare(`SELECT count(*) AS c FROM ${table} WHERE ${where}`).get() as { c: number }).c
  const row = (id: string): { revision: number; deleted_at: string | null } => sqlite.prepare('SELECT revision, deleted_at FROM bills WHERE id = ?').get(id) as { revision: number; deleted_at: string | null }
  const names = (id: string): string[] => (sqlite.prepare('SELECT name_plain AS n FROM bill_rows WHERE bill_id = ? ORDER BY idx').all(id) as Array<{ n: string }>).map((r) => r.n)
  const advance = (ms: number): void => { clock += ms }
  /** A bill imported, then edited inside Quot3, then a newer copy of the legacy file -> one open `locally_edited` item. */
  const locallyEdited = async (): Promise<{ billId: string; reviewId: string }> => {
    const first = await apply.applyBatch([file('a.json', legacy())])
    const billId = first.outcomes[0]!.billId!
    const bill = bills.getForEdit(billId)
    advance(1000)
    bills.save({ bill: { id: billId, party: bill.party, formatId: bill.formatId, extraCols: bill.extraCols, paperOverride: null, billDate: bill.billDate, rows: bill.rows.slice(0, 2) }, expectedRevision: 1 })
    await apply.applyBatch([file('b.json', withItems([item('Tomato', '12', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')]), T1 + 60_000)])
    return { billId, reviewId: apply.reviewLists().open[0]!.id }
  }
  return { sqlite, apply, bills, watchRepo, backups, count, row, names, advance, locallyEdited }
}

describe('legacyWatchReview - lists', () => {
  it('lists an open item with its candidate PO, without the stored file text; the count follows', async () => {
    const m = mk()
    expect(m.apply.reviewCount()).toBe(0)
    const { billId } = await m.locallyEdited()
    expect(m.apply.reviewCount()).toBe(1)
    const lists = m.apply.reviewLists()
    expect(lists.open).toHaveLength(1)
    expect(lists.open[0]).toMatchObject({ fileName: 'b.json', party: 'ACME TRADERS', billDate: '2026-10-08', why: 'locally_edited' })
    expect(lists.open[0]!.candidates).toEqual([{ billId, poNumber: expect.any(String), deleted: false }])
    expect(JSON.stringify(lists)).not.toContain('Tomato')
  })

  it('the activity list marks only automatic imports / updates that were not undone as undoable', async () => {
    const m = mk()
    await m.locallyEdited()
    const items = m.apply.activityItems()
    expect(items.find((a) => a.kind === 'imported')).toMatchObject({ canUndo: true, undone: false })
    expect(items.find((a) => a.kind === 'review')).toMatchObject({ canUndo: false })
  })
})

describe('legacyWatchReview - resolve', () => {
  it('Ignore resolves it, logs it, marks the file ignored; Put back reopens it (nothing deleted)', async () => {
    const m = mk()
    const { reviewId } = await m.locallyEdited()
    const r = await m.apply.resolveReview(reviewId, 'ignore')
    expect(r.action).toBe('ignore')
    expect(m.apply.reviewCount()).toBe(0)
    expect(m.apply.reviewLists().ignored.map((x) => x.id)).toEqual([reviewId])
    expect(m.watchRepo.getFile('b.json')?.lastResult).toBe('ignored')
    expect(m.count('bills')).toBe(1)
    await expect(m.apply.resolveReview(reviewId, 'ignore')).rejects.toMatchObject({ code: 'VALIDATION' })
    await m.apply.resolveReview(reviewId, 'reopen')
    expect(m.apply.reviewCount()).toBe(1)
    expect(m.watchRepo.getFile('b.json')?.lastResult).toBe('review')
    expect(m.apply.activityItems().map((a) => a.kind)).toEqual(expect.arrayContaining(['review_ignored', 'review_reopened']))
  })

  it('Put back is refused for an item that is still open', async () => {
    const m = mk()
    const { reviewId } = await m.locallyEdited()
    await expect(m.apply.resolveReview(reviewId, 'reopen')).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('Replace writes the file as a NEW revision of the chosen bill (old version kept, outbox row, one backup), resolves the item, and the update can be undone', async () => {
    const m = mk()
    const { billId, reviewId } = await m.locallyEdited()
    expect(m.names(billId)).toEqual(['Tomato', 'Onion'])
    const before = m.backups.length
    const r = await m.apply.resolveReview(reviewId, 'replace')
    expect(r.billId).toBe(billId)
    expect(m.row(billId).revision).toBe(3)
    expect(m.names(billId)).toEqual(['Tomato', 'Onion', 'Potato'])
    expect(m.backups.length).toBe(before + 1)
    expect(m.count('bill_revisions', `bill_id = '${billId}'`)).toBe(3)
    expect(m.count('sync_outbox', `bill_id = '${billId}' AND state = 'pending'`)).toBeGreaterThan(0)
    expect(m.apply.reviewCount()).toBe(0)
    expect(m.apply.reviewLists().ignored).toHaveLength(0)
    const upd = m.apply.activityItems().find((a) => a.kind === 'updated')!
    expect(upd.canUndo).toBe(true)
    m.apply.undo(upd.id)
    expect(m.row(billId).revision).toBe(4)
    expect(m.names(billId)).toEqual(['Tomato', 'Onion'])
  })

  it('Replace refuses a bill that is not a candidate, a bill in Recently deleted, and a file with the same content', async () => {
    const m = mk()
    const { billId, reviewId } = await m.locallyEdited()
    await expect(m.apply.resolveReview(reviewId, 'replace', 'not-a-candidate')).rejects.toMatchObject({ code: 'VALIDATION' })
    m.sqlite.prepare("UPDATE bills SET deleted_at = '2026-10-10T00:00:00.000Z' WHERE id = ?").run(billId)
    await expect(m.apply.resolveReview(reviewId, 'replace')).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('Recently deleted') })
    expect(m.apply.reviewCount()).toBe(1)
  })

  it('Import as new bill makes a separate bill (revision 1, tagged, outbox row), resolves the item, and the import can be undone', async () => {
    const m = mk()
    const { billId, reviewId } = await m.locallyEdited()
    const r = await m.apply.resolveReview(reviewId, 'import_new')
    expect(r.billId).not.toBeNull()
    expect(r.billId).not.toBe(billId)
    expect(m.row(r.billId!).revision).toBe(1)
    expect(m.names(r.billId!)).toEqual(['Tomato', 'Onion', 'Potato'])
    expect(m.names(billId)).toEqual(['Tomato', 'Onion'])
    expect(m.count('sync_outbox', `bill_id = '${r.billId}' AND state = 'pending'`)).toBe(1)
    expect(m.apply.reviewCount()).toBe(0)
    const imp = m.apply.activityItems().find((a) => a.kind === 'imported' && a.billId === r.billId)!
    m.apply.undo(imp.id)
    expect(m.row(r.billId!).deleted_at).not.toBeNull()
    expect(m.count('bills')).toBe(2) // soft delete only
  })

  it('an unknown or already resolved item is refused in plain words', async () => {
    const m = mk()
    await expect(m.apply.resolveReview('nope', 'ignore')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const { reviewId } = await m.locallyEdited()
    await m.apply.resolveReview(reviewId, 'replace')
    await expect(m.apply.resolveReview(reviewId, 'replace')).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})
