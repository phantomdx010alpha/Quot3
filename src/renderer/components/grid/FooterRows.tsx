import { memo } from 'react'
import { useBillStore } from '../../stores/billStore'
import type { GridColumn } from '@shared/gridModel'
import { GridRow } from './GridRow'
import { renderProbe } from './renderProbe'
import { FreeTotalRow } from './FreeCells'
import { footerKeyOfKind } from '@shared/freeCells'

/**
 * Footer rows in display order (items total, adjustments, adjustments total, round off, grand total). Total rows are
 * display-only; ADJUSTMENT rows (Phase 19) are real editable rows (same cells as the body, addressed by row id), so they
 * can be typed in place and are part of keyboard navigation. Re-renders when any footer value changes.
 */
export const FooterRows = memo(function FooterRows({ columns, firstAriaRow }: { columns: readonly GridColumn[]; firstAriaRow: number }): React.JSX.Element {
  const footer = useBillStore((s) => s.view.footer)
  const hasExtras = columns.some((c) => c.isExtra)
  if (renderProbe.enabled) renderProbe.footers++
  return (
    <>
      {footer.map((d, i) =>
        d.kind === 'adjustment' && d.rowId !== undefined ? (
          <GridRow key={`adj:${d.rowId}`} rowId={d.rowId} columns={columns} ariaRow={firstAriaRow + i} />
        ) : hasExtras && footerKeyOfKind(d.kind) ? (
          // Phase 80: the total rows carry editable extra-column cells.
          <FreeTotalRow key={`${d.kind}:free`} d={d} columns={columns} ariaRow={firstAriaRow + i} />
        ) : (
          <div key={`${d.kind}:${d.rowId ?? i}`} role="row" aria-rowindex={firstAriaRow + i} className={`q3-gr q3-gr--${d.kind}`} data-kind={d.kind}>
            {columns.map((c) => (
              <div key={c.key} role="gridcell" className={`q3-gc q3-gc--${c.align}`} data-col={c.key} data-neg={isNeg(c.key, d.cells[c.key]) ? '1' : undefined}>
                <span className="q3-gc__text">{d.cells[c.key] ?? ''}</span>
              </div>
            ))}
          </div>
        )
      )}
    </>
  )
})

const isNeg = (key: string, text: string | undefined): boolean => (key === 'total' || key === 'amount') && !!text && text.trim().startsWith('-')
