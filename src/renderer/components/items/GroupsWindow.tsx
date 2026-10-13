import { useLayoutEffect, useRef } from 'react'
import { visibleRange, scrollTopFor } from '@shared/items/windowing'
import { rowIndexOfGroup, type GroupRow } from '@shared/items/groupRows'
import { useScrollView } from './useScrollView'
import { formatHistoryDate } from '@shared/history/historyList'

export const ITEMS_ROW_PX = 26

export interface GroupsWindowProps {
  rows: readonly GroupRow[]
  selectedId: string | null
  /** The item marked for a merge / the item a spelling is moving out of (outlined). */
  markedId: string | null
  emptyText: string
  /** The scrolling element (the window's focusable content div). */
  getScroll: () => HTMLElement | null
  onSelect: (id: string) => void
}

const OVERSCAN = 12

/**
 * Phase 113 - Window 1: families -> variants, windowed (only the visible rows are in the DOM). Keys are handled by `windowKeys.ts`.
 * Phase 117: own windowing on the ONE scrolling element (the frame's content div) - plain rows between two spacers, no absolute
 * positions or transforms, no library measuring a different element. The viewport is re-read on scroll, resize and row changes.
 */
export function GroupsWindow({ rows, selectedId, markedId, emptyText, getScroll, onSelect }: GroupsWindowProps): React.JSX.Element {
  const scrollRef = useRef(getScroll)
  scrollRef.current = getScroll
  const view = useScrollView(getScroll, rows.length)
  const readView = view.read
  const index = rowIndexOfGroup(rows, selectedId)
  useLayoutEffect(() => {
    const el = scrollRef.current()
    if (!el || index < 0) return
    const next = scrollTopFor(index, ITEMS_ROW_PX, el.scrollTop, el.clientHeight, rows.length)
    if (next !== el.scrollTop) el.scrollTop = next
    readView()
  }, [index, rows.length])

  if (rows.length === 0) return <div className="q3-items__note">{emptyText}</div>
  const { start, end } = visibleRange(rows.length, ITEMS_ROW_PX, view.top, view.h, OVERSCAN)
  const rowStyle = { height: ITEMS_ROW_PX } as const
  const out: React.ReactNode[] = []
  for (let i = start; i < end; i++) {
    const r = rows[i]
    if (!r) continue
    if (r.kind === 'family') {
      out.push(
        <div key={r.key} role="row" aria-rowindex={i + 1} className="q3-items__row q3-items__row--family" style={rowStyle}>
          <span role="gridcell" title={r.name}>{r.name}</span>
          <span role="gridcell" className="q3-items__num" title="Sales of all its items">{r.count}</span>
          <span role="gridcell" />
        </div>
      )
      continue
    }
    const g = r.group
    out.push(
      <div
        key={r.key}
        id={`q3-ig-${g.id}`}
        role="row"
        aria-rowindex={i + 1}
        aria-selected={g.id === selectedId}
        className={`q3-items__row q3-items__row--group${i % 2 === 1 ? ' q3-items__row--alt' : ''}${g.id === markedId ? ' q3-items__row--mark' : ''}`}
        style={rowStyle}
        onMouseDown={(e) => { e.preventDefault(); getScroll()?.focus(); onSelect(g.id) }}
      >
        <span role="gridcell" title={g.display}>{g.display}</span>
        <span role="gridcell" className="q3-items__num" title={`Sold ${g.count} times${g.gstCount > 0 ? ` (${g.gstCount} on GST bills)` : ''}`}>{g.count}</span>
        <span role="gridcell" className="q3-items__num q3-items__muted" title={g.suggestionCount > 0 ? `${g.suggestionCount} suggested merge(s)` : g.lastUsed ? `Last sold ${formatHistoryDate(g.lastUsed)}` : ''}>
          {g.suggestionCount > 0 ? `${g.suggestionCount} sugg.` : g.lastUsed ? formatHistoryDate(g.lastUsed) : ''}
        </span>
      </div>
    )
  }
  return (
    <div role="grid" aria-label="Items by family" aria-rowcount={rows.length} aria-activedescendant={selectedId ? `q3-ig-${selectedId}` : undefined}>
      <div aria-hidden="true" style={{ height: start * ITEMS_ROW_PX }} />
      {out}
      <div aria-hidden="true" style={{ height: (rows.length - end) * ITEMS_ROW_PX }} />
    </div>
  )
}
