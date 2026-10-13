import { useEffect, useRef } from 'react'
import { formatHistoryDate, isListKey, moveListIndex, type HistoryDate } from '@shared/history/historyList'

export interface DatesPanelProps {
  dates: readonly HistoryDate[]
  selected: string | null
  onSelect: (date: string) => void
  /** Enter / Right: hand focus to the bill list. */
  onEnter: () => void
  panelRef: React.RefObject<HTMLDivElement | null>
}

/** Left panel: `Date | Bills`, newest first. The highlight IS the selection (Up/Down load that day's bills). */
export function DatesPanel({ dates, selected, onSelect, onEnter, panelRef }: DatesPanelProps): React.JSX.Element {
  const index = dates.findIndex((d) => d.date === selected)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (isListKey(e.key)) {
      e.preventDefault()
      const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 260) / 26) - 1)
      const next = moveListIndex(index, dates.length, e.key, page)
      const d = dates[next]
      if (d) onSelect(d.date)
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault()
      onEnter()
    }
  }

  return (
    <section className="q3-hist__dates" aria-label="Dates">
      <h2 className="q3-hist__paneltitle">Dates</h2>
      <div className="q3-hist__thead" aria-hidden="true">
        <span>Date</span>
        <span className="q3-hist__num">Bills</span>
      </div>
      <div
        ref={(el) => { listRef.current = el; (panelRef as { current: HTMLDivElement | null }).current = el }}
        className="q3-hist__datelist"
        role="listbox"
        aria-label="Bill dates, newest first"
        tabIndex={0}
        aria-activedescendant={selected ? `q3-hd-${selected}` : undefined}
        onKeyDown={onKeyDown}
      >
        {dates.map((d) => (
          <div
            key={d.date}
            id={`q3-hd-${d.date}`}
            role="option"
            aria-selected={d.date === selected}
            className="q3-hist__daterow"
            onMouseDown={(e) => { e.preventDefault(); listRef.current?.focus(); onSelect(d.date) }}
          >
            <span>{formatHistoryDate(d.date)}</span>
            <span className="q3-hist__num">{d.count}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
