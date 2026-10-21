import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { computeBill } from '../../shared/calc/billTotals'
import { getBillOptions } from '../../shared/calc/billOptions'
import { resolveFormat } from '../../shared/format/registry'
import { createEmptyBill } from '../../shared/billModel'
import { LEGACY_ITEMS_TOTAL, legacyBill, row } from '../../shared/__fixtures__/bills'
import type { Bill } from '../../shared/types'
import { openPhoneDb, putRecord, countRecords, reqToPromise, type PhoneDb } from '../data/db'
import { setMetaValue, getMetaValue } from '../data/metaRepo'
import { setSetting } from '../data/settingsRepo'
import { exportBackup, importBackup } from '../data/backup'
import {
  BillError, REVISION_CAP_PER_BILL, billExists, deleteBills, getBill, listBillHeads, listRevisions, peekNextPoNumber, restoreBills, saveBill,
  type SaveBillInput
} from '../data/billsRepo'
import { deleteDraft, getDraft, inspectDraft, isDraftWorthKeeping, latestDraft, listDrafts, saveDraft } from '../data/draftsRepo'

// Browsers have `IDBKeyRange` as a global; the in-memory fake does not install one, so this file does (tests only).
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

const T0 = new Date('2026-10-21T10:00:00.000Z')
let tick = 0
const clock = () => new Date(T0.getTime() + 1000 * tick++)

async function freshDb(opts: { branch?: boolean; factory?: IDBFactory; writer?: { held: boolean } } = {}): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: opts.factory ?? new IDBFactory(), writer: opts.writer })
  if (opts.branch !== false) {
    await setMetaValue(db, 'branch_id', 'branch-phone')
    await setMetaValue(db, 'po_prefix', 'PH-')
  }
  return db
}

let n = 0
function input(over: { id?: string; name?: string; formatId?: string; rows?: ReturnType<typeof legacyBill>; partyId?: string | null; expectedRevision?: number } = {}): SaveBillInput {
  const b = createEmptyBill({ branchId: 'x', formatId: over.formatId ?? 'non_gst', billDate: '2026-10-21', newId: () => `id-${++n}` })
  return {
    bill: {
      id: over.id ?? `bill-${++n}`, party: { name: over.name ?? 'Test Party', phone: '', address: '', transport: '' },
      formatId: b.formatId, extraCols: [], paperOverride: null, billDate: b.billDate,
      rows: over.rows ?? [row('widget', '2', '50')]
    },
    ...(over.partyId !== undefined ? { partyId: over.partyId } : {}),
    ...(over.expectedRevision !== undefined ? { expectedRevision: over.expectedRevision } : {})
  }
}
const withId = (inp: SaveBillInput, id: string): SaveBillInput => ({ ...inp, bill: { ...inp.bill, id } })

