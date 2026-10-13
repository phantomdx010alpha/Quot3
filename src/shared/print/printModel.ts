/**
 * Phase 33 - `buildPrintModel` (pure): bill + mode + settings + paper decision -> the exact rows, columns, widths,
 * header and footer the template prints. One model serves preview, print, PDF and image (MASTERPLAN section 12), so
 * they cannot drift. No DOM, no Electron. Money text comes from `computeBill` (never re-computed here).
 *
 * Rules: blank rows are never printed (a row with only extra-column text is kept); partial rows are printed (never
 * totalled); adjustments sit in the footer after the items total, exactly as in the grid; extra columns follow the
 * format columns; the Rough header carries party name, phone and transport only (no company block, no address, no PO,
 * no date). The Professional header (Phase 34) adds our company block (placeholder until Phase 48), full party details, the PO number and the date.
 */
import { computeBill, type DisplayRow } from '../calc/billTotals'
import { getBillOptions } from '../calc/billOptions'
import { footerKeyOfKind } from '../freeCells'
import { resolveFormat } from '../format/registry'
import type { PaperDecision } from '../paper/paperTypes'
import type { Bill, BillRow, FormatDef, PrintMode, Runs } from '../types'
import { EXTRA_COL_PRINT_SHARE, NAME_COL_MIN_SHARE, PRINT_MIN_SHARE, PRINT_WIDTH_TOTAL, RUPEE } from './printConstants'

export interface CompanyBlock {
  /** Image reference the template can load (data URL / file URL); empty = no logo. Phase 34 / 48. */
  logo: string
  name: string
  phone: string
  address: string
}

export interface PrintSettings {
  /** Prefix the final total with the rupee sign (the bundled font has the glyph). Default true. */
  rupeeOnTotal: boolean
  /** 0.1.6 (testing): leave the Adjustments total row off the printed page / copied image. The Create screen is unchanged. */
  hideAdjustmentsTotal?: boolean
  /** Our company block - Professional only; ignored by Rough. */
  company: CompanyBlock | null
}

/** Shown by the Professional header until Settings > Company (Phase 48) supplies the real block. */
export const PLACEHOLDER_COMPANY: CompanyBlock = Object.freeze({ logo: '', name: 'Your Company Name', phone: 'Company phone', address: 'Company address, City' })

