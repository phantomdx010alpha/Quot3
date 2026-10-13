import { useEffect, useRef } from 'react'
import { FORMAT_KINDS, FORMAT_LABELS, type FormatKind } from '@shared/richtext/format'
import { primaryKeys, type ActionId } from '@shared/shortcuts'
import { useGridUiStore } from '../../stores/gridUiStore'

const KEY_FOR: Partial<Record<FormatKind, ActionId>> = { redBold: 'grid.redBold', bold: 'grid.bold', highlight: 'grid.highlight', clear: 'grid.clearFormat' }

/**
 * Phase 15 — compact format palette (Ctrl+Shift+K). A small menu at the active name cell: Up/Down move, Enter picks,
 * 1–5 pick directly, Esc closes. It lives inside the grid root but is marked `data-q3-overlay`, so the grid controller
 * ignores its keystrokes. Picking applies the format to the selection captured when it opened, then focus returns to the cell.
 */
export function FormatPalette(): React.JSX.Element | null {
  const p = useGridUiStore((s) => s.formatPalette)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (p) first.current?.focus() }, [p])
  if (!p) return null

  const close = (): void => { useGridUiStore.getState().setFormatPalette(null); useGridUiStore.getState().refocus?.() }
  const pick = (kind: FormatKind): void => {
    const st = useGridUiStore.getState()
    st.setFormatPalette(null)
    st.format?.(kind, { start: p.start, end: p.end })
    st.refocus?.()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); return }
    if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); return }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); return }
    const n = Number(e.key)
    if (Number.isInteger(n) && n >= 1 && n <= FORMAT_KINDS.length) { e.preventDefault(); pick(FORMAT_KINDS[n - 1] as FormatKind) }
  }
  return (
    <div role="menu" aria-label="Format" className="q3-gmenu q3-fmtpal" data-q3-overlay="1" style={{ left: p.x, top: p.y }} onKeyDown={onKeyDown}>
      {FORMAT_KINDS.map((k, i) => (
        <button key={k} ref={i === 0 ? first : undefined} role="menuitem" type="button" className="q3-gmenu__item" onClick={() => pick(k)}>
          <span className={`q3-fmtpal__swatch q3-fmtpal__swatch--${k}`} aria-hidden="true">Ab</span>
          <span className="q3-fmtpal__label">{FORMAT_LABELS[k]}</span>
          <kbd>{KEY_FOR[k] ? primaryKeys(KEY_FOR[k] as ActionId) : String(i + 1)}</kbd>
        </button>
      ))}
    </div>
  )
}
