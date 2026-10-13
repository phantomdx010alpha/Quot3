/**
 * Phase 110 - the sales read model (pure). One named bill row becomes a `SaleLine`; the lines of one item group become two
 * `SalesTab`s, Non-GST and GST, which are NEVER mixed (ITEM_SORTER_SPEC section 5). "GST" = the bill's FORMAT computes GST
 * (`formatHasGst`, data-driven; never a format name) - a row keeps its GST % when the owner switches a bill to a non-GST format, so
 * the row's own GST % alone would mislead. All money is decimal strings (decimal.js), never JS numbers.
 */
import { calcRow, formatHasGst } from '../calc/rowCalc'
import { classifyRow } from '../calc/classifyRow'
import { D, sum, toDec, tryD, type Decimal } from '../money'
import type { BillRow, Dec, FormatDef } from '../types'

/** A rate is flagged high / low when it is this far (fraction) from the tab's median. [A] */
export const OUTLIER_RATIO = '0.30'
/** Flags are only given when at least this many sales in the tab have a rate. [A] */
export const OUTLIER_MIN_PRICED = 5
/** Most rows one sales answer carries (newest first); `truncated` says when there were more. */
export const SALES_ROWS_MAX = 2000

/** What the service needs to know about the bill a row belongs to. */
export interface SaleBillHead {
  billId: string
  poNumber: string
  billDate: string
  createdAt: string
  partyId: string | null
  partyName: string
  legacyRef: string | null
}

export interface SaleLine {
  billId: string
  rowIdx: number
  poNumber: string
  billDate: string
  createdAt: string
  partyKey: string
  partyName: string
  /** The row's name as typed (trimmed). */
  name: string
  qty: Dec | null
  rate: Dec | null
  /** GST tab? (the bill's format has GST columns) */
  gst: boolean
  /** GST % as typed (GST tab only; blank = 0 for the sums, kept null here). */
  gstPct: Dec | null
  lineTotal: Dec | null
  gstAmt: Dec | null
  amount: Dec | null
}

export interface SaleRow extends SaleLine {
  outlier: 'high' | 'low' | null
}

export interface RateStats {
  /** Sales in the tab (with or without a rate). */
  count: number
  /** Sales that have a usable rate. */
  priced: number
  minRate: Dec | null
  medianRate: Dec | null
  maxRate: Dec | null
  /** Rate of the newest sale that has one. */
  latestRate: Dec | null
  latestDate: string | null
  totalQty: Dec
  parties: number
}

export interface PartyLastRate {
  partyKey: string
  partyName: string
  rate: Dec
  date: string
  billId: string
  poNumber: string
  sales: number
  outlier: 'high' | 'low' | null
}

