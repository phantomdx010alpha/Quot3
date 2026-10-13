import { memo, useLayoutEffect, useRef } from 'react'
import type { DisplayRow } from '@shared/calc/billTotals'
import type { GridColumn } from '@shared/gridModel'
import { footerKeyOfKind, footerRowId, getFreeCell, tailRowId } from '@shared/freeCells'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { renderProbe } from './renderProbe'

/**
 * Phase 80 - free extra-column cells (M8 section 7): editable extra cells on the Items total / Adjustments total / Final total
 * (or single Total) rows, and unlimited extra-only tail rows below the Final total. Same span contract as `GridCell`: the text
 * span has NO React children, its text is written imperatively and left alone while the grid controller is editing it.
 * The other columns of these rows are read-only but navigable, so the keyboard stays on one rectangular grid.
 */

/** An extra-column cell of a total row or a tail row. Subscribes to exactly its own stored cell. */
export const FreeCell = memo(function FreeCell({ rowId, col }: { rowId: string; col: GridColumn }): React.JSX.Element {
  const cell = useBillStore((s) => getFreeCell(s.footerExtras, s.tailRows, rowId, col.key))
  const text = cell?.text ?? ''
  const marked = !!cell?.marked
  const ref = useRef<HTMLSpanElement>(null)
  if (renderProbe.enabled) renderProbe.cells.push(`${rowId}:${col.key}`)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || el.dataset.editing === '1') return
    if (el.textContent !== text) el.textContent = text
    if (text) el.title = text; else el.removeAttribute('title')
  }, [text])
  return (
    <div role="gridcell" className={`q3-gc q3-gc--${col.align}`} data-col={col.key} data-nav="1" data-extra="1" data-marked={marked ? '1' : undefined}>
      <span ref={ref} className="q3-gc__text" tabIndex={-1} spellCheck={false} />
    </div>
  )
})

/** A non-extra cell of a free row: read-only, shows the row's own display text ('' on a tail row). */
const ReadOnlyCell = memo(function ReadOnlyCell({ col, text }: { col: GridColumn; text: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || el.dataset.editing === '1') return
    if (el.textContent !== text) el.textContent = text
  }, [text])
  const neg = (col.key === 'total' || col.key === 'amount') && text.trim().startsWith('-')
  return (
    <div role="gridcell" className={`q3-gc q3-gc--${col.align}`} data-col={col.key} data-nav={col.editable ? '1' : undefined} data-neg={neg ? '1' : undefined}>
      <span ref={ref} className="q3-gc__text" tabIndex={col.editable ? -1 : undefined} spellCheck={false} />
    </div>
  )
})

/** A total row (Items total / Adjustments total / Final total) that also carries editable extra cells. */
export function FreeTotalRow({ d, columns, ariaRow }: { d: DisplayRow; columns: readonly GridColumn[]; ariaRow: number }): React.JSX.Element {
  const key = footerKeyOfKind(d.kind)
  const rowId = key ? footerRowId(key) : `${d.kind}`
  return (
    <div role="row" aria-rowindex={ariaRow} className={`q3-gr q3-gr--${d.kind}`} data-kind={d.kind} data-row-id={rowId}>
      {columns.map((c) => (c.isExtra ? <FreeCell key={c.key} rowId={rowId} col={c} /> : <ReadOnlyCell key={c.key} col={c} text={d.cells[c.key] ?? ''} />))}
    </div>
  )
}

/** Unlimited extra-only rows below the Final total: every stored one plus one blank entry row (display padding, never saved). */
export const TailRows = memo(function TailRows({ columns, firstAriaRow }: { columns: readonly GridColumn[]; firstAriaRow: number }): React.JSX.Element | null {
  const stored = useBillStore((s) => s.tailRows?.length ?? 0)
  const shown = useGridUiStore((s) => s.tailShown)
  if (!columns.some((c) => c.isExtra)) return null
  const n = Math.max(stored + 1, shown)
  const rows: React.JSX.Element[] = []
  for (let i = 0; i < n; i++) {
    const id = tailRowId(i)
    rows.push(
      <div key={id} role="row" aria-rowindex={firstAriaRow + i} className="q3-gr q3-gr--tail" data-kind="tail" data-row-id={id}>
        {columns.map((c) => (c.isExtra ? <FreeCell key={c.key} rowId={id} col={c} /> : <ReadOnlyCell key={c.key} col={c} text="" />))}
      </div>
    )
  }
  return <>{rows}</>
})
