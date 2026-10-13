import { useMemo } from 'react'
import { summarizeUnits, unitsSummaryToText } from '@shared/units'
import { footerKeyOfKind } from '@shared/freeCells'
import type { FooterExtraKey } from '@shared/types'
import { Button, Dialog } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useExtraColUiStore } from '../../stores/extraColUiStore'
import { useGridUiStore } from '../../stores/gridUiStore'

/**
 * Phase 22 — Units summary (Ctrl+U: column header → total of its first segment) and Marked calculations (Ctrl+Shift+M: each marked
 * segment → total). Derived live from the open bill (never stored); Esc closes; Ctrl+C (or the Copy button) copies the shown text.
 */
function copyText(t: string): void {
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(t).catch(() => undefined)
}

export function UnitsPopup(): React.JSX.Element | null {
  const view = useExtraColUiStore((s) => s.units)
  const rows = useBillStore((s) => s.rows)
  const extraCols = useBillStore((s) => s.extraCols)
  // Phase 80: the total-row and tail-row cells continue the last segment (display order).
  const footerExtras = useBillStore((s) => s.footerExtras)
  const tailRows = useBillStore((s) => s.tailRows)
  const footer = useBillStore((s) => s.view.footer)
  const text = useMemo(() => {
    if (!view) return ''
    const footerKinds = footer.map((d) => footerKeyOfKind(d.kind)).filter((k): k is FooterExtraKey => k !== null)
    return unitsSummaryToText(summarizeUnits(rows, extraCols, { footerExtras, tailRows, footerKinds }), view)
  }, [view, rows, extraCols, footerExtras, tailRows, footer])
  if (!view) return null
  const close = (): void => { useExtraColUiStore.getState().closeUnits(); useGridUiStore.getState().refocus?.() }
  const empty = text === ''
  const emptyMsg = extraCols.length === 0 ? 'No extra columns. Add one with Ctrl+Alt+=.' : 'No marked cells. Select a cell in an extra column and press Ctrl+M.'
  return (
    <Dialog
      open title={view === 'units' ? 'Units summary' : 'Marked calculations'} onClose={close}
      footer={<><Button onClick={() => copyText(text)} disabled={empty}>Copy</Button><Button onClick={close}>Close</Button></>}
    >
      <pre
        className="q3-units" tabIndex={0} data-autofocus data-view={view} aria-label="Units"
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c' && window.getSelection()?.isCollapsed !== false) { e.preventDefault(); copyText(text) } }}
      >
        {empty ? <span className="q3-units__empty">{emptyMsg}</span> : text}
      </pre>
    </Dialog>
  )
}
