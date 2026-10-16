import { describe, expect, it } from 'vitest'
import { classify, sharedLinesRatio, SHARED_LINES_THRESHOLD, type Candidate, type Incoming } from '../classify'
import { contentFingerprintOf, contentFingerprint, contentOfLegacy, normalizeItemName, type ContentInput } from '../fingerprint'
import { orderOldestFirst } from '../order'
import { emptyIgnored, type LegacyBill, type LegacyItem } from '../../legacyImport/parse'

// SYNTHETIC data only (the real legacy folder is private).
const item = (name: string, qty: string | null, rate: string | null, amt: string | null = null): LegacyItem =>
  ({ kind: 'item', name, qty, rate, amt, gst: null, ranges: [], highlightName: false, extras: [] })
const adj = (amt: string): LegacyItem => ({ kind: 'adjustment', name: 'Discount', qty: null, rate: null, amt, gst: null, ranges: [], highlightName: false, extras: [] })
const legacy = (over: Partial<LegacyBill> = {}): LegacyBill => ({
  billNoText: 'BR1_100', legacyNumber: 100, isoDate: '2026-09-01', time: null, party: 'Acme Traders', phone: '', transport: '', gstin: '',
  formatMode: 'manual', extraHeaders: [], storedTotal: null, ignored: emptyIgnored(), warnings: [],
  items: [item('Tomato', '10', '20'), item('Onion', '5', '30'), item('Potato', '2', '15')], ...over
})
const inc = (lb: LegacyBill, mtimeMs = 2000, file = 'f.json'): Incoming => ({ file, content: contentOfLegacy(lb), mtimeMs })
const cand = (lb: LegacyBill, billId = 'b1', over: Partial<Candidate> = {}): Candidate =>
  ({ billId, content: contentOfLegacy(lb), sourceMtimeMs: 1000, locallyEdited: false, ...over })

describe('contentFingerprint', () => {
  it('ignores the PO / bill number, phone, transport and item order', () => {
    const a = legacy()
    const b = legacy({ billNoText: 'BR1_101', legacyNumber: 101, phone: '999', transport: 'Lorry', items: [...a.items].reverse() })
    expect(contentFingerprint(a)).toBe(contentFingerprint(b))
  })
  it('normalises names, numbers and party spelling', () => {
    const a = legacy()
    const b = legacy({ party: '  acme   TRADERS ', items: [item('  tomato ', '10.0', '20.00'), item('ONION', '5', '30'), item('potato', '2.00', '15')] })
    expect(contentFingerprint(a)).toBe(contentFingerprint(b))
    expect(normalizeItemName('  Red   Tomato ')).toBe('red tomato')
  })
  it('changes with item added / removed / renamed, qty, rate, date, party and adjustments', () => {
    const base = contentFingerprint(legacy())
    const items = legacy().items
    const variants: LegacyBill[] = [
      legacy({ items: [...items, item('Garlic', '1', '100')] }),
      legacy({ items: items.slice(0, 2) }),
      legacy({ items: [item('Tomatoes', '10', '20'), items[1]!, items[2]!] }),
      legacy({ items: [item('Tomato', '11', '20'), items[1]!, items[2]!] }),
      legacy({ items: [item('Tomato', '10', '21'), items[1]!, items[2]!] }),
      legacy({ isoDate: '2026-09-02' }),
      legacy({ party: 'Other Co' }),
      legacy({ items: [...items, adj('-50')] })
    ]
    const seen = new Set([base])
    for (const v of variants) { const f = contentFingerprint(v); expect(seen.has(f)).toBe(false); seen.add(f) }
  })
  it('adjustment order does not matter and blank rows are ignored', () => {
    const items = legacy().items
    const a = legacy({ items: [...items, adj('-50'), adj('10')] })
    const b = legacy({ items: [...items, item('', null, null), adj('10'), adj('-50')] })
    expect(contentFingerprint(a)).toBe(contentFingerprint(b))
  })
  it('an amount-only row keeps its typed amount in the fingerprint', () => {
    const a = legacy({ items: [item('Misc', null, null, '100')] })
    const b = legacy({ items: [item('Misc', null, null, '200')] })
    expect(contentFingerprint(a)).not.toBe(contentFingerprint(b))
  })
})

