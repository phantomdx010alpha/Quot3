import { memo } from 'react'
import { useBillStore } from '../../stores/billStore'
import type { GridColumn } from '@shared/gridModel'
import { GridCell } from './GridCell'
import { renderProbe } from './renderProbe'

/** A body row. Subscribes only to its row kind, so cell edits never re-render the row shell. */
export const GridRow = memo(function GridRow({ rowId, columns, ariaRow }: { rowId: string; columns: readonly GridColumn[]; ariaRow: number }): React.JSX.Element {
  const kind = useBillStore((s) => s.view.body[rowId]?.kind ?? 'blank')
  if (renderProbe.enabled) renderProbe.rows.push(rowId)
  return (
    <div role="row" aria-rowindex={ariaRow} className={`q3-gr q3-gr--${kind}`} data-row-id={rowId} data-kind={kind}>
      {columns.map((c) => (
        <GridCell key={c.key} rowId={rowId} col={c} />
      ))}
    </div>
  )
})
