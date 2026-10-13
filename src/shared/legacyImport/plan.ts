/**
 * Phase 84 - the pure import planner (LEGACY_IMPORT_SPEC sections 3-6): parse every file, recompute totals with the normal
 * engine, apply the PO / clash rules, group parties, fingerprint, and build the differences report. No DB, no files, no UI:
 * the caller (Phase 85) supplies the file texts and what already exists, and writes the returned plan.
 */
import type { Bill } from '../types'
import { D, toMoney } from '../money'
import { serializeBill } from '../billModel'
import { formatPoNumber } from '../po'
import { normalizePartyName } from '../party/partyLite'
import { convertLegacyBill, type ConvertCounts } from './convert'
import { MAX_FILES, emptyIgnored, legacyBillNumber, parseLegacyFile, type IgnoredCounts, type LegacyBill } from './parse'
import { sha256Hex, uuidFromText } from './sha256'

export interface LegacyFileInput { name: string; text: string; bytes?: number }
export type ClashChoice = 'import' | 'skip' | 'renumber'

export interface ExistingState {
  /** Live parties already in this database. */
  parties: ReadonlyArray<{ id: string; name: string }>
  /** `import_fingerprint` values already present (including bills in Recently deleted). */
  fingerprints: ReadonlySet<string>
  /** Bill ids already present (bills received by sync included). */
  billIds: ReadonlySet<string>
  /** `po_seq` values already used by this branch. */
  usedPoSeqs: ReadonlySet<number>
  /** The branch's PO counter (the next sequence to hand out). */
  nextSeq: number
  /**
   * Bills imported earlier (party snapshot name + `legacy_ref` text). A file with the same party and legacy number is the same bill,
   * even when it was a skipped "saved twice" copy that never got its own fingerprint row - this is what makes a re-run import nothing.
   */
  importedRefs?: ReadonlyArray<{ party: string; legacyRef: string }>
}

export interface PlanInput {
  files: readonly LegacyFileInput[]
  poPrefix: string
  branchId: string
  existing: ExistingState
  /** Per file name; only meaningful for files in a clash group. Default rules apply to files without a choice. */
  choices?: Readonly<Record<string, ClashChoice>>
  now?: string
}

export type SkipReason = 'sameBillTwice' | 'alreadyImported' | 'duplicateFingerprint' | 'chosen'
export interface SkippedFile { file: string; reason: SkipReason; detail: string }
export interface ErrorFile { file: string; error: string }
export interface RenumberedFile { file: string; legacyRef: string; oldNumber: number; newPoSeq: number; newPo: string; reason: string }
export interface TotalDifference { file: string; legacy: string; recomputed: string; note: string }

export interface PlannedBill {
  file: string
  bill: Bill
  legacyRef: string
  fingerprint: string
  legacyNumber: number
  recomputedTotal: string
}
export interface PlannedParty { id: string; name: string; phone: string; address: string; transport: string; billCount: number }
export interface ClashGroup { number: number; files: Array<{ file: string; party: string; date: string; defaultAction: 'keep' | 'skip' | 'renumber'; reason: string }> }

export interface ImportReport {
  filesFound: number
  filesRead: number
  errors: ErrorFile[]
  created: number
  skipped: SkippedFile[]
  renumbered: RenumberedFile[]
  clashGroups: ClashGroup[]
  /** Raw `bill_no` texts used by more than one readable file (the spec's "19 groups"); clashGroups is after stripping prefixes. */
  duplicateBillNoGroups: number
  poFirst: number | null
  poLast: number | null
  /** The branch PO counter after the import: max(current, highest assigned + 1). */
  nextSeqAfter: number
  nextPoAfter: string
  newParties: number
  existingParties: number
  totalDifferences: TotalDifference[]
  formats: { gst: number; nonGst: number; defaultMode: number }
  convert: ConvertCounts
  ignored: IgnoredCounts
  warnings: string[]
}

export interface ImportPlan { bills: PlannedBill[]; newParties: PlannedParty[]; report: ImportReport }

interface Entry {
  file: string
  lb: LegacyBill
  bill: Bill
  fingerprint: string
  total: string
  itemCount: number
  adjustmentValues: string[]
  party: string
  stamp: string
  action: 'keep' | 'skip' | 'renumber'
  reason: string
  skipReason?: SkipReason
}

