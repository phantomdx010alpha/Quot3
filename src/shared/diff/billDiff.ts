import type { Bill, BillRow, ExtraCell, ExtraColDef } from '../types'
import { cleanFooterExtras, cleanTailRows } from '../billModel'
import { tryD } from '../money'
import { plain } from '../richtext/runs'
import { isEntryBlank } from '../gridModel'
import { getFormat, hasFormat } from '../format/registry'
import { describeHybrid } from '../hybrid/hybrid'

/**
 * Phase 44 (pure): what changed between two versions of a bill. Used by the revision panel (previous revision vs a revision,
 * a revision vs the current bill). Pure: no DOM, no Electron, no Node. Money is compared as decimals (`"1.0"` equals `"1"`),
 * never as JS numbers.
 *
 * Rows are matched by their id (a row keeps its id across saves). A row that is only in the older bill is `removed`, one only in
 * the newer bill is `added`; a row in both with different content is `changed`, with different order only is `moved`.
 * Rows with nothing in them at all are ignored (the grid's blank padding is not a change).
 */

export type DiffScope = 'bill' | 'party' | 'extraCol' | 'row'

export interface FieldChange {
  /** Stable machine key, e.g. `qty`, `party.name`, `extra:<key>`. */
  field: string
  /** What the owner reads: `Qty`, `Party name`, `Col 1 (units)`. */
  label: string
  before: string
  after: string
}

export type RowChangeKind = 'added' | 'removed' | 'changed' | 'moved'

export interface RowDiff {
  kind: RowChangeKind
  rowId: string
  /** 1-based row number in the older / newer bill (null where the row does not exist). */
  beforeNo: number | null
  afterNo: number | null
  /** Item name to show (the newer text, or the older one for a removed row). */
  name: string
  changes: FieldChange[]
}

export interface BillDiff {
  /** Nothing differs at all. */
  identical: boolean
  /** Date, format, paper override, round off. */
  bill: FieldChange[]
  party: FieldChange[]
  /** Extra columns added / removed / renamed. */
  extraCols: FieldChange[]
  rows: RowDiff[]
  counts: { added: number; removed: number; changed: number; moved: number }
}

const EMPTY = ''
const PARTY_LABELS = { name: 'Party name', phone: 'Phone', address: 'Address', transport: 'Transport' } as const

