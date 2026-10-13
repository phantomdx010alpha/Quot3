import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { serializeBill } from '../../billModel'
import { blankRow, row } from '../../__fixtures__/bills'
import type { Bill } from '../../types'
import { PAYLOAD_V, READER_VER, SCHEMA_VER, decodeRecord, encodeRecord, hashPayload, rawFromAside, asideEnvelopeJson, sha256Hex, utf8Bytes, type EncodedRecord, type RawRecord } from '../codecV2'

const ROWS = [row('Pen', '10', '9'), row('Book', '2', '45.50'), blankRow()] // fixture ids are counters: build once so two bills share row ids
const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1', branchId: 'br1', poSeq: 1, poNumber: 'Q3-0001', partyId: null,
  party: { name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' }, formatId: 'non_gst', extraCols: [],
  paperOverride: null, billDate: '2026-10-08', rows: ROWS,
  revision: 1, createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', deletedAt: null, syncState: 'local_only', ...over
})
const billData = (over: Partial<Bill> = {}) => {
  const s = serializeBill(bill(over))
  const { syncState: _s, ...rec } = s.bill
  void _s
  return { bill: rec, rows: s.rows }
}
const enc = (over: Partial<Parameters<typeof encodeRecord>[0]> = {}): EncodedRecord =>
  encodeRecord({ kind: 'bill', recId: 'b1', data: billData(), deleted: false, editedAt: '2026-10-08T10:00:00.000Z', appVer: '0.1.0', ...over })
const toRaw = (e: EncodedRecord, over: Partial<RawRecord> = {}): RawRecord => ({
  kind: e.kind, recId: e.recId, version: 1, serverSeq: 7, payload: JSON.parse(JSON.stringify(e.payload)), schemaVer: e.schemaVer, minReaderVer: e.minReaderVer,
  appVer: e.appVer, editedAt: e.editedAt, deleted: e.deleted, ...over
})

describe('sha256Hex (pure)', () => {
  it('matches known vectors and node crypto, incl. multi-block, non-ASCII and astral text', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const t of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'नमस्ते ₹ 90', 'pen \u{1F58A} ok', '\ud800 lone']) {
      expect(sha256Hex(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'))
    }
    expect(utf8Bytes('\u{1F58A}')).toEqual([...Buffer.from('\u{1F58A}', 'utf8')])
  })
})

