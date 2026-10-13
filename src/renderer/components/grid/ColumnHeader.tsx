import { memo, useEffect, useRef } from 'react'
import type { GridColumn } from '@shared/gridModel'
import { MAX_EXTRA_HEADER_LEN } from '@shared/extraCols'
import { MIN_COL_WIDTH_PX } from '@shared/columnWidths'
import { useColWidthStore } from '../../stores/columnWidthStore'
import { useBillStore } from '../../stores/billStore'
import { useExtraColUiStore } from '../../stores/extraColUiStore'
import { commitRenameExtraCol, requestRenameExtraCol } from '../../stores/extraColActions'
import { renderProbe } from './renderProbe'

/**
 * Phase 21: an extra column's header is renamed in place — double-click, or Ctrl+Alt+R / the palette. It is a single-line
 * input (ellipsis while not focused; the full text is scrollable on focus), Enter / blur commits, Esc cancels. The grid
 * controller ignores events from `.q3-gh__input` so typing, copy and paste stay native here.
 */
function HeaderEditor({ col }: { col: GridColumn }): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const finish = (text: string | null): void => {
    if (done.current) return
    done.current = true
    commitRenameExtraCol(col.key, text)
  }
  return (
    <input
      ref={ref} className="q3-gh__input" type="text" defaultValue={col.label} maxLength={MAX_EXTRA_HEADER_LEN} spellCheck={false}
      aria-label={`Rename column ${col.label}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value) }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null) }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

/** Drag handle on a header's right edge: drag = resize (live), double-click = back to the default width. Mouse only; the keyboard path is Ctrl+Alt+] / [ and the palette. */
function startResize(e: React.MouseEvent<HTMLElement>, key: string): void {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const cell = (e.currentTarget as HTMLElement).parentElement as HTMLElement
  const startX = e.clientX
  const startW = cell.getBoundingClientRect().width || MIN_COL_WIDTH_PX
  const formatId = useBillStore.getState().formatId
  const move = (ev: MouseEvent): void => useColWidthStore.getState().set(formatId, key, startW + (ev.clientX - startX))
  const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

export const ColumnHeader = memo(function ColumnHeader({ columns }: { columns: readonly GridColumn[] }): React.JSX.Element {
  if (renderProbe.enabled) renderProbe.headers++
  const renameKey = useExtraColUiStore((s) => s.renameKey)
  return (
    <div role="row" aria-rowindex={1} className="q3-gh">
      {columns.map((c) => (
        <div key={c.key} role="columnheader" className={`q3-gh__cell q3-gc--${c.align}${c.isExtra ? ' q3-gh__cell--extra' : ''}`} title={c.label} data-col={c.key}
          onDoubleClick={c.isExtra ? () => requestRenameExtraCol(c.key) : undefined}>
          {c.isExtra && renameKey === c.key ? <HeaderEditor col={c} /> : <span className="q3-gc__text">{c.label}</span>}
          <span className="q3-gh__resize" role="separator" aria-orientation="vertical" aria-label={`Resize column ${c.label}`} data-resize={c.key}
            onMouseDown={(e) => startResize(e, c.key)}
            onDoubleClick={(e) => { e.stopPropagation(); useColWidthStore.getState().reset(useBillStore.getState().formatId, c.key) }} />
        </div>
      ))}
    </div>
  )
})