/** Decimal-aware equality of two canonical numeric strings; null/empty equal each other. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const ea = a === null || a === undefined || a.trim() === ''
  const eb = b === null || b === undefined || b.trim() === ''
  if (ea || eb) return ea && eb
  const x = tryD(a)
  const y = tryD(b)
  return x !== null && y !== null ? x.eq(y) : a === b
}

const show = (v: string | null | undefined): string => (v === null || v === undefined ? EMPTY : v)

function formatLabel(id: string): string {
  return hasFormat(id) ? getFormat(id).label : id
}

function sameRuns(a: BillRow, b: BillRow): boolean {
  if (a.nameRuns.length !== b.nameRuns.length) return false
  return a.nameRuns.every((r, i) => {
    const o = b.nameRuns[i]!
    return r.t === o.t && !!r.b === !!o.b && !!r.r === !!o.r && !!r.hl === !!o.hl
  })
}

const hlKeys = (r: BillRow): string => Object.keys(r.cellStyle ?? {}).filter((k) => r.cellStyle?.[k]?.hl).sort().join(',')

function headerOf(cols: readonly ExtraColDef[], key: string): string {
  return cols.find((c) => c.key === key)?.header ?? key
}

function rowChanges(a: BillRow, b: BillRow, aCols: readonly ExtraColDef[], bCols: readonly ExtraColDef[]): FieldChange[] {
  const out: FieldChange[] = []
  const nameA = plain(a.nameRuns)
  const nameB = plain(b.nameRuns)
  if (nameA !== nameB) out.push({ field: 'name', label: 'Item name', before: nameA, after: nameB })
  else if (!sameRuns(a, b)) out.push({ field: 'nameStyle', label: 'Item name formatting', before: 'formatted', after: 'formatted differently' })
  const nums: Array<['qty' | 'rate' | 'totalOverride' | 'gstRate', string]> = [['qty', 'Qty'], ['rate', 'Rate'], ['totalOverride', 'Total (typed)'], ['gstRate', 'GST %']]
  for (const [k, label] of nums) {
    if (!sameNumber(a[k], b[k])) out.push({ field: k === 'totalOverride' ? 'total' : k, label, before: show(a[k]), after: show(b[k]) })
  }
  const keys = [...new Set([...Object.keys(a.extras), ...Object.keys(b.extras)])].sort()
  for (const k of keys) {
    const x = a.extras[k]
    const y = b.extras[k]
    const tx = x?.text ?? ''
    const ty = y?.text ?? ''
    const label = headerOf(bCols.some((c) => c.key === k) ? bCols : aCols, k)
    if (tx !== ty) out.push({ field: `extra:${k}`, label, before: tx, after: ty })
    if (!!x?.marked !== !!y?.marked) out.push({ field: `mark:${k}`, label: `${label} mark`, before: x?.marked ? 'marked' : 'not marked', after: y?.marked ? 'marked' : 'not marked' })
  }
  if (hlKeys(a) !== hlKeys(b)) out.push({ field: 'highlight', label: 'Highlight', before: hlKeys(a) || 'none', after: hlKeys(b) || 'none' })
  return out
}

/** `diffBills(older, newer)`. Direction matters: `before` values come from `older`, `after` values from `newer`. */
export function diffBills(older: Bill, newer: Bill): BillDiff {
  const bill: FieldChange[] = []
  if (older.billDate !== newer.billDate) bill.push({ field: 'billDate', label: 'Bill date', before: older.billDate, after: newer.billDate })
  if (older.formatId !== newer.formatId) bill.push({ field: 'formatId', label: 'Format', before: formatLabel(older.formatId), after: formatLabel(newer.formatId) })
  if ((older.paperOverride ?? null) !== (newer.paperOverride ?? null)) {
    bill.push({ field: 'paperOverride', label: 'Paper size', before: older.paperOverride ?? 'Automatic', after: newer.paperOverride ?? 'Automatic' })
  }

  if ((older.roundOff ?? 0) !== (newer.roundOff ?? 0)) {
    bill.push({ field: 'roundOff', label: 'Round off', before: older.roundOff === 1 ? 'On' : 'Off', after: newer.roundOff === 1 ? 'On' : 'Off' })
  }

  // Phase 79: free cells on the footer rows and the extra-only tail rows (compared after cleaning, so empty cells / trailing blank rows are no change).
  const freeText = (m: Record<string, ExtraCell> | undefined): string =>
    Object.entries(m ?? {}).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, c]) => `${k}=${c.text}${c.marked ? ' (marked)' : ''}`).join('; ')
  const footerText = (b: Bill): string => {
    const f = cleanFooterExtras(b.footerExtras) ?? {}
    return (['itemsTotal', 'adjustmentsTotal', 'grandTotal'] as const).map((k) => (f[k] ? `${k}: ${freeText(f[k])}` : '')).filter(Boolean).join(' | ')
  }
  const tailText = (b: Bill): string => (cleanTailRows(b.tailRows) ?? []).map((r) => freeText(r.extras)).join(' | ')
  if (footerText(older) !== footerText(newer)) bill.push({ field: 'footerExtras', label: 'Total row extra cells', before: footerText(older) || 'none', after: footerText(newer) || 'none' })
  if (tailText(older) !== tailText(newer)) bill.push({ field: 'tailRows', label: 'Rows below the total', before: tailText(older) || 'none', after: tailText(newer) || 'none' })

  // Phase 150: the Hybrid second table is ONE bill-level line (its rows are never mixed into the primary row diff).
  const hybridText = (b: Bill): string => {
    if (!b.hybrid) return 'none'
    const rows = b.hybrid.rows.filter((r) => !isEntryBlank(r)).map((r) => `${plain(r.nameRuns)}|${r.qty ?? ''}|${r.rate ?? ''}|${r.totalOverride ?? ''}`).join(';')
    return `${describeHybrid(b.hybrid)} #${rows}`
  }
  if (hybridText(older) !== hybridText(newer)) bill.push({ field: 'hybrid', label: 'Hybrid second table', before: describeHybrid(older.hybrid), after: describeHybrid(newer.hybrid) })

  const party: FieldChange[] = []
  for (const k of ['name', 'phone', 'address', 'transport'] as const) {
    if (older.party[k] !== newer.party[k]) party.push({ field: `party.${k}`, label: PARTY_LABELS[k], before: older.party[k], after: newer.party[k] })
  }

  const extraCols: FieldChange[] = []
  for (const c of older.extraCols) {
    const n = newer.extraCols.find((x) => x.key === c.key)
    if (!n) extraCols.push({ field: `extraCol:${c.key}`, label: 'Extra column removed', before: c.header, after: EMPTY })
    else if (n.header !== c.header) extraCols.push({ field: `extraCol:${c.key}`, label: 'Extra column renamed', before: c.header, after: n.header })
  }
  for (const c of newer.extraCols) {
    if (!older.extraCols.some((x) => x.key === c.key)) extraCols.push({ field: `extraCol:${c.key}`, label: 'Extra column added', before: EMPTY, after: c.header })
  }

  const aRows = older.rows.filter((r) => !isEntryBlank(r))
  const bRows = newer.rows.filter((r) => !isEntryBlank(r))
  const aNo = new Map(aRows.map((r, i) => [r.id, i + 1]))
  const bNo = new Map(bRows.map((r, i) => [r.id, i + 1]))
  const aById = new Map(aRows.map((r) => [r.id, r]))
  const bById = new Map(bRows.map((r) => [r.id, r]))
  // Order among the rows both bills share: a pure insert / delete elsewhere does not make the others "moved".
  const commonA = aRows.filter((r) => bById.has(r.id)).map((r) => r.id)
  const commonB = bRows.filter((r) => aById.has(r.id)).map((r) => r.id)
  const rankB = new Map(commonB.map((id, i) => [id, i]))

  const rows: RowDiff[] = []
  for (const r of aRows) {
    const o = bById.get(r.id)
    if (!o) {
      rows.push({ kind: 'removed', rowId: r.id, beforeNo: aNo.get(r.id) ?? null, afterNo: null, name: plain(r.nameRuns), changes: [] })
      continue
    }
    const changes = rowChanges(r, o, older.extraCols, newer.extraCols)
    const moved = rankB.get(r.id) !== commonA.indexOf(r.id)
    if (changes.length > 0 || moved) {
      rows.push({ kind: changes.length > 0 ? 'changed' : 'moved', rowId: r.id, beforeNo: aNo.get(r.id) ?? null, afterNo: bNo.get(r.id) ?? null, name: plain(o.nameRuns), changes })
    }
  }
  for (const r of bRows) {
    if (!aById.has(r.id)) rows.push({ kind: 'added', rowId: r.id, beforeNo: null, afterNo: bNo.get(r.id) ?? null, name: plain(r.nameRuns), changes: [] })
  }
  // Show in the newer bill's order (removed rows slot in by their old number).
  rows.sort((x, y) => (x.afterNo ?? x.beforeNo ?? 0) - (y.afterNo ?? y.beforeNo ?? 0) || (x.kind === 'removed' ? -1 : 1))

  const counts = { added: 0, removed: 0, changed: 0, moved: 0 }
  for (const r of rows) counts[r.kind] += 1
  const identical = bill.length === 0 && party.length === 0 && extraCols.length === 0 && rows.length === 0
  return { identical, bill, party, extraCols, rows, counts }
}

