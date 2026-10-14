import { describe, expect, it } from 'vitest'
import { createEmptyBill, createEmptyRow, deserializeBill, normalizeBill, normalizeExtraCols, serializeBill, withFormat } from '../billModel'
import { computeBill } from '../calc/billTotals'
import { getFormat } from '../format/registry'
import { legacyBill } from '../__fixtures__/bills'
import type { Bill } from '../types'

let n = 0
const newId = () => `id-${++n}`
const base = () => createEmptyBill({ branchId: 'br1', billDate: '2026-10-08', now: '2026-10-08T05:00:00.000Z', newId })

function richBill(): Bill {
  const b = base()
  b.poSeq = 7; b.poNumber = 'Q3-0007'; b.partyId = 'p1'
  b.party = { name: 'Ramesh Traders', phone: '98450', address: 'MG Road\nBengaluru', transport: 'VRL' }
  b.extraCols = [{ key: 'c1', header: 'ruby', kind: 'units' }]
  b.paperOverride = 'A4'
  b.rows = legacyBill().map((r, i) => ({ ...r, idx: i }))
  b.rows[0]!.nameRuns = [{ t: 'ruby ', b: 1 }, { t: 'gold', r: 1, hl: 1 }]
  b.rows[0]!.extras = { c1: { text: '(125-5)' } }
  b.rows[1]!.extras = { c1: { text: 'idk', marked: true } }
  b.rows[2]!.totalOverride = '3300'
  b.rows[3]!.gstRate = '18'
  b.rows[4]!.cellStyle = { name: { hl: 1 } }
  return b
}

describe('createEmptyBill', () => {
  it('defaults: default format, 1 blank row, unallocated PO, local_only, rev 1', () => {
    const b = base()
    expect(b).toMatchObject({ formatId: 'non_gst', poSeq: 0, poNumber: '', revision: 1, syncState: 'local_only', deletedAt: null, partyId: null, paperOverride: null, extraCols: [], billDate: '2026-10-08' })
    expect(b.rows).toHaveLength(1)
    expect(b.rows[0]).toMatchObject({ idx: 0, nameRuns: [], qty: null, rate: null, totalOverride: null, gstRate: null, extras: {} })
  })
  it('honours rowCount and a known formatId; unknown formatId falls back', () => {
    expect(createEmptyBill({ branchId: 'b', rowCount: 3, formatId: 'gst', newId }).rows).toHaveLength(3)
    expect(createEmptyBill({ branchId: 'b', formatId: 'gst', newId }).formatId).toBe('gst')
    expect(createEmptyBill({ branchId: 'b', formatId: 'zzz', newId }).formatId).toBe('non_gst')
  })
  it('works with the real crypto.randomUUID default', () => {
    const b = createEmptyBill({ branchId: 'b' })
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(b.rows[0]!.id).not.toBe(b.id)
  })
})

describe('normalizeBill', () => {
  it('is idempotent and keeps data', () => {
    const b = richBill()
    const once = normalizeBill(b, newId)
    expect(normalizeBill(once, newId)).toEqual(once)
    expect(once.rows.map((r) => r.nameRuns)).toEqual(b.rows.map((r) => r.nameRuns))
  })
  it('reindexes, de-duplicates ids, cleans decimals and runs', () => {
    const b = base()
    const r0 = createEmptyRow(5, () => 'dup'); const r1 = createEmptyRow(9, () => 'dup')
    r0.qty = ' 12 '; r0.rate = '12.'; r0.totalOverride = ''; r0.gstRate = 'abc'
    r0.nameRuns = [{ t: '' }, { t: 'x', b: 1 }]
    b.rows = [r0, r1]
    const out = normalizeBill(b, (() => { let i = 0; return () => `fresh-${++i}` })())
    expect(out.rows.map((r) => r.idx)).toEqual([0, 1])
    expect(new Set(out.rows.map((r) => r.id)).size).toBe(2)
    expect(out.rows[0]).toMatchObject({ id: 'dup', qty: '12', rate: '12', totalOverride: null, gstRate: null, nameRuns: [{ t: 'x', b: 1 }] })
  })
  it('unknown formatId → default; bad paperOverride → null; extra cols de-duped with default headers', () => {
    const b = { ...base(), formatId: 'gone', paperOverride: 'A3' as never }
    b.extraCols = [{ key: 'a', header: '  ', kind: 'units' }, { key: 'a', header: 'dup', kind: 'units' }, { key: 'b', header: 'Real', kind: 'units' }]
    const out = normalizeBill(b, newId)
    expect(out.formatId).toBe('non_gst')
    expect(out.paperOverride).toBeNull()
    expect(out.extraCols).toEqual([{ key: 'a', header: 'Col 1', kind: 'units' }, { key: 'b', header: 'Real', kind: 'units' }])
    expect(normalizeExtraCols(undefined)).toEqual([])
  })
  it('keeps extras for keys not in extraCols (a removed column can come back)', () => {
    const b = richBill(); b.extraCols = []
    expect(normalizeBill(b, newId).rows[0]!.extras).toEqual({ c1: { text: '(125-5)' } })
  })
})

