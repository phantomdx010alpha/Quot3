/**
 * Phase 84 - one parsed legacy bill -> a Quot3 `Bill` (LEGACY_IMPORT_SPEC section 2). Pure and deterministic: row ids come from
 * the bill id. PO number, party link and branch are filled in by the planner. Amounts are decimal strings only.
 */
import type { Bill, BillRow, ExtraCell, ExtraColDef, Runs } from '../types'
import { D, tryD } from '../money'
import { MAX_EXTRA_COLS, nextExtraColKey, sanitizeExtraHeader, nextExtraColHeader } from '../extraCols'
import { normalize } from '../richtext/runs'
import { formatHasGst } from '../calc/rowCalc'
import { resolveFormat } from '../format/registry'
import { uuidFromText } from './sha256'
import type { LegacyBill, LegacyItem } from './parse'

/** Differences above this between the stored `amt` and qty x rate keep the typed amount as a manual total. */
export const AMT_TOLERANCE = '0.01'

/** Old `format_mode` -> Quot3 format id. Anything else (and `default`, the old Alt+1) is non-GST. */
const LEGACY_FORMAT_IDS: Record<string, 'gst' | 'non_gst'> = { gst: 'gst', manual: 'non_gst', default: 'non_gst' }

export interface ConvertCounts { amountOnlyRows: number; amountOverrides: number; redBoldRanges: number; markedCells: number; adjustments: number; negativeAdjustments: number }

function nameRuns(it: LegacyItem, counts: ConvertCounts): Runs {
  const text = it.name
  if (text === '') return []
  const n = text.length
  const mask = new Array<boolean>(n).fill(false)
  for (const r of it.ranges) {
    const s = Math.max(0, Math.min(n, Math.trunc(r.start)))
    const e = Math.max(0, Math.min(n, Math.trunc(r.end)))
    counts.redBoldRanges++ // every redbold range read is counted (an empty one formats nothing)
    for (let i = s; i < e; i++) mask[i] = true
  }
  const runs: Runs = []
  let i = 0
  while (i < n) {
    let j = i
    while (j < n && mask[j] === mask[i]) j++
    runs.push(mask[i] ? { t: text.slice(i, j), b: 1, r: 1 } : { t: text.slice(i, j) })
    i = j
  }
  return normalize(runs)
}

function isBlankItem(it: LegacyItem): boolean {
  return it.name.trim() === '' && it.qty === null && it.rate === null && it.amt === null && !it.extras.some((e) => e.text !== '' || e.marked)
}

export interface ConvertedBill { bill: Bill; counts: ConvertCounts; formatId: 'gst' | 'non_gst'; itemCount: number; adjustmentValues: string[] }

export function convertLegacyBill(lb: LegacyBill, billId: string, branchId: string, now: string): ConvertedBill {
  // the old format names are data: a lookup, not a branch on a format id (Golden Rule)
  const formatId = LEGACY_FORMAT_IDS[lb.formatMode] ?? 'non_gst'
  const counts: ConvertCounts = { amountOnlyRows: 0, amountOverrides: 0, redBoldRanges: 0, markedCells: 0, adjustments: 0, negativeAdjustments: 0 }

  const extraCols: ExtraColDef[] = []
  const colIndex: Array<string | null> = []
  lb.extraHeaders.forEach((h, i) => {
    if (extraCols.length >= MAX_EXTRA_COLS) { lb.ignored.extraColumnsBeyondLimit++; colIndex[i] = null; return }
    const header = sanitizeExtraHeader(h) || nextExtraColHeader(extraCols)
    const key = nextExtraColKey(extraCols, [])
    extraCols.push({ key, header, kind: 'units' })
    colIndex[i] = key
  })

  const items = [...lb.items]
  while (items.length > 0 && isBlankItem(items[items.length - 1]!)) items.pop() // no trailing blank rows
  const adjustmentValues: string[] = []
  const rows: BillRow[] = items.map((it, idx) => {
    const row: BillRow = { id: uuidFromText(`${billId}|row|${idx}`), idx, nameRuns: nameRuns(it, counts), qty: null, rate: null, totalOverride: null, gstRate: null, extras: {} }
    if (it.kind === 'adjustment') {
      row.totalOverride = it.amt
      counts.adjustments++
      if (it.amt !== null) {
        adjustmentValues.push(it.amt)
        if (it.amt.startsWith('-')) counts.negativeAdjustments++
      }
    } else {
      row.qty = it.qty
      row.rate = it.rate
      const q = tryD(it.qty), r = tryD(it.rate)
      if (it.amt !== null) {
        if (q && r) {
          if (D(it.amt).minus(q.times(r)).abs().greaterThan(AMT_TOLERANCE)) { row.totalOverride = it.amt; counts.amountOverrides++ }
        } else { row.totalOverride = it.amt; if (!q && !r) counts.amountOnlyRows++; else counts.amountOverrides++ }
      }
      if (formatHasGst(resolveFormat(formatId)) && it.gst !== null) row.gstRate = it.gst
    }
    if (it.highlightName) row.cellStyle = { name: { hl: 1 } }
    it.extras.forEach((e, i) => {
      const key = colIndex[i]
      const isZero = e.text === '' || (tryD(e.text) !== null && D(e.text).isZero())
      if (key === undefined || key === null) {
        // a value with no column to live in: counted, never stored
        if (!(it.kind === 'adjustment' ? isZero : e.text === '')) { if (it.kind === 'adjustment') lb.ignored.adjustmentExtras++; else lb.ignored.extraColumnsBeyondLimit++ }
        return
      }
      if (it.kind === 'adjustment' && isZero) return // only non-zero / non-blank adjustment values are kept
      if (e.text === '' && !e.marked) return
      const cell: ExtraCell = { text: e.text }
      if (e.marked) { cell.marked = true; counts.markedCells++ }
      row.extras[key] = cell
    })
    return row
  })

  const time = lb.time ?? '12:00:00'
  const stamp = `${lb.isoDate}T${time}.000Z` // the old app stored local time without a zone; kept as written
  const party = {
    name: lb.party,
    phone: lb.phone,
    transport: lb.transport,
    address: lb.gstin !== '' ? `GSTIN: ${lb.gstin}` : ''
  }
  const bill: Bill = {
    id: billId, branchId, poSeq: 0, poNumber: '', partyId: null, party,
    formatId, extraCols, paperOverride: null, roundOff: 0,
    billDate: lb.isoDate, rows, revision: 1, createdAt: stamp, updatedAt: stamp, deletedAt: null, syncState: 'local_only'
  }
  void now
  return { bill, counts, formatId, itemCount: lb.items.length, adjustmentValues }
}
