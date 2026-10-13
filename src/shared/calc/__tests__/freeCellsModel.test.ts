import { describe, expect, it } from 'vitest'
import { row } from '../../__fixtures__/bills'
import { printFixture } from '../../__fixtures__/printBills'
import { cleanFooterExtras, cleanTailRows, deserializeBill, normalizeBill, serializeBill, billRecordSchema } from '../../billModel'
import { diffBills, describeDiff } from '../../diff/billDiff'
import { applyDocPatches, diffDocs, docsEqualPersisted, type BillDoc } from '../../history/billDoc'
import { remoteSnapshotSchema } from '../../sync/pull'
import { sameContent } from '../../sync/conflict'
import type { Bill } from '../../types'
import { computeBill } from '../billTotals'
import { getBillOptions, tailRowCountOf } from '../billOptions'
import { resolveFormat } from '../../format/registry'

const base = (): Bill => ({ ...printFixture('legacy'), rows: [row('Pen', '3', '10')] })
const withFree = (): Bill => ({
  ...base(),
  extraCols: [{ key: 'c1', header: 'Col 1', kind: 'units' }],
  footerExtras: { grandTotal: { c1: { text: '12 pcs' } }, itemsTotal: { c1: { text: '', marked: true } } },
  tailRows: [{ extras: { c1: { text: '5' } } }, { extras: {} }, { extras: { c1: { text: '' } } }]
})

describe('Phase 79 - cleaning / trim-on-save', () => {
  it('drops empty cells and unknown footer keys; trims trailing empty tail rows, keeps interior blanks', () => {
    expect(cleanFooterExtras({ grandTotal: { c1: { text: '' } }, bogus: { c1: { text: 'x' } } })).toBeUndefined()
    expect(cleanFooterExtras({ grandTotal: { c1: { text: 'a' }, c2: { text: '' } } })).toEqual({ grandTotal: { c1: { text: 'a' } } })
    const t = cleanTailRows([{ extras: { c1: { text: 'a' } } }, { extras: {} }, { extras: { c1: { text: 'b' } } }, { extras: { c1: { text: '' } } }, { extras: {} }])
    expect(t).toEqual([{ extras: { c1: { text: 'a' } } }, { extras: {} }, { extras: { c1: { text: 'b' } } }])
    expect(cleanTailRows([{ extras: {} }])).toBeUndefined()
    expect(cleanTailRows('junk')).toBeUndefined()
  })
  it('a marked empty cell is content', () => {
    expect(cleanTailRows([{ extras: { c1: { text: '', marked: true } } }])).toEqual([{ extras: { c1: { text: '', marked: true } } }])
  })
  it('normalizeBill trims, is idempotent, and leaves a bill without the fields untouched', () => {
    const n = normalizeBill(withFree())
    expect(n.tailRows).toHaveLength(1)
    expect(normalizeBill(n)).toEqual(n)
    const plain = normalizeBill(base())
    expect('footerExtras' in plain).toBe(false)
    expect('tailRows' in plain).toBe(false)
  })
})

describe('Phase 79 - persistence round trip', () => {
  it('serialize writes both JSON columns; deserialize returns the same content', () => {
    const s = serializeBill(withFree())
    expect(JSON.parse(s.bill.footerExtrasJson as string)).toEqual({ itemsTotal: { c1: { text: '', marked: true } }, grandTotal: { c1: { text: '12 pcs' } } })
    expect(JSON.parse(s.bill.tailRowsJson as string)).toEqual([{ extras: { c1: { text: '5' } } }])
    const back = deserializeBill(s.bill, s.rows)
    expect(back.ok).toBe(true)
    if (back.ok) {
      expect(back.data.footerExtras).toEqual(normalizeBill(withFree()).footerExtras)
      expect(back.data.tailRows).toEqual([{ extras: { c1: { text: '5' } } }])
    }
  })
  it('a bill with none stores {} and []', () => {
    const s = serializeBill(base())
    expect(s.bill.footerExtrasJson).toBe('{}')
    expect(s.bill.tailRowsJson).toBe('[]')
    const back = deserializeBill(s.bill, s.rows)
    expect(back.ok && 'tailRows' in back.data).toBe(false)
  })
  it('an older record without the fields reads as none; malformed JSON is refused, not thrown', () => {
    const { bill, rows } = serializeBill(base())
    const { footerExtrasJson: _a, tailRowsJson: _b, ...old } = bill
    const r = deserializeBill(old, rows)
    expect(r.ok).toBe(true)
    expect(deserializeBill({ ...bill, tailRowsJson: '{nope' }, rows).ok).toBe(false)
    expect(deserializeBill({ ...bill, footerExtrasJson: '[]' }, rows).ok).toBe(false)
  })
  it('sync: a snapshot with the fields parses; an old branch (schema without them) would strip them, and a new one reads old snapshots', () => {
    const { bill, rows } = serializeBill(withFree())
    const { syncState: _s, ...rec } = bill
    const ok = remoteSnapshotSchema.safeParse({ v: 1, bill: rec, rows, deleted: false })
    expect(ok.success).toBe(true)
    // old branch simulation: the same schema minus the two keys strips them silently (zod objects are not strict)
    const oldSchema = billRecordSchema.omit({ footerExtrasJson: true, tailRowsJson: true, syncState: true })
    const stripped = oldSchema.parse(rec)
    expect('tailRowsJson' in stripped).toBe(false)
    const { footerExtrasJson: _f, tailRowsJson: _t, ...old } = rec
    expect(remoteSnapshotSchema.safeParse({ v: 1, bill: old, rows, deleted: false }).success).toBe(true)
  })
})