/** One short line for a list: `3 rows changed, 1 added - party, format`. `No changes` when identical. */
export function describeDiff(d: BillDiff): string {
  if (d.identical) return 'No changes'
  const parts: string[] = []
  const n = (c: number, w: string): void => { if (c > 0) parts.push(`${c} ${w}`) }
  n(d.counts.changed, 'changed'); n(d.counts.added, 'added'); n(d.counts.removed, 'removed'); n(d.counts.moved, 'moved')
  const rowPart = parts.length > 0 ? `${parts.join(', ')} row${d.rows.length === 1 ? '' : 's'}` : ''
  const other: string[] = []
  if (d.party.length > 0) other.push('party')
  if (d.bill.some((c) => c.field === 'formatId')) other.push('format')
  if (d.bill.some((c) => c.field === 'billDate')) other.push('date')
  if (d.bill.some((c) => c.field === 'paperOverride')) other.push('paper')
  if (d.bill.some((c) => c.field === 'roundOff')) other.push('round off')
  if (d.bill.some((c) => c.field === 'footerExtras' || c.field === 'tailRows')) other.push('total-row cells')
  if (d.bill.some((c) => c.field === 'hybrid')) other.push('hybrid table')
  if (d.extraCols.length > 0) other.push('extra columns')
  return [rowPart, other.join(', ')].filter(Boolean).join(' - ')
}