const partyKey = (n: string): string => normalizePartyName(n)
const byDateThenName = (a: Entry, b: Entry): number => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
/** "Later date, more items, larger total, then file name" - the keeper of a same-bill-saved-twice group. */
function better(a: Entry, b: Entry): number {
  if (a.stamp !== b.stamp) return a.stamp > b.stamp ? -1 : 1
  if (a.itemCount !== b.itemCount) return a.itemCount > b.itemCount ? -1 : 1
  const ta = D(a.total), tb = D(b.total)
  if (!ta.equals(tb)) return ta.greaterThan(tb) ? -1 : 1
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
}

export function fingerprintOf(party: string, isoDate: string, billNoText: string, grandTotal: string, itemCount: number): string {
  return sha256Hex(`${partyKey(party)}|${isoDate}|${billNoText}|${grandTotal}|${itemCount}`)
}

export function planLegacyImport(input: PlanInput): ImportPlan {
  const now = input.now ?? new Date().toISOString()
  const warnings: string[] = []
  const errors: ErrorFile[] = []
  const skipped: SkippedFile[] = []
  const ignored = emptyIgnored()
  const convertTotals: ConvertCounts = { amountOnlyRows: 0, amountOverrides: 0, redBoldRanges: 0, markedCells: 0, adjustments: 0, negativeAdjustments: 0 }
  const formats = { gst: 0, nonGst: 0, defaultMode: 0 }
  const formatCount: Record<string, number> = {}
  const files = input.files
  if (files.length > MAX_FILES) {
    return emptyPlan(files.length, [{ file: '', error: `More than ${MAX_FILES} files; pick a smaller folder.` }], input)
  }

  // 1. parse + convert + recompute
  const entries: Entry[] = []
  let filesRead = 0
  for (const f of files) {
    const p = parseLegacyFile(f.text, f.bytes ?? f.text.length)
    if (!p.ok) { errors.push({ file: f.name, error: p.error }); continue }
    filesRead++
    const lb = p.bill
    const probe = convertLegacyBill({ ...lb, ignored: { ...lb.ignored } }, 'probe', input.branchId, now) // a copy: the probe must not double-count
    // The totals come from the one engine through serializeBill (its totals cache): never recomputed here (Phase 77 guard).
    const total = (JSON.parse(serializeBill(probe.bill).bill.totalsJson) as { grandTotal: string }).grandTotal
    const fingerprint = fingerprintOf(lb.party, lb.isoDate, lb.billNoText, total, lb.items.length)
    const id = uuidFromText(`legacy-bill|${fingerprint}`)
    const conv = convertLegacyBill(lb, id, input.branchId, now)
    for (const k of Object.keys(convertTotals) as Array<keyof ConvertCounts>) convertTotals[k] += conv.counts[k]
    for (const k of Object.keys(ignored) as Array<keyof IgnoredCounts>) ignored[k] += lb.ignored[k]
    for (const w of lb.warnings) warnings.push(`${f.name}: ${w}`)
    formatCount[conv.formatId] = (formatCount[conv.formatId] ?? 0) + 1
    if (lb.formatMode === 'default') formats.defaultMode++
    entries.push({
      file: f.name, lb, bill: conv.bill, fingerprint, total, itemCount: lb.items.length, adjustmentValues: conv.adjustmentValues,
      party: lb.party, stamp: `${lb.isoDate}T${lb.time ?? '12:00:00'}`, action: 'keep', reason: ''
    })
  }

  formats.gst = formatCount['gst'] ?? 0
  formats.nonGst = formatCount['non_gst'] ?? 0

  // 2. already here / duplicate fingerprints inside the batch
  const importedKeys = new Set<string>()
  for (const r of input.existing.importedRefs ?? []) { const n = legacyBillNumber(r.legacyRef); if (n) importedKeys.add(`${partyKey(r.party)}|${n.number}`) }
  const seenFp = new Map<string, Entry>()
  const live: Entry[] = []
  for (const e of entries.sort(byDateThenName)) {
    if (input.existing.fingerprints.has(e.fingerprint) || input.existing.billIds.has(e.bill.id) || importedKeys.has(`${partyKey(e.party)}|${e.lb.legacyNumber}`)) {
      skipped.push({ file: e.file, reason: 'alreadyImported', detail: 'Already here (imported before, or received by sync).' }); continue
    }
    const first = seenFp.get(e.fingerprint)
    if (first) { skipped.push({ file: e.file, reason: 'duplicateFingerprint', detail: `Identical to ${first.file}.` }); continue }
    seenFp.set(e.fingerprint, e)
    live.push(e)
  }

  // 3. clash groups (same legacy number)
  const groups = new Map<number, Entry[]>()
  for (const e of live) { const g = groups.get(e.lb.legacyNumber); if (g) g.push(e); else groups.set(e.lb.legacyNumber, [e]) }
  const clashGroups: ClashGroup[] = []
  for (const [num, g] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (g.length < 2) continue
    const byParty = new Map<string, Entry[]>()
    for (const e of g) { const k = partyKey(e.party); const l = byParty.get(k); if (l) l.push(e); else byParty.set(k, [e]) }
    const survivors: Entry[] = []
    for (const l of byParty.values()) {
      l.sort(better)
      survivors.push(l[0]!)
      for (const loser of l.slice(1)) { loser.action = 'skip'; loser.skipReason = 'sameBillTwice'; loser.reason = `Same bill saved twice (kept ${l[0]!.file}).` }
    }
    survivors.sort(byDateThenName)
    survivors.slice(1).forEach((e) => { e.action = 'renumber'; e.reason = `Number ${num} is used by a different party; the earliest keeps it.` })
    clashGroups.push({ number: num, files: g.map((e) => ({ file: e.file, party: e.party, date: e.lb.isoDate, defaultAction: e.action, reason: e.reason })).sort((a, b) => (a.file < b.file ? -1 : 1)) })
  }
  // owner overrides (only inside clash groups)
  const inClash = new Set(clashGroups.flatMap((g) => g.files.map((x) => x.file)))
  for (const e of live) {
    const c = input.choices?.[e.file]
    if (!c || !inClash.has(e.file)) continue
    if (c === 'skip') { e.action = 'skip'; e.skipReason = 'chosen'; e.reason = 'Skipped by choice.' }
    else if (c === 'renumber') { e.action = 'renumber'; e.reason = 'Imported under a new number by choice.' }
    else { e.action = 'keep'; e.reason = ''; delete e.skipReason }
  }
  for (const e of live) if (e.action === 'skip') skipped.push({ file: e.file, reason: e.skipReason ?? 'chosen', detail: e.reason })

  // 4. PO numbers
  const rawNo = new Map<string, number>()
  for (const e of entries) rawNo.set(e.lb.billNoText, (rawNo.get(e.lb.billNoText) ?? 0) + 1)
  const duplicateBillNoGroups = [...rawNo.values()].filter((n) => n > 1).length
  const kept = live.filter((e) => e.action !== 'skip')
  const highestLegacy = kept.reduce((m, e) => Math.max(m, e.lb.legacyNumber), 0)
  const maxUsed = [...input.existing.usedPoSeqs].reduce((m, n) => Math.max(m, n), 0)
  const taken = new Set<number>(input.existing.usedPoSeqs)
  const assigned = new Map<Entry, number>()
  const renumber: Entry[] = []
  const keepers = kept.filter((e) => e.action === 'keep').sort(byDateThenName)
  for (const e of keepers) {
    const n = e.lb.legacyNumber
    if (taken.has(n)) { e.action = 'renumber'; e.reason = input.existing.usedPoSeqs.has(n) ? `Number ${n} is already used by a bill in this database.` : `Number ${n} was already taken in this batch.` }
    else { taken.add(n); assigned.set(e, n) }
  }
  for (const e of kept.filter((x) => x.action === 'renumber').sort(byDateThenName)) renumber.push(e)
  let nextFree = Math.max(highestLegacy, maxUsed, input.existing.nextSeq - 1) + 1
  const renumbered: RenumberedFile[] = []
  for (const e of renumber) {
    while (taken.has(nextFree)) nextFree++
    taken.add(nextFree)
    assigned.set(e, nextFree)
    renumbered.push({ file: e.file, legacyRef: e.lb.billNoText, oldNumber: e.lb.legacyNumber, newPoSeq: nextFree, newPo: formatPoNumber(input.poPrefix, nextFree), reason: e.reason })
    nextFree++
  }

  // 5. parties: exact normalised name; newest bill supplies phone / transport / address
  const existingByNorm = new Map<string, string>()
  for (const p of input.existing.parties) { const k = partyKey(p.name); if (k !== '' && !existingByNorm.has(k)) existingByNorm.set(k, p.id) }
  const byParty = new Map<string, Entry[]>()
  for (const e of kept) { const k = partyKey(e.party); const l = byParty.get(k); if (l) l.push(e); else byParty.set(k, [e]) }
  const newParties: PlannedParty[] = []
  let existingCount = 0
  const partyIdOf = new Map<string, string>()
  for (const [k, l] of [...byParty.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const existingId = existingByNorm.get(k)
    if (existingId) { partyIdOf.set(k, existingId); existingCount++; continue }
    const newest = [...l].sort((a, b) => -byDateThenName(a, b))
    const pick = (f: (e: Entry) => string): string => newest.map(f).find((v) => v !== '') ?? ''
    const id = uuidFromText(`legacy-party|${k}`)
    partyIdOf.set(k, id)
    newParties.push({ id, name: newest[0]!.party, phone: pick((e) => e.bill.party.phone), address: pick((e) => e.bill.party.address), transport: pick((e) => e.bill.party.transport), billCount: l.length })
  }

  // 6. finish the bills
  const bills: PlannedBill[] = []
  const diffs: TotalDifference[] = []
  for (const e of kept.sort(byDateThenName)) {
    const seq = assigned.get(e)!
    e.bill.poSeq = seq
    e.bill.poNumber = formatPoNumber(input.poPrefix, seq)
    e.bill.partyId = partyIdOf.get(partyKey(e.party)) ?? null
    bills.push({ file: e.file, bill: e.bill, legacyRef: e.lb.billNoText, fingerprint: e.fingerprint, legacyNumber: e.lb.legacyNumber, recomputedTotal: e.total })
    if (e.lb.storedTotal !== null && D(e.total).minus(e.lb.storedTotal).abs().greaterThan('0.5')) {
      const gap = D(e.total).minus(e.lb.storedTotal)
      const hit = e.adjustmentValues.find((v) => D(gap).minus(v).abs().lessThanOrEqualTo('0.5'))
      diffs.push({
        file: e.file, legacy: toMoney(D(e.lb.storedTotal)), recomputed: toMoney(D(e.total)),
        note: hit !== undefined ? `the legacy total left out the ${toMoney(D(hit))} adjustment` : 'the legacy total does not match its own items'
      })
    }
  }
  const seqs = bills.map((b) => b.bill.poSeq)
  const highestAssigned = seqs.reduce((m, n) => Math.max(m, n), 0)
  const nextSeqAfter = Math.max(input.existing.nextSeq, highestAssigned + 1)

  return {
    bills, newParties,
    report: {
      filesFound: files.length, filesRead, errors, created: bills.length,
      skipped: skipped.sort((a, b) => (a.file < b.file ? -1 : 1)), renumbered, clashGroups, duplicateBillNoGroups,
      poFirst: seqs.length ? Math.min(...seqs) : null, poLast: seqs.length ? highestAssigned : null,
      nextSeqAfter, nextPoAfter: formatPoNumber(input.poPrefix, nextSeqAfter),
      newParties: newParties.length, existingParties: existingCount,
      totalDifferences: diffs, formats, convert: convertTotals, ignored, warnings
    }
  }
}

function emptyPlan(found: number, errors: ErrorFile[], input: PlanInput): ImportPlan {
  return {
    bills: [], newParties: [],
    report: {
      filesFound: found, filesRead: 0, errors, created: 0, skipped: [], renumbered: [], clashGroups: [], duplicateBillNoGroups: 0, poFirst: null, poLast: null,
      nextSeqAfter: input.existing.nextSeq, nextPoAfter: formatPoNumber(input.poPrefix, input.existing.nextSeq), newParties: 0, existingParties: 0,
      totalDifferences: [], formats: { gst: 0, nonGst: 0, defaultMode: 0 },
      convert: { amountOnlyRows: 0, amountOverrides: 0, redBoldRanges: 0, markedCells: 0, adjustments: 0, negativeAdjustments: 0 }, ignored: emptyIgnored(), warnings: []
    }
  }
}
