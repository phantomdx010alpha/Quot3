import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { resolveFormat } from '@shared/format/registry'
import { buildGridColumns, gridTemplateColumns } from '@shared/gridModel'
import { applyColWidths, stickyOffsets } from '@shared/columnWidths'
import { useColWidthStore } from '../../stores/columnWidthStore'
import { useBillStore } from '../../stores/billStore'
import { ColumnHeader } from './ColumnHeader'
import { FooterRows } from './FooterRows'
import { GridRow } from './GridRow'
import { renderProbe } from './renderProbe'
import { GridController } from './gridController'
import { FormatPalette } from './FormatPalette'
import { TailRows } from './FreeCells'
import { useGridUiStore } from '../../stores/gridUiStore'
import { tableApi, type TableSide } from '../../stores/tableApi'
import { TableSideContext, useTableOfSide } from './tableSide'

/**
 * Bill grid (Phase 9 render; Phase 11 keyboard/edit pipeline): columns from the active format's registry entry + the bill's extra columns, body
 * rows from the derived display model, footer rows after the body. Flat, dense, sticky header; scrolls inside itself.
 * Editing: Phase 11 (modes + commit), Phases 12–13 (numeric rules, auto-calc/override).
 */
export function BillGrid({ label = 'Bill items', side = 'primary' }: { label?: string; side?: TableSide }): React.JSX.Element {
  // Phase 151: `side` picks the table: the bill itself (default) or the Hybrid second table. Both share the extra columns, column widths
  // are per layout (format id), the shared tail rows hang under the primary table only.
  // The grid root renders the context Provider itself, so its own subscriptions name the side explicitly (context would still say 'primary').
  const formatId = useTableOfSide(side, (s) => s.formatId)
  const extraCols = useTableOfSide(side, (s) => s.extraCols)
  const bodyIds = useTableOfSide(side, (s) => s.view.bodyIds)
  const footerCount = useTableOfSide(side, (s) => s.view.footer.length)
  // Phase 80: tail rows below the Final total (only when extra columns exist) count towards aria-rowcount.
  const tailStored = useBillStore((s) => s.tailRows?.length ?? 0)
  const tailShown = useGridUiStore((s) => s.tailShown)
  const billId = useBillStore((s) => s.billId)
  useEffect(() => { useGridUiStore.getState().setTailShown(0) }, [billId])
  if (renderProbe.enabled) renderProbe.grids++

  const widths = useColWidthStore((s) => s.overrides[formatId])
  useEffect(() => { void useColWidthStore.getState().load() }, [])
  const columns = useMemo(() => applyColWidths(buildGridColumns(resolveFormat(formatId), extraCols), widths), [formatId, extraCols, widths])
  const template = useMemo(() => gridTemplateColumns(columns), [columns])
  // Phase 23: Sl.No and Item Name stay pinned while the grid scrolls sideways; Item Name's offset = Sl.No's width.
  const sticky = useMemo(() => stickyOffsets(columns), [columns])
  const style = { '--q3-grid-cols': template, '--q3-sticky-name-left': `${sticky.name ?? 0}px` } as CSSProperties
  const tailCount = extraCols.length > 0 && side === 'primary' ? Math.max(tailStored + 1, tailShown) : 0
  const rootRef = useRef<HTMLDivElement>(null)
  // Phase 13: context action on an overridden Total cell → "Reset to auto total".
  const [menu, setMenu] = useState<{ x: number; y: number; rowId: string } | null>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const closeMenu = useCallback(() => { setMenu(null); rootRef.current?.focus({ preventScroll: true }) }, [])
  const onContextMenu = (e: React.MouseEvent): void => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.q3-gc[data-col="total"][data-override]')
    const rowId = cell?.parentElement?.dataset.rowId
    if (!cell || !rowId) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, rowId })
  }
  useEffect(() => { if (menu) menuBtn.current?.focus() }, [menu])

  // Phase 11: one event pipeline on the grid root (keydown/beforeinput/mouse/focus) → pure nav reducer → DOM.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return new GridController(el, side).attach()
  }, [side])

  return (
    <TableSideContext.Provider value={side}>
    <div ref={rootRef} className="q3-grid" role="grid" tabIndex={0} aria-label={label} aria-rowcount={bodyIds.length + footerCount + tailCount + 1} aria-colcount={columns.length} style={style} onContextMenu={onContextMenu}>
      <div className="q3-grid__inner">
        <ColumnHeader columns={columns} />
        {bodyIds.map((id, i) => (
          <GridRow key={id} rowId={id} columns={columns} ariaRow={i + 2} />
        ))}
        <FooterRows columns={columns} firstAriaRow={bodyIds.length + 2} />
        {side === 'primary' && <TailRows columns={columns} firstAriaRow={bodyIds.length + footerCount + 2} />}
      </div>
      {side === 'primary' && <FormatPalette />}
      {menu && (
        <div
          role="menu" className="q3-gmenu" style={{ left: menu.x, top: menu.y }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu() } }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(null) }}
        >
          <button ref={menuBtn} role="menuitem" type="button" className="q3-gmenu__item"
            onClick={() => { tableApi(side).resetTotal(menu.rowId); closeMenu() }}>
            Reset to auto total <kbd>Ctrl+Backspace</kbd>
          </button>
        </div>
      )}
    </div>
    </TableSideContext.Provider>
  )
}
