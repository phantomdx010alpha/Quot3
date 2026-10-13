import { describe, expect, it } from 'vitest'
import { legacyBillNumber, legacyDecimal, parseLegacyDate, parseLegacyFile } from '../parse'
import { planLegacyImport, type ExistingState, type LegacyFileInput } from '../plan'
import { sha256Hex, uuidFromText } from '../sha256'
import { readCorpus } from './corpus'

const none = (over: Partial<ExistingState> = {}): ExistingState => ({ parties: [], fingerprints: new Set(), billIds: new Set(), usedPoSeqs: new Set(), nextSeq: 1, ...over })
const file = (name: string, o: Record<string, unknown>): LegacyFileInput => ({ name, text: JSON.stringify(o) })
const base = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  bill_no: 356, date: '08-10-2026', party: 'ROOPESH TAILOR', phone: '99', transport: 'VRL', gst: '', format_mode: 'manual', extra_headers: [],
  items: [{ name: 'Shirt', qty: '2', rate: '100', amt: '200' }], total: 200, ...o
})
const plan = (files: LegacyFileInput[], over: Partial<Parameters<typeof planLegacyImport>[0]> = {}) =>
  planLegacyImport({ files, poPrefix: 'Q3-', branchId: 'b1', existing: none(), ...over })

describe('sha256 / ids', () => {
  it('matches the known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
  it('handles non-ASCII and gives stable uuids', () => {
    expect(sha256Hex('₹ नमस्ते')).toHaveLength(64)
    expect(uuidFromText('x')).toBe(uuidFromText('x'))
    expect(uuidFromText('x')).not.toBe(uuidFromText('y'))
    expect(uuidFromText('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('parsing helpers', () => {
  it('bill numbers: digits after the last underscore', () => {
    expect(legacyBillNumber(356)).toEqual({ text: '356', number: 356 })
    expect(legacyBillNumber('BR1_106')?.number).toBe(106)
    expect(legacyBillNumber('BR1_BR1_BR1_228')?.number).toBe(228)
    expect(legacyBillNumber('ABC')).toBeNull()
    expect(legacyBillNumber(1.5)).toBeNull()
    expect(legacyBillNumber('')).toBeNull()
  })
  it('dates: DD-MM-YYYY with optional time, never guessed', () => {
    expect(parseLegacyDate('08-10-2026')).toEqual({ iso: '2026-10-08', time: null })
    expect(parseLegacyDate('08-10-2026 14:05:09')).toEqual({ iso: '2026-10-08', time: '14:05:09' })
    expect(parseLegacyDate('31-02-2026')).toBeNull()
    expect(parseLegacyDate('2026-10-08')).toBeNull()
    expect(parseLegacyDate('08-10-2026 25:00:00')).toBeNull()
  })
  it('decimals: text and numbers, blanks, junk, exponents', () => {
    expect(legacyDecimal(10.0)).toBe('10')
    expect(legacyDecimal('1,250.50')).toBe('1250.5')
    expect(legacyDecimal('')).toBeNull()
    expect(legacyDecimal(null)).toBeNull()
    expect(legacyDecimal('1e-7')).toBe('0.0000001')
    expect(legacyDecimal('-0.0')).toBe('0')
    expect(legacyDecimal('abc')).toBeNull()
  })
  it('refuses bad files as error rows, never throws', () => {
    for (const t of ['', '{', '[]', '{"bill_no":1}', JSON.stringify(base({ party: '  ' })), JSON.stringify(base({ date: 'x' })), JSON.stringify(base({ bill_no: 'NO' })), JSON.stringify(base({ items: 'x' }))]) {
      const r = parseLegacyFile(t)
      expect(r.ok).toBe(false)
    }
    expect(parseLegacyFile('{}', 3 * 1024 * 1024).ok).toBe(false)
  })
})

describe('conversion and totals', () => {
  it('recomputes totals, keeps only the number, prefixes the PO', () => {
    const p = plan([file('a.json', base({ bill_no: 'BR1_7', total: 999 }))])
    expect(p.report.created).toBe(1)
    const b = p.bills[0]!.bill
    expect(b.poSeq).toBe(7)
    expect(b.poNumber).toBe('Q3-0007')
    expect(b.formatId).toBe('non_gst')
    expect(b.billDate).toBe('2026-10-08')
    expect(b.roundOff).toBe(0)
    expect(b.revision).toBe(1)
    expect(p.bills[0]!.legacyRef).toBe('BR1_7')
    expect(p.bills[0]!.recomputedTotal).toBe('200.00')
    expect(p.report.totalDifferences).toHaveLength(1)
    expect(p.report.nextPoAfter).toBe('Q3-0008')
  })
  it('amt kept as an override only when it differs from qty x rate by more than 0.01', () => {
    const p = plan([file('a.json', base({ items: [
      { name: 'same', qty: '2', rate: '100', amt: '200.005' },
      { name: 'typed', qty: '2', rate: '100', amt: '250' },
      { name: 'only amt', qty: '', rate: '', amt: '75' },
      { name: 'no amt', qty: '3', rate: '10', amt: '' }
    ] }))])
    const rows = p.bills[0]!.bill.rows
    expect(rows.map((r) => r.totalOverride)).toEqual([null, '250', '75', null])
    expect(p.report.convert.amountOverrides).toBe(1)
    expect(p.report.convert.amountOnlyRows).toBe(1)
  })
  it('adjustments become override rows, negatives kept, totals include them', () => {
    const p = plan([file('a.json', base({ total: 100, items: [{ name: 'A', qty: '1', rate: '100', amt: '100' }, { kind: 'adjustment', label: 'GST', value: 18.0, extras: [] }, { kind: 'adjustment', label: 'Disc', value: -10, extras: [] }] }))])
    const rows = p.bills[0]!.bill.rows
    expect(rows[1]).toMatchObject({ qty: null, rate: null, totalOverride: '18' })
    expect(rows[2]!.totalOverride).toBe('-10')
    expect(p.bills[0]!.recomputedTotal).toBe('108.00')
    expect(p.report.convert).toMatchObject({ adjustments: 2, negativeAdjustments: 1 })
    expect(p.report.totalDifferences).toHaveLength(1) // 108 vs the stored 100
    const q = plan([file('q.json', base({ total: 100, items: [{ name: 'A', qty: '1', rate: '100', amt: '100' }, { kind: 'adjustment', label: 'GST', value: 18, extras: [] }] }))])
    expect(q.report.totalDifferences[0]!.note).toContain('left out the 18.00 adjustment')
  })
  it('GST format keeps item gst percent; non-GST ignores it', () => {
    const g = plan([file('g.json', base({ format_mode: 'gst', items: [{ name: 'A', qty: '1', rate: '100', amt: '100', gst: 18, gst_amt: 18, total: 118 }] }))])
    expect(g.bills[0]!.bill.formatId).toBe('gst')
    expect(g.bills[0]!.bill.rows[0]!.gstRate).toBe('18')
    expect(g.bills[0]!.recomputedTotal).toBe('118.00')
    const n = plan([file('n.json', base({ items: [{ name: 'A', qty: '1', rate: '100', amt: '100', gst: 18 }] }))])
    expect(n.bills[0]!.bill.rows[0]!.gstRate).toBeNull()
  })
  it('"default" format is non-GST and listed', () => {
    const p = plan([file('d.json', base({ format_mode: 'default' }))])
    expect(p.bills[0]!.bill.formatId).toBe('non_gst')
    expect(p.report.formats).toEqual({ gst: 0, nonGst: 1, defaultMode: 1 })
    expect(p.report.warnings.length).toBe(1)
  })
  it('red-bold ranges become runs, clamped; unknown tags ignored and counted; highlight kept', () => {
    const p = plan([file('a.json', base({ items: [{ name: 'Hello world', qty: '1', rate: '1', amt: '1', formats: { name: [{ start: 0, end: 5, tag: 'redbold' }, { start: 6, end: 99, tag: 'redbold' }, { start: 0, end: 1, tag: 'weird' }] }, highlights: { name: true, qty: true } }] }))])
    const row = p.bills[0]!.bill.rows[0]!
    expect(row.nameRuns).toEqual([{ t: 'Hello', b: 1, r: 1 }, { t: ' ' }, { t: 'world', b: 1, r: 1 }])
    expect(row.cellStyle).toEqual({ name: { hl: 1 } })
    expect(p.report.ignored.unknownFormatTags).toBe(1)
    expect(p.report.ignored.otherHighlights).toBe(1)
    expect(p.report.convert.redBoldRanges).toBe(2)
  })
  it('extra columns: headers, manual_N preferred over extras[N], marked, duplicate headers allowed', () => {
    const p = plan([file('a.json', base({ extra_headers: ['Pcs', 'Pcs'], items: [
      { name: 'A', qty: '1', rate: '1', amt: '1', manual_0: '7.0', extras: ['9', '831'], marked: { manual_0: true, manual_1: false } },
      { kind: 'adjustment', label: 'X', value: 5, extras: [0, 12] }
    ] }))])
    const b = p.bills[0]!.bill
    expect(b.extraCols.map((c) => c.header)).toEqual(['Pcs', 'Pcs'])
    expect(new Set(b.extraCols.map((c) => c.key)).size).toBe(2)
    const [c1, c2] = b.extraCols.map((c) => c.key) as [string, string]
    expect(b.rows[0]!.extras[c1]).toEqual({ text: '7', marked: true })
    expect(b.rows[0]!.extras[c2]).toEqual({ text: '831' })
    expect(b.rows[1]!.extras[c1]).toBeUndefined()
    expect(b.rows[1]!.extras[c2]).toEqual({ text: '12' })
  })
  it('adjustment extras with no column are counted, trailing blank rows dropped, party GSTIN kept', () => {
    const p = plan([file('a.json', base({ gst: '29ABC', items: [{ name: 'A', qty: '1', rate: '1', amt: '1' }, { kind: 'adjustment', label: 'X', value: 5, extras: [3] }, { name: '', qty: '', rate: '', amt: '' }] }))])
    expect(p.bills[0]!.bill.rows).toHaveLength(2)
    expect(p.report.ignored.adjustmentExtras).toBe(1)
    expect(p.bills[0]!.bill.party.address).toBe('GSTIN: 29ABC')
  })
  it('is deterministic: same files, same ids', () => {
    const f = [file('a.json', base())]
    expect(plan(f).bills[0]!.bill).toEqual(plan(f).bills[0]!.bill)
  })
})

describe('PO and clash rules', () => {
  const mk = (name: string, no: number | string, party: string, date: string, extra: Record<string, unknown> = {}): LegacyFileInput => file(name, base({ bill_no: no, party, date, ...extra }))
  it('same number + same party = the same bill saved twice: keep one (later date, more items), skip the rest', () => {
    const p = plan([mk('a.json', 42, 'P', '01-01-2026'), mk('b.json', 42, 'p  ', '02-01-2026')])
    expect(p.bills.map((b) => b.file)).toEqual(['b.json'])
    expect(p.report.skipped).toEqual([expect.objectContaining({ file: 'a.json', reason: 'sameBillTwice' })])
  })
  it('same number + different party: earliest keeps it, the other gets the next free number after the highest', () => {
    const p = plan([mk('a.json', 5, 'A', '03-01-2026'), mk('b.json', 5, 'B', '01-01-2026'), mk('c.json', 9, 'C', '01-01-2026')])
    const bySeq = Object.fromEntries(p.bills.map((b) => [b.file, b.bill.poSeq]))
    expect(bySeq).toEqual({ 'b.json': 5, 'c.json': 9, 'a.json': 10 })
    expect(p.report.renumbered).toEqual([expect.objectContaining({ file: 'a.json', oldNumber: 5, newPoSeq: 10, newPo: 'Q3-0010' })])
    expect(new Set(Object.values(bySeq)).size).toBe(3)
    expect(p.report.nextPoAfter).toBe('Q3-0011')
  })
  it('prefixes are stripped before comparing (106 vs BR1_106)', () => {
    const p = plan([mk('a.json', 106, 'A', '01-01-2026'), mk('b.json', 'BR1_106', 'B', '02-01-2026')])
    expect(p.report.clashGroups).toHaveLength(1)
    expect(p.report.duplicateBillNoGroups).toBe(0)
    expect(p.report.renumbered).toHaveLength(1)
  })
  it('a number already used in this database is renumbered; existing data is never touched', () => {
    const p = plan([mk('a.json', 7, 'A', '01-01-2026')], { existing: none({ usedPoSeqs: new Set([7, 20]), nextSeq: 21 }) })
    expect(p.bills[0]!.bill.poSeq).toBe(21)
    expect(p.report.nextSeqAfter).toBe(22)
  })
  it('the PO counter never goes lower', () => {
    const p = plan([mk('a.json', 3, 'A', '01-01-2026')], { existing: none({ nextSeq: 50 }) })
    expect(p.report.nextSeqAfter).toBe(50)
    expect(p.bills[0]!.bill.poSeq).toBe(3)
  })
  it('owner choices override the defaults inside clash groups only', () => {
    const files = [mk('a.json', 5, 'A', '03-01-2026'), mk('b.json', 5, 'B', '01-01-2026'), mk('c.json', 8, 'C', '01-01-2026')]
    expect(plan(files, { choices: { 'b.json': 'skip' } }).bills.map((b) => b.file).sort()).toEqual(['a.json', 'c.json'])
    expect(plan(files, { choices: { 'b.json': 'renumber' } }).bills.find((b) => b.file === 'b.json')!.bill.poSeq).toBeGreaterThan(8)
    expect(plan(files, { choices: { 'c.json': 'skip' } }).bills.map((b) => b.file)).toContain('c.json') // not in a clash: ignored
  })
  it('numbers above the pad width simply get longer', () => {
    expect(plan([mk('a.json', 123456, 'A', '01-01-2026')]).bills[0]!.bill.poNumber).toBe('Q3-123456')
  })
})

describe('parties and idempotence', () => {
  it('exact normalised match links the existing party; others are new, newest bill supplies the fields', () => {
    const files = [
      file('a.json', base({ bill_no: 1, party: 'Nandan  Tailor', phone: '111', transport: '', date: '01-01-2026' })),
      file('b.json', base({ bill_no: 2, party: 'NANDAN TAILOR', phone: '', transport: 'VRL', date: '05-01-2026' })),
      file('c.json', base({ bill_no: 3, party: 'NANDAN TAILOR - ANEKAL', date: '05-01-2026' })),
      file('d.json', base({ bill_no: 4, party: 'Known', date: '05-01-2026' }))
    ]
    const p = plan(files, { existing: none({ parties: [{ id: 'P-known', name: 'known' }] }) })
    expect(p.report.newParties).toBe(2)
    expect(p.report.existingParties).toBe(1)
    const nandan = p.newParties.find((x) => x.name === 'NANDAN TAILOR')!
    expect(nandan).toMatchObject({ phone: '111', transport: 'VRL', billCount: 2 }) // each field from the newest bill that has a value
    expect(p.bills.find((b) => b.file === 'd.json')!.bill.partyId).toBe('P-known')
    expect(p.bills.find((b) => b.file === 'c.json')!.bill.partyId).not.toBe(nandan.id)
    expect(p.bills.find((b) => b.file === 'a.json')!.bill.partyId).toBe(nandan.id)
  })
  it('a second run over the same files imports nothing (fingerprints and imported refs)', () => {
    const files = [file('a.json', base({ bill_no: 5 })), file('b.json', base({ bill_no: 5, date: '09-10-2026' })), file('c.json', base({ bill_no: 6, party: 'Z' }))]
    const first = plan(files)
    const again = plan(files, { existing: none({
      fingerprints: new Set(first.bills.map((b) => b.fingerprint)), billIds: new Set(first.bills.map((b) => b.bill.id)),
      usedPoSeqs: new Set(first.bills.map((b) => b.bill.poSeq)), nextSeq: first.report.nextSeqAfter,
      importedRefs: first.bills.map((b) => ({ party: b.bill.party.name, legacyRef: b.legacyRef }))
    }) })
    expect(again.report.created).toBe(0)
    expect(again.report.skipped).toHaveLength(3)
  })
  it('the same file twice in one batch is skipped once; one unreadable file does not stop the others', () => {
    const f = file('a.json', base())
    const p = plan([f, { ...f, name: 'copy.json' }, { name: 'bad.json', text: '{' }])
    expect(p.report.created).toBe(1)
    expect(p.report.errors).toHaveLength(1)
    expect(p.report.filesRead).toBe(2)
  })
  it('the fingerprint changes with party, date, number, total or item count and the bill id follows it', () => {
    const a = plan([file('a.json', base())]).bills[0]!
    const b = plan([file('a.json', base({ date: '09-10-2026' }))]).bills[0]!
    expect(a.fingerprint).not.toBe(b.fingerprint)
    expect(a.bill.id).not.toBe(b.bill.id)
    expect(plan([file('zzz.json', base())]).bills[0]!.bill.id).toBe(a.bill.id) // file names do not matter
  })
})

const corpus = readCorpus()
describe.skipIf(corpus === null)("the owner's corpus (private data; only counts are asserted)", () => {
  const files = corpus ?? []
  const p = planLegacyImport({ files, poPrefix: 'Q3-', branchId: 'b1', existing: none() })
  const r = p.report
  it('reads all 768 files, none unreadable', () => {
    expect(r.filesFound).toBe(768)
    expect(r.filesRead).toBe(768)
    expect(r.errors).toEqual([])
  })
  it('formats, adjustments, red-bold ranges, marked cells', () => {
    expect(r.formats).toEqual({ gst: 172, nonGst: 596, defaultMode: 4 })
    expect(r.convert.adjustments).toBe(481)
    expect(r.convert.negativeAdjustments).toBe(27)
    expect(r.convert.redBoldRanges).toBe(275)
    expect(r.convert.markedCells).toBe(12)
  })
  it('detects exactly the 19 duplicate-number groups; no two imported bills share a PO number', () => {
    expect(r.duplicateBillNoGroups).toBe(19)
    const seqs = p.bills.map((b) => b.bill.poSeq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(r.created + r.skipped.length).toBe(768)
    expect(r.nextSeqAfter).toBe(Math.max(...seqs) + 1)
  })
  it('lists about 400 totals differences', () => {
    expect(r.totalDifferences.length).toBeGreaterThan(380)
    expect(r.totalDifferences.length).toBeLessThan(420)
  })
  it('a second run creates nothing', () => {
    const again = planLegacyImport({ files, poPrefix: 'Q3-', branchId: 'b1', existing: none({
      fingerprints: new Set(p.bills.map((b) => b.fingerprint)), billIds: new Set(p.bills.map((b) => b.bill.id)),
      usedPoSeqs: new Set(p.bills.map((b) => b.bill.poSeq)), nextSeq: r.nextSeqAfter,
      importedRefs: p.bills.map((b) => ({ party: b.bill.party.name, legacyRef: b.legacyRef }))
    }) })
    expect(again.report.created).toBe(0)
  })
})