export interface SalesTab {
  stats: RateStats
  /** Median of the whole tab (stays the same when a party filter narrows `rows`). */
  groupMedianRate: Dec | null
  rows: SaleRow[]
  lastByParty: PartyLastRate[]
  truncated: boolean
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Stable party identity: the saved party id, else the typed name (trimmed, upper case, spaces collapsed). */
export function partyKeyOf(partyId: string | null, partyName: string): string {
  if (partyId) return `id:${partyId}`
  return `name:${partyName.replace(/\s+/g, ' ').trim().toUpperCase()}`
}

/**
 * One bill row -> a sale line, or null when the row is not a sale: no name, or name only (no qty, rate or typed total).
 * Charges such as `GST EXTRA` are still returned; the grouping step (Phase 107 non-product rules) decides they are not items.
 */
export function saleLine(format: FormatDef, head: SaleBillHead, row: BillRow): SaleLine | null {
  const name = row.nameRuns.map((r) => r.t).join('').trim()
  if (name === '') return null
  const kind = classifyRow(row)
  if (kind !== 'item' && kind !== 'adjustment') return null
  const c = calcRow(format, row)
  const gst = formatHasGst(format)
  const pct = gst && row.gstRate !== null && row.gstRate.trim() !== '' ? tryD(row.gstRate) : null
  return {
    billId: head.billId, rowIdx: row.idx, poNumber: head.poNumber, billDate: head.billDate, createdAt: head.createdAt,
    partyKey: partyKeyOf(head.partyId, head.partyName), partyName: head.partyName,
    name, qty: tryD(row.qty) ? row.qty : null, rate: positiveRate(row.rate),
    gst, gstPct: pct ? row.gstRate : null,
    lineTotal: c.total, gstAmt: gst ? c.gstAmt : null, amount: gst ? c.amount : null
  }
}

/** Phase 117: a rate of 0 (or blank / not a number) is 'no rate' - it must not drag min / median down or be flagged Low. */
function positiveRate(rate: string | null): Dec | null {
  const d = rate === null ? null : tryD(rate)
  return rate !== null && d && d.greaterThan(0) ? rate : null
}

/** Newest first: bill date, creation time, bill id, row. Total order, so the output never depends on input order. */
export function compareNewestFirst(a: SaleLine, b: SaleLine): number {
  return cmp(b.billDate, a.billDate) || cmp(b.createdAt, a.createdAt) || cmp(b.billId, a.billId) || b.rowIdx - a.rowIdx
}

function medianOf(sorted: Decimal[]): Decimal | null {
  const n = sorted.length
  if (n === 0) return null
  const mid = n >> 1
  return n % 2 === 1 ? sorted[mid]! : sorted[mid - 1]!.plus(sorted[mid]!).dividedBy(2)
}

/** count / min / median / max / latest / total quantity over lines (any order). */
export function rateStats(lines: readonly SaleLine[]): RateStats {
  const priced = lines.filter((l) => l.rate !== null).sort(compareNewestFirst)
  const rates = priced.map((l) => D(l.rate)).sort((a, b) => a.comparedTo(b))
  const latest = priced[0]
  return {
    count: lines.length,
    priced: priced.length,
    minRate: rates.length ? toDec(rates[0]!) : null,
    medianRate: rates.length ? toDec(medianOf(rates)!) : null,
    maxRate: rates.length ? toDec(rates[rates.length - 1]!) : null,
    latestRate: latest ? (latest.rate as Dec) : null,
    latestDate: latest ? latest.billDate : null,
    totalQty: toDec(sum(lines.filter((l) => l.qty !== null).map((l) => l.qty as Dec))),
    parties: new Set(lines.map((l) => l.partyKey)).size
  }
}

/** Is `rate` unusually high or low against the median? Needs `OUTLIER_MIN_PRICED` priced sales and a median above zero. */
export function outlierOf(rate: Dec | null, median: Dec | null, priced: number): 'high' | 'low' | null {
  if (rate === null || median === null || priced < OUTLIER_MIN_PRICED) return null
  const m = D(median)
  if (!m.greaterThan(0)) return null
  const r = D(rate)
  const band = m.times(OUTLIER_RATIO)
  if (r.greaterThan(m.plus(band))) return 'high'
  if (r.lessThan(m.minus(band))) return 'low'
  return null
}

/** The lines of one tab -> stats, rows (newest first, flagged) and the last rate per party. `partyKey` narrows `rows` and `stats` only. */
export function buildSalesTab(lines: readonly SaleLine[], partyKey?: string): SalesTab {
  const all = lines.slice().sort(compareNewestFirst)
  const whole = rateStats(all)
  const flag = (l: SaleLine): 'high' | 'low' | null => outlierOf(l.rate, whole.medianRate, whole.priced)

  const lastByParty: PartyLastRate[] = []
  const seen = new Map<string, PartyLastRate>()
  for (const l of all) {
    const known = seen.get(l.partyKey)
    if (known) { known.sales++; continue }
    if (l.rate === null) { // newest sale has no rate: keep counting, take the first priced one below
      seen.set(l.partyKey, { partyKey: l.partyKey, partyName: l.partyName, rate: '', date: '', billId: '', poNumber: '', sales: 1, outlier: null })
      continue
    }
    const e: PartyLastRate = { partyKey: l.partyKey, partyName: l.partyName, rate: l.rate, date: l.billDate, billId: l.billId, poNumber: l.poNumber, sales: 1, outlier: flag(l) }
    seen.set(l.partyKey, e)
  }
  for (const l of all) { // second pass fills parties whose newest sale had no rate
    const e = seen.get(l.partyKey)!
    if (e.rate === '' && l.rate !== null) { e.rate = l.rate; e.date = l.billDate; e.billId = l.billId; e.poNumber = l.poNumber; e.outlier = flag(l) }
  }
  for (const e of seen.values()) if (e.rate !== '') lastByParty.push(e)
  lastByParty.sort((a, b) => cmp(b.date, a.date) || cmp(a.partyName.toUpperCase(), b.partyName.toUpperCase()) || cmp(a.partyKey, b.partyKey))

  const shown = partyKey === undefined ? all : all.filter((l) => l.partyKey === partyKey)
  const rows: SaleRow[] = shown.slice(0, SALES_ROWS_MAX).map((l) => ({ ...l, outlier: flag(l) }))
  return {
    stats: partyKey === undefined ? whole : rateStats(shown),
    groupMedianRate: whole.medianRate,
    rows,
    lastByParty,
    truncated: shown.length > SALES_ROWS_MAX
  }
}