describe('saveBill: PO number and counter', () => {
  it('refuses to save until the phone has a branch and prefix, and takes no number', async () => {
    const db = await freshDb({ branch: false })
    await expect(saveBill(db, input(), { now: clock })).rejects.toMatchObject({ code: 'NO_BRANCH' })
    expect(await countRecords(db, 'bills')).toBe(0)
    expect(await peekNextPoNumber(db)).toBeNull()
  })
  it('numbers bills PREFIX + 4-digit sequence from the phone counter', async () => {
    const db = await freshDb()
    expect(await peekNextPoNumber(db)).toBe('PH-0001')
    const a = await saveBill(db, input(), { now: clock })
    const b = await saveBill(db, input(), { now: clock })
    expect([a.poNumber, a.poSeq, b.poNumber, b.poSeq]).toEqual(['PH-0001', 1, 'PH-0002', 2])
    expect(await getMetaValue(db, 'po_counter')).toBe(2)
    expect(await peekNextPoNumber(db)).toBe('PH-0003')
  })
  it('many quick saves at once never repeat a number and leave no gap', async () => {
    const db = await freshDb()
    const results = await Promise.all(Array.from({ length: 12 }, () => saveBill(db, input(), { now: clock })))
    const seqs = results.map((r) => r.poSeq).sort((x, y) => x - y)
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(new Set(results.map((r) => r.poNumber)).size).toBe(12)
    expect(await getMetaValue(db, 'po_counter')).toBe(12)
  })
  it('a refused or failed save does not use up a number', async () => {
    const db = await freshDb()
    await expect(saveBill(db, input({ name: '  ' }), { now: clock })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(saveBill(db, input({ rows: [row('', null, null)] }), { now: clock })).rejects.toMatchObject({ code: 'VALIDATION' })
    // A failure INSIDE the transaction (the hook throws) rolls the counter and the bill back together.
    await expect(saveBill(db, input(), { now: clock, inTx: () => { throw new Error('boom') } })).rejects.toThrow('boom')
    expect(await getMetaValue(db, 'po_counter')).toBe(0)
    expect(await countRecords(db, 'bills')).toBe(0)
    expect(await countRecords(db, 'bill_rows')).toBe(0)
    const ok = await saveBill(db, input(), { now: clock })
    expect(ok.poNumber).toBe('PH-0001')
  })
})

describe('saveBill: edit rules', () => {
  it('keeps po_number / po_seq / created_at / branch, adds one revision, and does not touch the counter', async () => {
    const db = await freshDb()
    const first = await saveBill(db, input({ id: 'b1' }), { now: clock })
    await setMetaValue(db, 'po_prefix', 'ZZ-') // a prefix change later must never renumber an existing bill
    const second = await saveBill(db, { ...input({ id: 'b1', rows: [row('widget', '3', '50')] }), expectedRevision: 1 }, { now: clock })
    expect(second).toMatchObject({ poNumber: first.poNumber, poSeq: first.poSeq, createdAt: first.createdAt, revision: 2, created: false })
    expect(second.updatedAt > first.updatedAt).toBe(true)
    expect(await getMetaValue(db, 'po_counter')).toBe(1)
    const bill = await getBill(db, 'b1')
    expect(bill).toMatchObject({ revision: 2, poNumber: 'PH-0001', branchId: 'branch-phone', syncState: 'local_only' })
    expect(bill.rows[0]?.qty).toBe('3')
  })
  it('refuses a save made from an out-of-date copy (CONFLICT_REVISION) and writes nothing', async () => {
    const db = await freshDb()
    await saveBill(db, input({ id: 'b1' }), { now: clock })
    await saveBill(db, input({ id: 'b1' }), { now: clock })
    await expect(saveBill(db, input({ id: 'b1', expectedRevision: 1 }), { now: clock })).rejects.toMatchObject({ code: 'CONFLICT_REVISION' })
    expect((await getBill(db, 'b1')).revision).toBe(2)
  })
  it('removed rows disappear; trailing blank rows are not stored; party fields are trimmed', async () => {
    const db = await freshDb()
    const rows = [row('one', '1', '10'), row('two', '2', '20'), row('', null, null), row('', null, null)]
    const inp = input({ id: 'b1', name: '  Ravi Traders  ', rows })
    await saveBill(db, inp, { now: clock })
    expect((await getBill(db, 'b1')).rows).toHaveLength(2)
    expect((await getBill(db, 'b1')).party.name).toBe('Ravi Traders')
    await saveBill(db, { ...inp, bill: { ...inp.bill, rows: [rows[0]!] } }, { now: clock })
    expect((await getBill(db, 'b1')).rows.map((r) => r.nameRuns[0]?.t)).toEqual(['one'])
    expect(await countRecords(db, 'bill_rows')).toBe(1)
  })
  it('keeps rich-text runs, extra columns and the party link; the stored row carries the index fields', async () => {
    const db = await freshDb()
    const r = row('', '1', '100', { nameRuns: [{ t: 'bold ', b: 1 }, { t: 'red', b: 1, r: 1 }], extras: { c1: { text: '5 pcs', marked: true } } })
    const inp = input({ id: 'b1', rows: [r], partyId: 'party-1' })
    await saveBill(db, { ...inp, bill: { ...inp.bill, extraCols: [{ key: 'c1', header: 'Pcs', kind: 'units' }] } }, { now: clock })
    const bill = await getBill(db, 'b1')
    expect(bill.partyId).toBe('party-1')
    expect(bill.extraCols).toEqual([{ key: 'c1', header: 'Pcs', kind: 'units' }])
    expect(bill.rows[0]?.nameRuns).toEqual([{ t: 'bold ', b: 1 }, { t: 'red', b: 1, r: 1 }])
    expect(bill.rows[0]?.extras).toEqual({ c1: { text: '5 pcs', marked: true } })
    const tx = db.idb.transaction('bills')
    const found = (await reqToPromise(tx.objectStore('bills').index('po_number').getAll('PH-0001'))) as Array<{ id: string; bill_date: string }>
    expect(found.map((f) => [f.id, f.bill_date])).toEqual([['b1', '2026-10-21']])
  })
  it('a read-only tab cannot save', async () => {
    const writer = { held: true }
    const db = await freshDb({ writer })
    writer.held = false
    await expect(saveBill(db, input(), { now: clock })).rejects.toMatchObject({ code: 'read-only' })
    expect(await countRecords(db, 'bills')).toBe(0)
  })
})

describe('revision history cap', () => {
  it('keeps the newest N (default 5) and never touches other bills', async () => {
    const db = await freshDb()
    await saveBill(db, input({ id: 'other' }), { now: clock })
    for (let i = 0; i < 8; i++) await saveBill(db, input({ id: 'b1' }), { now: clock })
    const revs = await listRevisions(db, 'b1')
    expect(REVISION_CAP_PER_BILL).toBe(5)
    expect(revs.map((r) => r.revision)).toEqual([8, 7, 6, 5, 4])
    expect((await listRevisions(db, 'other')).map((r) => r.revision)).toEqual([1])
    const snap = JSON.parse(revs[0]!.snapshot_json) as { bill: { revision: number }; rows: unknown[] }
    expect(snap.bill.revision).toBe(8)
    expect(snap.rows).toHaveLength(1)
  })
  it('honours a custom cap', async () => {
    const db = await freshDb()
    for (let i = 0; i < 4; i++) await saveBill(db, input({ id: 'b1' }), { now: clock, revisionCap: 2 })
    expect((await listRevisions(db, 'b1')).map((r) => r.revision)).toEqual([4, 3])
  })
})

describe('soft delete and restore', () => {
  it('moves a bill to the trash and back; content and PO number are untouched; revision goes up each time', async () => {
    const db = await freshDb()
    await saveBill(db, input({ id: 'b1' }), { now: clock })
    await saveBill(db, input({ id: 'b2' }), { now: clock })
    const del = await deleteBills(db, ['b1', 'b1', 'nope'], { now: clock })
    expect(del).toEqual({ deleted: ['b1'], missing: ['nope'] })
    await expect(getBill(db, 'b1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await listBillHeads(db)).map((h) => h.id)).toEqual(['b2'])
    const trash = await listBillHeads(db, { trashed: true })
    expect(trash).toHaveLength(1)
    expect(trash[0]).toMatchObject({ id: 'b1', poNumber: 'PH-0001', revision: 2 })
    expect(trash[0]?.deletedAt).not.toBeNull()
    // Deleting again, or restoring a live bill, reports `missing` and changes nothing.
    expect(await deleteBills(db, ['b1'], { now: clock })).toEqual({ deleted: [], missing: ['b1'] })
    expect(await restoreBills(db, ['b2'], { now: clock })).toEqual({ restored: [], missing: ['b2'] })
    expect(await restoreBills(db, ['b1'], { now: clock })).toEqual({ restored: ['b1'], missing: [] })
    const back = await getBill(db, 'b1')
    expect(back).toMatchObject({ revision: 3, poNumber: 'PH-0001', deletedAt: null })
    expect(back.rows[0]?.nameRuns[0]?.t).toBe('widget')
    expect(await listBillHeads(db, { trashed: true })).toEqual([])
    expect(await billExists(db, 'b1')).toBe(true)
    expect(await billExists(db, 'nope')).toBe(false)
  })
  it('a trashed bill cannot be edited, and its number is never reissued', async () => {
    const db = await freshDb()
    await saveBill(db, input({ id: 'b1' }), { now: clock })
    await deleteBills(db, ['b1'], { now: clock })
    await expect(saveBill(db, input({ id: 'b1' }), { now: clock })).rejects.toMatchObject({ code: 'TRASHED' })
    expect((await saveBill(db, input({ id: 'b2' }), { now: clock })).poNumber).toBe('PH-0002')
  })
  it('the change hook sees delete / restore inside the transaction and a throw undoes the change', async () => {
    const db = await freshDb()
    await saveBill(db, input({ id: 'b1' }), { now: clock })
    const seen: string[] = []
    await deleteBills(db, ['b1'], { now: clock, inTx: (tx, i) => { seen.push(`${i.op}:${i.billId}:${i.revision}`); tx.objectStore('sync_outbox').put({ id: 'o1', kind: 'bill', rec_id: i.billId, op: i.op }) } })
    expect(seen).toEqual(['delete:b1:2'])
    expect(await countRecords(db, 'sync_outbox')).toBe(1)
    await expect(restoreBills(db, ['b1'], { now: clock, inTx: () => { throw new Error('no') } })).rejects.toThrow('no')
    expect((await listBillHeads(db, { trashed: true })).map((h) => h.id)).toEqual(['b1'])
  })
})

describe('totals cache equals the shared calc', () => {
  const headOf = async (db: PhoneDb, id: string) => (await listBillHeads(db)).find((h) => h.id === id)!
  const cacheOf = async (db: PhoneDb, id: string) => {
    const rec = (await reqToPromise(db.idb.transaction('bills').objectStore('bills').get(id))) as { totalsJson: string; itemRowCount: number }
    return { totals: JSON.parse(rec.totalsJson) as Record<string, string>, itemRowCount: rec.itemRowCount }
  }
  it('non-GST legacy fixture: cache, row count and list total match computeBill', async () => {
    const db = await freshDb()
    await setSetting(db, 'calc.roundOff', false)
    await saveBill(db, input({ id: 'b1', rows: legacyBill() }), { now: clock })
    const bill = await getBill(db, 'b1')
    const calc = computeBill(resolveFormat(bill.formatId), bill.rows, getBillOptions(bill))
    const { totals, itemRowCount } = await cacheOf(db, 'b1')
    expect(totals).toEqual({ itemsSubtotal: calc.itemsTotal, adjustmentsTotal: calc.adjustmentsTotal, grandTotal: calc.grandTotal, gstTotal: calc.itemsGst })
    expect(itemRowCount).toBe(calc.counts.itemRows)
    expect(itemRowCount).toBe(18)
    expect(Number(totals.itemsSubtotal)).toBe(Number(LEGACY_ITEMS_TOTAL))
    expect((await headOf(db, 'b1')).grandTotal).toBe(calc.grandTotal)
  })
  it('GST format with GST rates and an adjustment matches computeBill', async () => {
    const db = await freshDb()
    await setSetting(db, 'calc.roundOff', false)
    const rows = [row('a', '2', '100', { gst: '18' }), row('b', '1', '55.5', { gst: '5' }), row('discount', null, null, { total: '-10' })]
    await saveBill(db, input({ id: 'g1', formatId: 'gst', rows }), { now: clock })
    const bill = await getBill(db, 'g1')
    const calc = computeBill(resolveFormat('gst'), bill.rows, getBillOptions(bill))
    const { totals } = await cacheOf(db, 'g1')
    expect(totals.grandTotal).toBe(calc.grandTotal)
    expect(totals.gstTotal).toBe(calc.itemsGst)
    expect(Number(totals.gstTotal)).toBeGreaterThan(0)
  })
  it('switching the format on a saved bill keeps every row (rows are a superset)', async () => {
    const db = await freshDb()
    const rows = [row('a', '2', '100', { gst: '18' })]
    await saveBill(db, input({ id: 'g1', formatId: 'gst', rows }), { now: clock })
    const g = await getBill(db, 'g1')
    await saveBill(db, { bill: { ...g, formatId: 'non_gst' } }, { now: clock })
    const after = await getBill(db, 'g1')
    expect(after.formatId).toBe('non_gst')
    expect(after.rows[0]).toMatchObject({ qty: '2', rate: '100', gstRate: '18' })
  })
})

describe('round-off flag and the bill-options read', () => {
  const grandOf = async (db: PhoneDb, id: string) => (await listBillHeads(db)).find((h) => h.id === id)!.grandTotal
  it('is stamped from calc.roundOff on every save (default ON) and totals follow the flag through getBillOptions', async () => {
    const db = await freshDb()
    const rows = [row('a', '1', '100.40')]
    const on = await saveBill(db, input({ id: 'b1', rows }), { now: clock })
    expect(on.roundOff).toBe(1)
    expect((await getBill(db, 'b1')).roundOff).toBe(1)
    expect(Number(await grandOf(db, 'b1'))).toBe(100)

    await setSetting(db, 'calc.roundOff', false)
    const off = await saveBill(db, input({ id: 'b2', rows }), { now: clock })
    expect(off.roundOff).toBe(0)
    expect((await getBill(db, 'b2')).roundOff).toBeUndefined()
    expect(Number(await grandOf(db, 'b2'))).toBe(100.4)

    // Re-saving an old bill stamps the CURRENT setting (as desktop Phase 77): b1 was ON, now OFF.
    const resaved = await saveBill(db, input({ id: 'b1', rows }), { now: clock })
    expect(resaved.roundOff).toBe(0)
    expect(Number(await grandOf(db, 'b1'))).toBe(100.4)
  })
})

describe('drafts: autosave and crash recovery', () => {
  const editorBill = (id: string, name: string, rows = [row('wid', '1', '5'), row('', null, null), row('', null, null)]): Bill => ({
    ...createEmptyBill({ branchId: 'phone', formatId: 'non_gst', billDate: '2026-10-21', rowCount: 0 }),
    id, party: { name, phone: '', address: '', transport: '' }, rows
  })
  it('survives a simulated reload (close and reopen the database) with trailing blank rows as typed', async () => {
    const factory = new IDBFactory()
    const a = await freshDb({ factory })
    const bill = editorBill('d1', 'Half typed')
    expect(await saveDraft(a, bill, { now: clock, baseRevision: null })).toBe(true)
    a.close()
    const b = await freshDb({ factory })
    const d = await getDraft(b, 'd1')
    expect(d?.bill.party.name).toBe('Half typed')
    expect(d?.bill.rows).toHaveLength(3)
    expect(d?.baseRevision).toBeNull()
    expect((await latestDraft(b))?.id).toBe('d1')
  })
  it('a blank bill keeps no draft and clears an older one; typing anything keeps it', async () => {
    const db = await freshDb()
    const blank = editorBill('d1', '', [row('', null, null)])
    expect(isDraftWorthKeeping(blank)).toBe(false)
    expect(await saveDraft(db, editorBill('d1', 'x'), { now: clock })).toBe(true)
    expect(await saveDraft(db, blank, { now: clock })).toBe(false)
    expect(await getDraft(db, 'd1')).toBeUndefined()
    expect(isDraftWorthKeeping(editorBill('d2', '', [row('thing', null, null)]))).toBe(true)
  })
  it('saving the bill deletes its draft in the same transaction; other drafts stay; deleteDraft works', async () => {
    const db = await freshDb()
    await saveDraft(db, editorBill('d1', 'Ravi'), { now: clock })
    await saveDraft(db, editorBill('d2', 'Other'), { now: clock })
    await saveBill(db, { bill: editorBill('d1', 'Ravi') }, { now: clock })
    expect((await listDrafts(db)).map((d) => d.id)).toEqual(['d2'])
    await deleteDraft(db, 'd2')
    expect(await listDrafts(db)).toEqual([])
  })
  it('lists newest first and skips a damaged draft instead of throwing', async () => {
    const db = await freshDb()
    await saveDraft(db, editorBill('old', 'Old'), { now: clock })
    await saveDraft(db, editorBill('new', 'New'), { now: clock })
    await putRecord(db, 'drafts', { id: 'bad', base_revision: null, saved_at: 'x', bill_json: '{not json' })
    await putRecord(db, 'drafts', { id: 'bad2', base_revision: null, saved_at: 'x', bill_json: JSON.stringify({ id: 'bad2' }) })
    expect((await listDrafts(db)).map((d) => d.id)).toEqual(['new', 'old'])
    expect(await getDraft(db, 'bad')).toBeUndefined()
  })
  it('inspectDraft tells new / current / stale / bill-deleted', async () => {
    const db = await freshDb()
    const brandNew = editorBill('n1', 'New one')
    await saveDraft(db, brandNew, { now: clock })
    expect(await inspectDraft(db, (await getDraft(db, 'n1'))!)).toBe('new')

    await saveBill(db, { bill: editorBill('e1', 'Saved') }, { now: clock }) // revision 1
    await saveDraft(db, editorBill('e1', 'Saved edit'), { now: clock, baseRevision: 1 })
    expect(await inspectDraft(db, (await getDraft(db, 'e1'))!)).toBe('current')
    await saveBill(db, { bill: editorBill('e1', 'Saved') }, { now: clock }) // someone else (sync) moved it to revision 2
    await saveDraft(db, editorBill('e1', 'Saved edit'), { now: clock, baseRevision: 1 })
    expect(await inspectDraft(db, (await getDraft(db, 'e1'))!)).toBe('stale')
    await deleteBills(db, ['e1'], { now: clock })
    expect(await inspectDraft(db, (await getDraft(db, 'e1'))!)).toBe('bill-deleted')
  })
})

describe('backup round trip keeps bills, rows, revisions and the counter', () => {
  it('export then import into a fresh database gives identical bills and the next PO number continues', async () => {
    const a = await freshDb()
    await saveBill(a, input({ id: 'b1', rows: legacyBill() }), { now: clock })
    await saveBill(a, input({ id: 'b2' }), { now: clock })
    await deleteBills(a, ['b2'], { now: clock })
    const file = await exportBackup(a, { appVersion: '0.1.17', now: () => T0 })
    expect(file.counts.bills).toBe(2)
    const b = await freshDb({ branch: false })
    await importBackup(b, file.blob, () => T0)
    expect(await getBill(b, 'b1')).toEqual(await getBill(a, 'b1'))
    expect((await listBillHeads(b, { trashed: true })).map((h) => h.id)).toEqual(['b2'])
    expect(await peekNextPoNumber(b)).toBe('PH-0003')
    expect((await saveBill(b, input(), { now: clock })).poNumber).toBe('PH-0003')
  })
})