describe('encodeRecord', () => {
  it('stamps payload v2, versions, hash; payload is plain JSON (no encryption)', () => {
    const e = enc()
    expect(e.payload).toMatchObject({ v: PAYLOAD_V, kind: 'bill', deleted: false })
    expect(e.schemaVer).toBe(SCHEMA_VER)
    expect(e.minReaderVer).toBe(1)
    expect(e.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(() => JSON.stringify(e.payload)).not.toThrow()
  })
  it('hash ignores revision / updatedAt / createdAt / totals cache but includes content and the deleted flag', () => {
    const a = enc().payloadHash
    expect(enc({ data: billData({ revision: 9, updatedAt: '2027-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' }) }).payloadHash).toBe(a)
    expect(enc({ data: billData({ billDate: '2026-10-09' }) }).payloadHash).not.toBe(a)
    expect(enc({ data: billData({ rows: [{ ...ROWS[0]!, qty: '11' }, ROWS[1]!] }) }).payloadHash).not.toBe(a)
    expect(enc({ deleted: true }).payloadHash).not.toBe(a)
  })

  it('Phase 135: the local party link is not content (two computers may hold the same customer under different ids), the name on the bill is', () => {
    const a = enc().payloadHash
    expect(enc({ data: billData({ partyId: 'party-on-this-computer' }) }).payloadHash).toBe(a)
    expect(enc({ data: billData({ party: { name: 'Another Traders', phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' } }) }).payloadHash).not.toBe(a)
  })
  it('deleted flag is part of the hash for every kind (Phase 130: the server decides noop by hash alone)', () => {
    const party = { party: { id: 'p1', name: 'Ruby', nameNorm: 'ruby', phone: null, address: null, transport: null, createdAt: 'x', updatedAt: 'x', deletedAt: null } }
    const a = encodeRecord({ kind: 'party', recId: 'p1', data: party, deleted: false, editedAt: 'x', appVer: '1' })
    const b = encodeRecord({ kind: 'party', recId: 'p1', data: party, deleted: true, editedAt: 'x', appVer: '1' })
    expect(a.payloadHash).not.toBe(b.payloadHash)
    expect(hashPayload('party', a.payload)).toBe(a.payloadHash)
  })
  it('key order does not matter; throws on invalid data, unknown kind, empty ids', () => {
    const d = billData()
    const reordered = { rows: d.rows, bill: Object.fromEntries(Object.entries(d.bill).reverse()) }
    expect(enc({ data: reordered }).payloadHash).toBe(enc().payloadHash)
    expect(() => enc({ data: { bill: {}, rows: [] } })).toThrow(/not valid/)
    expect(() => enc({ kind: 'nope' as never })).toThrow(/unknown kind/)
    expect(() => enc({ recId: '' })).toThrow(/recId/)
    expect(() => enc({ unknownJson: '{bad' })).toThrow(/valid JSON/)
  })
})

describe('decodeRecord', () => {
  it('round trip: apply returns the same data, hash and deleted flag', () => {
    const e = enc()
    const r = decodeRecord(toRaw(e))
    expect(r.outcome).toBe('apply')
    if (r.outcome !== 'apply') return
    expect(r.record).toMatchObject({ kind: 'bill', recId: 'b1', version: 1, serverSeq: 7, deleted: false, unknownJson: null, payloadHash: e.payloadHash, appVer: '0.1.0' })
    expect(r.record.data).toEqual(JSON.parse(JSON.stringify(billData())))
    expect(enc({ data: r.record.data, unknownJson: r.record.unknownJson }).payload).toEqual(e.payload)
  })
  it('a tombstone round-trips with deleted = true', () => {
    const r = decodeRecord(toRaw(enc({ deleted: true })))
    expect(r.outcome === 'apply' && r.record.deleted).toBe(true)
  })
  it('unknown optional fields (top level and nested) are preserved and re-emitted by the next push', () => {
    const e = enc()
    const payload = JSON.parse(JSON.stringify(e.payload)) as Record<string, any>
    payload.futureFlag = { a: [1, 2, 3] }
    payload.bill.futureCol = 'x'
    payload.rows[0].futureCell = 'y'
    const r = decodeRecord(toRaw(e, { payload, schemaVer: 5 }))
    expect(r.outcome).toBe('apply')
    if (r.outcome !== 'apply') return
    expect(r.record.unknownJson).toBe('{"futureFlag":{"a":[1,2,3]}}')
    const again = enc({ data: r.record.data, unknownJson: r.record.unknownJson, minReaderVer: r.record.minReaderVer })
    expect(again.payload).toMatchObject({ futureFlag: { a: [1, 2, 3] } })
    expect((again.payload.bill as any).futureCol).toBe('x')
    expect((again.payload.rows as any[])[0].futureCell).toBe('y')
    expect(again.schemaVer).toBe(SCHEMA_VER) // what wrote it now
  })
  it('an unknown-bag key can never override a known or reserved key', () => {
    const e = enc({ unknownJson: JSON.stringify({ bill: { evil: 1 }, deleted: true, kind: 'party', v: 9, keep: 1 }) })
    expect(e.payload).toMatchObject({ v: 2, kind: 'bill', deleted: false, keep: 1 })
    expect((e.payload.bill as any).evil).toBeUndefined()
  })
  it('re-pushing a record never lowers its min_reader_ver', () => {
    expect(enc({ minReaderVer: 3 }).minReaderVer).toBe(3)
  })
  it('reader older than min_reader_ver -> aside, and the payload is not even looked at', () => {
    const e = enc()
    const r = decodeRecord(toRaw(e, { minReaderVer: READER_VER + 1, payload: { v: 3, anything: 'new shape' } }))
    expect(r).toMatchObject({ outcome: 'aside', reason: 'newer_reader_required', kind: 'bill', recId: 'b1', minReaderVer: READER_VER + 1 })
    expect(decodeRecord(toRaw(e, { minReaderVer: 4 }), 4).outcome).toBe('apply')
  })
  it('a kind this app does not know is set aside, not dropped', () => {
    expect(decodeRecord({ ...toRaw(enc()), kind: 'invoice_template' })).toMatchObject({ outcome: 'aside', reason: 'unknown_kind' })
  })
  it('damage from a same-or-older writer is invalid, not aside', () => {
    const e = enc()
    expect(decodeRecord(toRaw(e, { payload: 'text' })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { payload: { ...e.payload, v: 1 } })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { payload: { ...e.payload, kind: 'party' } })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { deleted: true })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { payload: { v: 2, kind: 'bill', deleted: false } })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { schemaVer: 0 })).outcome).toBe('invalid')
    expect(decodeRecord(toRaw(e, { recId: '' })).outcome).toBe('invalid')
  })
  it('party, party_merge and item_rule records round-trip', () => {
    const cases = [
      { kind: 'party', data: { party: { id: 'p1', name: 'Ruby', nameNorm: 'ruby', phone: null, address: null, transport: null, createdAt: 'a', updatedAt: 'b', deletedAt: null, mergedInto: null } } },
      { kind: 'party_merge', data: { merge: { survivorId: 'p1', mergedId: 'p2', by: 'br1', at: '2026-10-12T00:00:00.000Z' } } },
      { kind: 'item_rule', data: { rule: { id: 'r1', kind: 'merge', keyA: 'a', keyB: 'b', canonical: null, note: null, createdAt: 'a', updatedAt: 'b', deletedAt: null, branchId: 'br1' } } }
    ] as const
    for (const c of cases) {
      const e = encodeRecord({ kind: c.kind, recId: 'x', data: c.data, deleted: false, editedAt: 'z', appVer: '1' })
      const r = decodeRecord(toRaw(e))
      expect(r.outcome === 'apply' && r.record.payloadHash).toBe(e.payloadHash)
    }
  })
})

describe('aside envelope', () => {
  it('stores the whole record and rebuilds it for a retry', () => {
    const raw = toRaw(enc(), { minReaderVer: 9, version: 4 })
    const back = rawFromAside({ kind: raw.kind, recId: raw.recId, version: 4, minReaderVer: 9, payloadJson: asideEnvelopeJson(raw) })
    expect(back).toEqual(raw)
    expect(rawFromAside({ kind: 'bill', recId: 'x', version: 1, minReaderVer: 2, payloadJson: '{oops' })).toBeNull()
  })
})
