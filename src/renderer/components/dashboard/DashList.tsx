import { useState } from 'react'

export interface DashListProps<T extends { id: string }> {
  label: string
  items: readonly T[]
  empty: string
  /** Enter / double-click. */
  onOpen: (item: T) => void
  render: (item: T) => React.ReactNode
}

/** A short focusable list: Up / Down / Home / End move the highlight, Enter opens. One tab stop; Esc is left alone (it means Back). */
export function DashList<T extends { id: string }>({ label, items, empty, onOpen, render }: DashListProps<T>): React.JSX.Element {
  const [at, setAt] = useState(0)
  const i = Math.min(at, Math.max(0, items.length - 1))
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || items.length === 0) return
    const go = (n: number): void => { e.preventDefault(); setAt(Math.min(items.length - 1, Math.max(0, n))) }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[i]; if (it) onOpen(it) }
  }
  if (items.length === 0) return <p className="q3-dashlist__empty">{empty}</p>
  return (
    <div className="q3-dashlist" role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={`q3-dl-${label}-${items[i]!.id}`} onKeyDown={onKeyDown}>
      {items.map((it, n) => (
        <div
          key={it.id}
          id={`q3-dl-${label}-${it.id}`}
          role="option"
          aria-selected={n === i}
          className="q3-dashlist__row"
          onMouseDown={(e) => { e.preventDefault(); (e.currentTarget.parentElement as HTMLElement).focus(); setAt(n) }}
          onDoubleClick={() => onOpen(it)}
        >
          {render(it)}
        </div>
      ))}
    </div>
  )
}