describe('Phase 79 - paper row count (tailRowCount)', () => {
  const f = resolveFormat('non_gst')
  it('counts up to the last non-empty tail row; amounts never change', () => {
    expect(tailRowCountOf(normalizeBill(withFree()).tailRows)).toBe(1)
    expect(tailRowCountOf([{ extras: {} }, { extras: { c1: { text: 'a' } } }, { extras: {} }])).toBe(2)
    expect(tailRowCountOf(undefined)).toBe(0)
    expect(tailRowCountOf('x')).toBe(0)
    const b = withFree()
    const a = computeBill(f, b.rows, getBillOptions({ roundOff: 0 }))
    const c = computeBill(f, b.rows, getBillOptions(b))
    expect(c.counts.paperRows).toBe(a.counts.paperRows + 1)
    expect(c.grandTotal).toBe(a.grandTotal)
    expect(c.counts.itemRows).toBe(a.counts.itemRows)
  })
  it('getBillOptions combines round-off and tail rows; a bad count is ignored', () => {
    expect(getBillOptions({ roundOff: 1, tailRows: [{ extras: { c1: { text: 'a' } } }] })).toEqual({ roundGrand: true, tailRowCount: 1 })
    expect(getBillOptions({})).toEqual({})
    expect(computeBill(f, [], { tailRowCount: -2 }).counts.paperRows).toBe(0)
    expect(computeBill(f, [], { tailRowCount: 1.5 }).counts.paperRows).toBe(0)
  })
})

describe('Phase 79 - sameContent / diffBills', () => {
  const rec = (b: Bill) => { const s = serializeBill(b); return { bill: s.bill, rows: s.rows } }
  it('sameContent sees footer cells and tail rows; absent equals empty', () => {
    expect(sameContent(rec(base()), rec(base()))).toBe(true)
    const old = rec(base())
    const { footerExtrasJson: _a, tailRowsJson: _b, ...oldBill } = old.bill
    expect(sameContent({ bill: oldBill, rows: old.rows }, rec(base()))).toBe(true)
    expect(sameContent(rec(base()), rec(withFree()))).toBe(false)
    const t = withFree()
    const t2 = { ...t, tailRows: [{ extras: { c1: { text: '6' } } }] }
    expect(sameContent(rec(t), rec(t2))).toBe(false)
  })
  it('diffBills reports the change and ignores trailing blank tail rows / empty cells', () => {
    const d = diffBills(base(), withFree())
    expect(d.identical).toBe(false)
    expect(d.bill.map((c) => c.field)).toEqual(expect.arrayContaining(['footerExtras', 'tailRows']))
    expect(describeDiff(d)).toContain('total-row cells')
    const b0 = base()
    const noise: Bill = { ...b0, footerExtras: { grandTotal: { c1: { text: '' } } }, tailRows: [{ extras: {} }] }
    expect(diffBills(b0, noise).identical).toBe(true)
  })
})

describe('Phase 79 - undo / dirty (BillDoc)', () => {
  const doc = (b: Bill): BillDoc => ({ formatId: b.formatId, extraCols: b.extraCols, rows: b.rows, party: b.party, billDate: b.billDate, ...(b.footerExtras ? { footerExtras: b.footerExtras } : {}), ...(b.tailRows ? { tailRows: b.tailRows } : {}) })
  it('patches go forward and back for footer cells and tail rows', () => {
    const a = doc(base())
    const b = doc(withFree())
    const { patches, inverse } = diffDocs(a, b)
    expect(patches.length).toBeGreaterThan(0)
    const fwd = applyDocPatches(a, patches)
    expect(fwd.tailRows).toEqual(b.tailRows)
    expect(fwd.footerExtras).toEqual(b.footerExtras)
    const back = applyDocPatches(fwd, inverse)
    expect(back.tailRows).toBeUndefined()
    expect(back.footerExtras).toBeUndefined()
    expect(diffDocs(a, a).patches).toHaveLength(0)
  })
  it('dirty tracking compares as stored: blank tail rows / empty cells are not a change, real edits are', () => {
    const a = doc(base())
    expect(docsEqualPersisted(a, { ...a, tailRows: [{ extras: {} }], footerExtras: { grandTotal: { c1: { text: '' } } } })).toBe(true)
    expect(docsEqualPersisted(a, doc(withFree()))).toBe(false)
  })
})
