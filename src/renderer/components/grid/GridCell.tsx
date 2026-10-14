import { memo, useLayoutEffect, useRef } from 'react'
import { useTable } from './tableSide'
import type { GridColumn } from '@shared/gridModel'
import { renderProbe } from './renderProbe'
import { renderRuns } from './gridDom'
import { hasStyle } from '@shared/richtext/format'

/**
 * One body cell. Subscribes to exactly its own display string (row id + column key) — nothing else.
 * The text span has NO React children: its text is written imperatively (layout effect) so the grid controller can
 * make it contenteditable without React and the browser fighting over the same DOM nodes. While a cell is being
 * edited (`data-editing`) the effect leaves its text alone; the controller restores the display text on exit.
 */
export const GridCell = memo(function GridCell({ rowId, col }: { rowId: string; col: GridColumn }): React.JSX.Element {
  const text = useTable((s) => s.view.body[rowId]?.cells[col.key] ?? '')
  // Phase 13: manual-total marker. null = not overridden; string = the auto value for the tooltip ('' when none).
  const ovr = useTable((s) => {
    if (col.key !== 'total') return null
    const d = s.view.body[rowId]
    return d?.override ? (d.ovrAuto ?? '') : null
  })
  // Phase 15: item-name runs (same reference until that row's name changes → no extra renders for other edits).
  const runs = useTable((s) => (col.key === 'name' ? s.rows.find((r) => r.id === rowId)?.nameRuns ?? null : null))
  // Phase 22: a marked extra cell is a segment header (accent underline, see grid.css)
  const marked = useTable((s) => (col.isExtra ? !!s.rows.find((r) => r.id === rowId)?.extras[col.key]?.marked : false))
  const ref = useRef<HTMLSpanElement>(null)
  if (renderProbe.enabled) renderProbe.cells.push(`${rowId}:${col.key}`)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || el.dataset.editing === '1') return
    if (runs && hasStyle(runs)) renderRuns(el, runs)
    else if (el.textContent !== text || el.firstElementChild) el.textContent = text
    // Phase 23: the full text is always available as a tooltip (cells ellipsise; the active cell expands, see grid.css).
    if (text) el.title = text; else el.removeAttribute('title')
  }, [text, runs])
  return (
    <div role="gridcell" className={`q3-gc q3-gc--${col.align}`} data-col={col.key} data-nav={col.editable ? '1' : undefined}
      data-override={ovr !== null ? '1' : undefined} data-marked={marked ? '1' : undefined}
      data-neg={(col.key === 'total' || col.key === 'amount') && text.trim().startsWith('-') ? '1' : undefined}
      title={ovr === null ? undefined : ovr === '' ? 'Manual total. Ctrl+Backspace resets to auto.' : `Manual total (auto: ${ovr}). Ctrl+Backspace resets to auto.`}>
      <span ref={ref} className="q3-gc__text" tabIndex={col.editable ? -1 : undefined} spellCheck={false} />
    </div>
  )
})