describe('classify', () => {
  it('new: no candidate, or other party / other date', () => {
    expect(classify(inc(legacy()), []).kind).toBe('new')
    expect(classify(inc(legacy()), [cand(legacy({ party: 'Other' }))]).kind).toBe('new')
    expect(classify(inc(legacy()), [cand(legacy({ isoDate: '2026-09-02' }))]).kind).toBe('new')
  })
  it('exact duplicate with a different PO number', () => {
    const r = classify(inc(legacy({ billNoText: 'BR1_101', legacyNumber: 101 })), [cand(legacy())])
    expect(r).toMatchObject({ kind: 'duplicate', candidates: ['b1'] })
  })
  it('duplicate wins even when the file is newer or the bill was edited locally', () => {
    expect(classify(inc(legacy(), 9999), [cand(legacy(), 'b1', { locallyEdited: true })]).kind).toBe('duplicate')
  })
  const edits: Array<[string, () => LegacyBill]> = [
    ['item added', () => legacy({ items: [...legacy().items, item('Garlic', '1', '100')] })],
    ['item removed', () => legacy({ items: legacy().items.slice(0, 2) })],
    ['item renamed', () => legacy({ items: [item('Tomatoes', '10', '20'), ...legacy().items.slice(1)] })],
    ['qty changed', () => legacy({ items: [item('Tomato', '12', '20'), ...legacy().items.slice(1)] })],
    ['rate changed', () => legacy({ items: [item('Tomato', '10', '25'), ...legacy().items.slice(1)] })],
    ['adjustments only', () => legacy({ items: [...legacy().items, adj('-40')] })]
  ]
  for (const [label, make] of edits) {
    it(`edited: ${label} (newer file)`, () => {
      expect(classify(inc(make(), 2000), [cand(legacy())])).toMatchObject({ kind: 'edited', candidates: ['b1'] })
    })
  }
  it('phone / transport-only change has the same content, so it is an exact duplicate [A]', () => {
    expect(classify(inc(legacy({ phone: '98765', transport: 'Lorry' })), [cand(legacy())]).kind).toBe('duplicate')
  })
  it('older copy: incoming mtime older or equal is ignored', () => {
    const edited = legacy({ items: [...legacy().items, adj('-40')] })
    expect(classify(inc(edited, 500), [cand(legacy())]).kind).toBe('older')
    expect(classify(inc(edited, 1000), [cand(legacy())]).kind).toBe('older')
  })
  it('unknown stored mtime counts as older than any file', () => {
    const edited = legacy({ items: [...legacy().items, adj('-40')] })
    expect(classify(inc(edited, 1), [cand(legacy(), 'b1', { sourceMtimeMs: null })]).kind).toBe('edited')
  })
  it('newer copy of a bill edited inside Quot3 goes to review', () => {
    const edited = legacy({ items: [...legacy().items, adj('-40')] })
    expect(classify(inc(edited), [cand(legacy(), 'b1', { locallyEdited: true })])).toMatchObject({ kind: 'review', why: 'locally_edited', candidates: ['b1'] })
  })
  it('same party + day but a different bill (under 50% shared) goes to review', () => {
    const other = legacy({ items: [item('Mango', '3', '80'), item('Banana', '4', '40'), item('Potato', '1', '15')] })
    expect(classify(inc(other), [cand(legacy())])).toMatchObject({ kind: 'review', why: 'few_shared_lines', candidates: ['b1'] })
  })
  it('the 50% threshold is a named constant and is inclusive', () => {
    expect(SHARED_LINES_THRESHOLD).toBe(0.5)
    const half = legacy({ items: [item('Tomato', '1', '1'), item('Onion', '1', '1'), item('Mango', '1', '1'), item('Banana', '1', '1')] })
    const base = legacy({ items: [item('Tomato', '2', '2'), item('Onion', '2', '2'), item('Kiwi', '2', '2'), item('Plum', '2', '2')] })
    expect(sharedLinesRatio(contentOfLegacy(half), contentOfLegacy(base))).toBe(0.5)
    expect(classify(inc(half), [cand(base)]).kind).toBe('edited')
    expect(classify(inc(half), [cand(base)], { threshold: 0.75 }).kind).toBe('review')
  })
  it('two candidate bills both matching goes to review, independent of candidate order', () => {
    const c1 = cand(legacy({ items: [...legacy().items, item('A', '1', '1')] }), 'b1')
    const c2 = cand(legacy({ items: [...legacy().items, item('B', '1', '1')] }), 'b2')
    const edited = inc(legacy({ items: [...legacy().items, item('C', '1', '1')] }))
    const r1 = classify(edited, [c1, c2]), r2 = classify(edited, [c2, c1])
    expect(r1).toMatchObject({ kind: 'review', why: 'two_candidates', candidates: ['b1', 'b2'] })
    expect(r2).toEqual(r1)
  })
  it('an unrelated bill of the same party and day does not block an edit match', () => {
    const different = cand(legacy({ items: [item('Mango', '3', '80')] }), 'b2')
    const edited = legacy({ items: [...legacy().items, adj('-40')] })
    expect(classify(inc(edited), [different, cand(legacy())])).toMatchObject({ kind: 'edited', candidates: ['b1'] })
  })
  it('bills with no named lines never match by lines', () => {
    const empty = legacy({ items: [adj('-5')] })
    const other = legacy({ items: [adj('-9')] })
    expect(classify(inc(other), [cand(empty)]).kind).toBe('review')
  })
  it('fingerprint helper agrees between neutral content and legacy bill', () => {
    const c: ContentInput = contentOfLegacy(legacy())
    expect(contentFingerprintOf(c)).toBe(contentFingerprint(legacy()))
  })
})

