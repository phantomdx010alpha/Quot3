/**
 * summarizeUnits — EXTRA_COLS_UNITS_RULES.md §3–4. Derived from rows each time, never stored.
 * Rows are taken in array order. A marked cell starts a new segment; its own text is the label and
 * its own number is NOT counted (D-X1). Unparsed/blank cells contribute 0.
 */
import type { BillRow, Dec, ExtraCell, ExtraColDef, FooterExtraKey, FooterExtras, Id, TailRow } from '../types'
import { FOOTER_EXTRA_KEYS } from '../types'
import { D, toDec, type Decimal } from '../money'
import { classifyRow } from '../calc/classifyRow'
import { footerRowId, tailRowId } from '../freeCells'
import { parseUnits } from './parseUnits'

export interface MarkedSegment { label: string; rowId: Id; units: Dec }
export interface ColumnUnitsSummary {
  colKey: string
  header: string
  base: { label: string; units: Dec }
  marked: MarkedSegment[]
}
export interface UnitsSummary { byColumn: ColumnUnitsSummary[] }

/** Shown when a marked cell has no text. */
export const UNLABELLED_MARK = '(unlabelled)'

/** Phase 80: the free cells (total rows + tail rows). `footerKinds` = the footer rows actually shown (default: all three). */
export interface FreeUnitCells { footerExtras?: FooterExtras; tailRows?: readonly TailRow[]; footerKinds?: readonly FooterExtraKey[] }

interface SeqItem { id: Id; extras: Record<string, ExtraCell | undefined> }

/**
 * Cells in DISPLAY order so a segment "continues" through the total rows and the tail rows: item rows, Items total, adjustment
 * rows, Adjustments total, Final total, tail rows. With no free cells this is plain row-array order (the pre-Phase-80 behaviour).
 */
function sequence(rows: readonly BillRow[], free: FreeUnitCells | undefined): SeqItem[] {
  const hasFree = !!free && (Object.keys(free.footerExtras ?? {}).length > 0 || (free.tailRows?.length ?? 0) > 0)
  if (!hasFree || !free) return rows.map((r) => ({ id: r.id, extras: r.extras }))
  const kinds = free.footerKinds ?? FOOTER_EXTRA_KEYS
  const out: SeqItem[] = []
  const foot = (k: FooterExtraKey): void => { if (kinds.includes(k)) out.push({ id: footerRowId(k), extras: free.footerExtras?.[k] ?? {} }) }
  const adj = rows.filter((r) => classifyRow(r) === 'adjustment')
  for (const r of rows) if (classifyRow(r) !== 'adjustment') out.push({ id: r.id, extras: r.extras })
  foot('itemsTotal')
  for (const r of adj) out.push({ id: r.id, extras: r.extras })
  foot('adjustmentsTotal')
  foot('grandTotal')
  ;(free.tailRows ?? []).forEach((t, i) => out.push({ id: tailRowId(i), extras: t.extras }))
  return out
}

export function summarizeUnits(rows: readonly BillRow[], extraCols: readonly ExtraColDef[], free?: FreeUnitCells): UnitsSummary {
  const seq = sequence(rows, free)
  const byColumn = extraCols.map((col): ColumnUnitsSummary => {
    let baseTotal: Decimal = D(0)
    const marked: { label: string; rowId: Id; total: Decimal }[] = []
    for (const row of seq) {
      const cell = row.extras[col.key]
      if (cell?.marked) {
        marked.push({ label: cell.text.trim() || UNLABELLED_MARK, rowId: row.id, total: D(0) })
        continue
      }
      if (!cell) continue
      const p = parseUnits(cell.text)
      if (!p.parsed) continue
      const target = marked[marked.length - 1]
      if (target) target.total = target.total.plus(D(p.units))
      else baseTotal = baseTotal.plus(D(p.units))
    }
    return {
      colKey: col.key,
      header: col.header,
      base: { label: col.header, units: toDec(baseTotal) },
      marked: marked.map((m) => ({ label: m.label, rowId: m.rowId, units: toDec(m.total) }))
    }
  })
  return { byColumn }
}

/** Plain-text form for the popups' Ctrl+C (Phase 22 uses it). `view`: base totals or marked segments. */
export function unitsSummaryToText(summary: UnitsSummary, view: 'units' | 'marked'): string {
  const lines: string[] = []
  for (const c of summary.byColumn) {
    if (view === 'marked' && c.marked.length === 0) continue
    lines.push(`Column: ${c.header}`)
    if (view === 'units') lines.push(`  ${c.base.label} = ${c.base.units}`)
    else for (const m of c.marked) lines.push(`  ${m.label} = ${m.units}`)
  }
  return lines.join('\n')
}
