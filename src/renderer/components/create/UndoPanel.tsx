import { useEffect, useRef } from 'react'
import { buildHistoryRows, formatClock } from '@shared/history/historyView'
import { primaryKeys } from '@shared/shortcuts'
import { Kbd } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { useUndoUiStore } from '../../stores/undoUiStore'
import { runJump } from '../../stores/undoActions'

/**
 * Phase 18 — undo history panel (Ctrl+Shift+H), UNDO_REDO_RULES §2.6. A compact flyout listing the labelled entries,
 * newest first, ending with the original state. Up/Down/Home/End move, Enter (or click) jumps the bill to that state
 * (the redo entries are kept), Esc closes and returns focus to the grid. Not modal: the bill stays visible.
 */
export function UndoPanel(): React.JSX.Element | null {
  const open = useUndoUiStore((s) => s.panelOpen)
  useBillStore((s) => s.historyVersion) // re-render on every history change
  const ref = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef(false)

  const st = useBillStore.getState()
  const rows = open ? buildHistoryRows(st.historyList(), st.historyCursor()) : []

  const focusCurrent = (): void => { ref.current?.querySelector<HTMLElement>('[data-current="1"]')?.focus() }
  useEffect(() => {
    if (!open) return
    focusCurrent()
    return () => {
      // Closing: if focus was inside the panel (or lost), hand it back to the grid.
      const a = document.activeElement
      if (!a || a === document.body || ref.current?.contains(a)) useGridUiStore.getState().refocus?.()
    }
  }, [open])
  useEffect(() => { if (open && pendingFocus.current) { pendingFocus.current = false; focusCurrent() } })

  if (!open) return null

  const close = (): void => useUndoUiStore.getState().closePanel()
  const jump = (index: number): void => { pendingFocus.current = true; runJump(index) }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-index]')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Enter' && i >= 0) { e.preventDefault(); jump(Number(items[i]!.dataset.index)); return } // handled here so the click that Enter would fire does not jump twice
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
  }
  const keys = primaryKeys('edit.historyPanel')

  return (
    <div ref={ref} className="q3-upanel" role="dialog" aria-label="Undo history" data-q3-overlay="1" onKeyDown={onKeyDown}>
      <div className="q3-upanel__head">
        <strong>Undo history</strong>
        {keys ? <Kbd keys={keys} /> : null}
      </div>
      <div className="q3-upanel__list" role="list">
        {rows.map((r) => (
          <button
            key={r.index}
            type="button"
            role="listitem"
            className={`q3-upanel__row q3-upanel__row--${r.state}`}
            data-index={r.index}
            data-state={r.state}
            {...(r.state === 'current' ? { 'data-current': '1', 'aria-current': 'step' as const } : {})}
            onClick={() => jump(r.index)}
          >
            <span className="q3-upanel__label">{r.label}</span>
            <span className="q3-upanel__meta">{r.state === 'undone' ? 'undone' : r.at !== null ? formatClock(r.at) : ''}</span>
          </button>
        ))}
      </div>
      <div className="q3-upanel__foot">Enter jumps to that state · Esc closes</div>
    </div>
  )
}