describe('serialize / deserialize', () => {
  it('round-trips a rich bill exactly', () => {
    const b = normalizeBill(richBill(), newId)
    const s = serializeBill(b)
    const back = deserializeBill(JSON.parse(JSON.stringify(s.bill)), JSON.parse(JSON.stringify(s.rows)))
    expect(back).toEqual({ ok: true, data: b })
  })
  it('round-trips an empty bill, and GST format bills', () => {
    for (const b of [base(), { ...richBill(), formatId: 'gst' }]) {
      const nb = normalizeBill(b, newId)
      const s = serializeBill(nb)
      expect(deserializeBill(s.bill, s.rows)).toEqual({ ok: true, data: nb })
    }
  })
  it('row records carry plain name, JSON columns and null for absent cell style', () => {
    const s = serializeBill(richBill())
    expect(s.rows[0]).toMatchObject({ namePlain: 'ruby gold', billId: s.bill.id, idx: 0 })
    expect(JSON.parse(s.rows[0]!.nameRunsJson)).toEqual([{ t: 'ruby ', b: 1 }, { t: 'gold', r: 1, hl: 1 }])
    expect(s.rows[0]!.cellStyleJson).toBeNull()
    expect(JSON.parse(s.rows[4]!.cellStyleJson!)).toEqual({ name: { hl: 1 } })
  })
  it('totals cache and item count are recomputed from the calc engine', () => {
    const b = richBill()
    const s = serializeBill(b)
    const t = computeBill(getFormat(b.formatId), normalizeBill(b, newId).rows)
    expect(JSON.parse(s.bill.totalsJson)).toEqual({ itemsSubtotal: t.itemsTotal, adjustmentsTotal: t.adjustmentsTotal, grandTotal: t.grandTotal, gstTotal: t.itemsGst })
    expect(s.bill.itemRowCount).toBe(t.counts.itemRows)
    expect(s.bill.itemRowCount).toBeGreaterThan(0)
  })
  it('rows come back ordered by idx even if the DB returns them shuffled', () => {
    const s = serializeBill(richBill())
    const back = deserializeBill(s.bill, [...s.rows].reverse())
    expect(back.ok && back.data.rows.map((r) => r.idx)).toEqual(s.rows.map((r) => r.idx))
  })
  it('rejects malformed input without throwing', () => {
    const s = serializeBill(richBill())
    const bad = (rec: unknown, rows: unknown[] = s.rows) => deserializeBill(rec, rows)
    expect(bad({ ...s.bill, partySnapshotJson: '{nope' }).ok).toBe(false)
    expect(bad({ ...s.bill, extraColsJson: '[{"key":"a"}]' }).ok).toBe(false)
    expect(bad({ ...s.bill, revision: 0 }).ok).toBe(false)
    expect(bad({ ...s.bill, billDate: '08-10-26' }).ok).toBe(false)
    expect(bad({ ...s.bill, syncState: 'weird' }).ok).toBe(false)
    expect(bad(null).ok).toBe(false)
    expect(bad(s.bill, [{ ...s.rows[0], qty: 'x'.repeat(201) }]).ok).toBe(false) // Phase 149: a qty is free text up to 200 chars (was '1e3')
    expect(bad(s.bill, [{ ...s.rows[0], nameRunsJson: '[{"t":1}]' }]).ok).toBe(false)
    expect(bad(s.bill, [{ ...s.rows[0], extrasJson: '"x"' }]).ok).toBe(false)
    expect(bad(s.bill, [{ ...s.rows[0], billId: 'other' }]).ok).toBe(false)
  })
  it('an unknown stored format id survives deserialisation unchanged', () => {
    const s = serializeBill(base())
    const r = deserializeBill({ ...s.bill, formatId: 'future_fmt' }, s.rows)
    expect(r.ok && r.data.formatId).toBe('future_fmt')
  })
})

describe('switching formats never touches row data', () => {
  it('rows are the same array and byte-identical across GST ⇄ non-GST ⇄ GST', () => {
    const b = richBill()
    const before = JSON.stringify(b.rows)
    const g = withFormat(b, 'gst')
    const n2 = withFormat(g, 'non_gst')
    const g2 = withFormat(n2, 'gst')
    expect(g.formatId).toBe('gst')
    expect(g.rows).toBe(b.rows)
    expect(JSON.stringify(g2.rows)).toBe(before)
    expect(JSON.stringify(serializeBill(g2).rows)).toBe(JSON.stringify(serializeBill(b).rows))
  })
  it('unknown / same format id returns the bill unchanged', () => {
    const b = richBill()
    expect(withFormat(b, 'nope')).toBe(b)
    expect(withFormat(b, b.formatId)).toBe(b)
  })
  it('non-GST total equals GST items total for the same rows (nothing lost)', () => {
    const b = richBill()
    const a = computeBill(getFormat('non_gst'), b.rows)
    const g = computeBill(getFormat('gst'), b.rows)
    expect(g.itemsTotal).toBe(a.itemsTotal)
  })
})