describe('orderOldestFirst', () => {
  const files = [{ name: 'c.json', mtimeMs: 30 }, { name: 'b.json', mtimeMs: 10 }, { name: 'a.json', mtimeMs: 30 }, { name: 'd.json', mtimeMs: 20 }]
  it('oldest mtime first, ties by name', () => {
    expect(orderOldestFirst(files, (f) => f).map((f) => f.name)).toEqual(['b.json', 'd.json', 'a.json', 'c.json'])
  })
  it('does not depend on the input order and does not mutate it', () => {
    const copy = [...files]
    const a = orderOldestFirst(files, (f) => f).map((f) => f.name)
    const b = orderOldestFirst([...files].reverse(), (f) => f).map((f) => f.name)
    expect(b).toEqual(a)
    expect(files).toEqual(copy)
  })
})

describe('contentOfBill (Phase 159)', () => {
  it('turns a stored bill into content that fingerprints like the legacy file it came from (no adjustments)', async () => {
    const { convertLegacyBill } = await import('../../legacyImport/convert')
    const { contentOfBill } = await import('../billContent')
    const lb = legacy()
    const bill = convertLegacyBill(lb, 'b1', 'br', '2026-10-01T00:00:00.000Z').bill
    expect(contentFingerprintOf(contentOfBill(bill))).toBe(contentFingerprint(lb))
  })
  it('skips blank rows', async () => {
    const { convertLegacyBill } = await import('../../legacyImport/convert')
    const { contentOfBill } = await import('../billContent')
    const bill = convertLegacyBill(legacy(), 'b1', 'br', '2026-10-01T00:00:00.000Z').bill
    bill.rows.push({ ...bill.rows[0]!, id: 'blank', nameRuns: [], qty: null, rate: null, totalOverride: null })
    expect(contentOfBill(bill).lines).toHaveLength(3)
  })
})