/** A real company block when Settings has a name, else the placeholder (so a Professional print is never headless). */
export function resolveCompany(c: CompanyBlock | null): CompanyBlock {
  return c && c.name.trim() !== '' ? c : PLACEHOLDER_COMPANY
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** `2026-10-08` -> `08 Oct 2026`; anything else is returned unchanged. */
export function formatPrintDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && mon ? `${m[3]} ${mon} ${m[1]}` : iso
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = Object.freeze({ rupeeOnTotal: true, company: null })

export interface PrintColumn {
  key: string
  label: string
  align: 'left' | 'right' | 'center'
  /** Share of the table width in hundredths of a percent; all columns sum to exactly 10000. */
  share: number
  isExtra: boolean
}

export interface PrintCell {
  text: string
  /** Styled runs - the item-name cell only (and only when the name has any). */
  runs?: Runs
  /** Cell highlight (bill_rows.cell_style). */
  hl?: 1
}

export type PrintRowKind = 'item' | 'partial' | 'adjustment' | 'itemsTotal' | 'adjustmentsTotal' | 'roundOff' | 'grandTotal' | 'tail'

export interface PrintRow {
  kind: PrintRowKind
  /** Keyed by column key. Total rows (`label` set) hold their value cells only; the label is printed separately. */
  cells: Record<string, PrintCell>
  /** Total rows: the label ("Total", "Items total", ...), right-aligned across the columns before the first value. */
  label?: string
}

export type PrintHeader =
  | { kind: 'rough'; party: { name: string; phone: string; transport: string } }
  | {
      kind: 'professional'
      company: CompanyBlock
      party: { name: string; phone: string; transport: string; address: string }
      poNumber: string
      billDate: string
    }

export interface PrintModel {
  version: 1
  mode: PrintMode
  paper: PaperDecision
  formatId: string
  header: PrintHeader
  columns: PrintColumn[]
  /** Item and partial rows, in entry order. */
  body: PrintRow[]
  /** Items total, adjustment rows, adjustments total, round-off, final total (or one "Total"). */
  footer: PrintRow[]
  /**
   * Phase 81: extra-only rows below the Final total (`kind: 'tail'`), one per paper row the bill's tail rows occupy (up to the last
   * non-empty one; blank rows between are real rows). Only extra columns carry text. Always present; empty when there are none.
   */
  tail: PrintRow[]
  /** Item rows + adjustment rows + tail rows that print (what the paper engine counts; Phase 79 / 81). */
  rowCount: number
}

// ---------- widths ----------
/**
 * Print column shares (hundredths of a percent, summing to exactly 10000). Format columns keep their registry
 * `printWidthPct`; the name column absorbs the leftover; each extra column takes EXTRA_COL_PRINT_SHARE, paid first
 * from the name column (down to NAME_COL_MIN_SHARE) and then by scaling every column proportionally.
 */
export function printColumnShares(format: FormatDef, extraCount: number): number[] {
  const base = format.columns.map((c) => Math.round(c.printWidthPct * 100))
  const nameIdx = Math.max(0, format.columns.findIndex((c) => c.key === 'name'))
  const extras = extraCount * EXTRA_COL_PRINT_SHARE
  const fixed = base.reduce((a, b) => a + b, 0) - (base[nameIdx] ?? 0)
  const shares = [...base]
  let nameShare = PRINT_WIDTH_TOTAL - fixed - extras
  if (nameShare >= NAME_COL_MIN_SHARE) {
    shares[nameIdx] = nameShare
    return [...shares, ...Array<number>(extraCount).fill(EXTRA_COL_PRINT_SHARE)]
  }
  // Not enough room: scale everything proportionally, name at its minimum.
  nameShare = NAME_COL_MIN_SHARE
  shares[nameIdx] = nameShare
  const all = [...shares, ...Array<number>(extraCount).fill(EXTRA_COL_PRINT_SHARE)]
  const total = all.reduce((a, b) => a + b, 0)
  const scaled = all.map((s) => Math.floor((s * PRINT_WIDTH_TOTAL) / total))
  const rem = PRINT_WIDTH_TOTAL - scaled.reduce((a, b) => a + b, 0)
  scaled[nameIdx] = (scaled[nameIdx] ?? 0) + rem
  return applyFloors(scaled, format, nameIdx)
}

/** Phase 35: lift any column below its floor to the floor, paying from the columns that have room above theirs. Integers; the sum stays exactly 10000. */
function applyFloors(shares: number[], format: FormatDef, nameIdx: number): number[] {
  const floors = shares.map((_, i) => {
    if (i >= format.columns.length) return PRINT_MIN_SHARE.extra
    if (i === nameIdx) return PRINT_MIN_SHARE.name
    return format.columns[i]?.align === 'right' ? PRINT_MIN_SHARE.numeric : PRINT_MIN_SHARE.index
  })
  if (floors.reduce((a, b) => a + b, 0) > PRINT_WIDTH_TOTAL) return shares // cannot satisfy every floor: keep the proportional split
  const out = [...shares]
  for (let guard = 0; guard < 8; guard++) {
    let deficit = 0
    out.forEach((s, i) => { const f = floors[i] as number; if (s < f) { deficit += f - s; out[i] = f } })
    if (deficit === 0) break
    const room = out.map((s, i) => Math.max(0, s - (floors[i] as number)))
    const roomTotal = room.reduce((a, b) => a + b, 0)
    let paid = 0
    room.forEach((r, i) => { if (r > 0) { const cut = Math.min(r, Math.floor((deficit * r) / roomTotal)); out[i] = (out[i] as number) - cut; paid += cut } })
    let left = deficit - paid
    for (let i = 0; left > 0 && i < out.length; i++) { const r = (out[i] as number) - (floors[i] as number); if (r > 0) { const cut = Math.min(r, left); out[i] = (out[i] as number) - cut; left -= cut } }
  }
  return out
}

export function buildPrintColumns(format: FormatDef, extraCols: Bill['extraCols']): PrintColumn[] {
  const shares = printColumnShares(format, extraCols.length)
  const cols: PrintColumn[] = format.columns.map((c, i) => ({
    key: c.key, label: c.label, align: c.align, share: shares[i] ?? 0, isExtra: false
  }))
  extraCols.forEach((e, i) => cols.push({ key: e.key, label: e.header, align: 'left', share: shares[format.columns.length + i] ?? 0, isExtra: true }))
  return cols
}

// ---------- rows ----------
const rupee = (text: string): string => (text === '' ? text : text.startsWith('-') ? `-${RUPEE}${text.slice(1)}` : `${RUPEE}${text}`)

function hasExtraText(row: BillRow): boolean {
  for (const c of Object.values(row.extras)) if (c.text.trim() !== '') return true
  return false
}

function cellFor(col: PrintColumn, d: DisplayRow, row: BillRow | undefined): PrintCell {
  const text = d.cells[col.key] ?? ''
  const cell: PrintCell = { text }
  if (col.key === 'name' && row && row.nameRuns.some((r) => r.b || r.r || r.hl)) cell.runs = row.nameRuns.map((r) => ({ ...r }))
  if (row?.cellStyle?.[col.key]?.hl) cell.hl = 1
  return cell
}

function printRowFrom(d: DisplayRow, columns: PrintColumn[], row: BillRow | undefined, kind: PrintRowKind): PrintRow {
  const cells: Record<string, PrintCell> = {}
  for (const c of columns) cells[c.key] = cellFor(c, d, row)
  return { kind, cells }
}

/** Footer total rows keep only the value cells (everything but the label, which moves to `label`). */
function totalRow(d: DisplayRow, kind: PrintRowKind, columns: PrintColumn[], rupeeOnTotal: boolean, bill: Bill): PrintRow {
  const cells: Record<string, PrintCell> = {}
  let lastKey = ''
  for (const c of columns) {
    if (c.key === 'name' || c.isExtra) continue
    const t = d.cells[c.key]
    if (t !== undefined && t !== '') { cells[c.key] = { text: t }; lastKey = c.key }
  }
  // The rupee sign goes on the final amount only (the rightmost value cell), never on the GST or pre-GST cells.
  if (kind === 'grandTotal' && rupeeOnTotal && lastKey !== '') cells[lastKey] = { text: rupee(cells[lastKey]!.text) }
  // Phase 81: the free extra-column cells of this total row (only for a total row that is actually shown, which is the only way we get here).
  const fk = footerKeyOfKind(kind)
  const free = fk ? bill.footerExtras?.[fk] : undefined
  if (free) for (const c of columns) if (c.isExtra) { const t = free[c.key]?.text ?? ''; if (t.trim() !== '') cells[c.key] = { text: t } }
  return { kind, label: d.cells['name'] ?? '', cells }
}

export function buildPrintModel(bill: Bill, mode: PrintMode, settings: PrintSettings, decision: PaperDecision): PrintModel {
  const format = resolveFormat(bill.formatId)
  const columns = buildPrintColumns(format, bill.extraCols)
  const totals = computeBill(format, bill.rows, getBillOptions(bill))
  const byId = new Map<string, BillRow>(bill.rows.map((r) => [r.id, r]))

  const body: PrintRow[] = []
  const footer: PrintRow[] = []
  for (const d of totals.display) {
    const row = d.rowId !== undefined ? byId.get(d.rowId) : undefined
    switch (d.kind) {
      case 'item':
      case 'partial':
        body.push(printRowFrom(d, columns, row, d.kind))
        break
      case 'blank':
        if (row && hasExtraText(row)) body.push(printRowFrom(d, columns, row, 'partial'))
        break
      case 'adjustment':
        footer.push(printRowFrom(d, columns, row, 'adjustment'))
        break
      case 'adjustmentsTotal':
        if (settings.hideAdjustmentsTotal === true) break
        footer.push(totalRow(d, d.kind, columns, settings.rupeeOnTotal, bill))
        break
      case 'itemsTotal':
      case 'roundOff':
      case 'grandTotal':
        footer.push(totalRow(d, d.kind, columns, settings.rupeeOnTotal, bill))
        break
    }
  }

  // Phase 81: tail rows. The count is the same number `computeBill` put into `counts.paperRows` (via `getBillOptions`), so the
  // paper engine and what prints cannot disagree.
  const tail: PrintRow[] = []
  const tailCount = totals.counts.paperRows - totals.counts.itemRows - totals.counts.adjustmentRows
  for (let i = 0; i < tailCount; i++) {
    const src = bill.tailRows?.[i]?.extras ?? {}
    const cells: Record<string, PrintCell> = {}
    for (const c of columns) cells[c.key] = { text: c.isExtra ? (src[c.key]?.text ?? '') : '' }
    tail.push({ kind: 'tail', cells })
  }

  const p = bill.party
  const party3 = { name: p.name.trim(), phone: p.phone.trim(), transport: p.transport.trim() }
  const header: PrintHeader =
    mode === 'rough'
      ? { kind: 'rough', party: party3 }
      : {
          kind: 'professional', company: resolveCompany(settings.company),
          party: { ...party3, address: p.address.trim() }, poNumber: bill.poNumber, billDate: formatPrintDate(bill.billDate)
        }

  return {
    version: 1, mode, paper: decision, formatId: format.id, header, columns, body, footer, tail,
    rowCount: totals.counts.paperRows
  }
}

/** Plain name of a printed body/footer row (tests and the preview's tooltip). */
export function printRowName(r: PrintRow): string {
  return r.cells['name']?.text ?? r.label ?? ''
}
