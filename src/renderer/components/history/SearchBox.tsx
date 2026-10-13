import { useEffect, useRef, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { Icon } from '../ui'

/** Pause after the last keystroke before the search runs (ms). */
export const SEARCH_DEBOUNCE_MS = 200

export interface SearchBoxProps {
  /** The query the store currently holds (the box follows it when it is cleared from elsewhere). */
  value: string
  onSearch: (query: string) => void
  /** Down / Enter in the box: go to the results. */
  onToResults: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
  from: string
  to: string
  onRange: (from: string, to: string) => void
  onClear: () => void
  fromRef: React.RefObject<HTMLInputElement | null>
  /** Esc in an empty box with no filter: leave the box. */
  onLeave: () => void
}

/** Phase 42: debounced search (party, bill no, item text, amount) and the From / To date range. Ctrl+F focuses the box. */
export function SearchBox({ value, onSearch, onToResults, inputRef, from, to, onRange, onClear, fromRef, onLeave }: SearchBoxProps): React.JSX.Element {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleared from outside (palette "Clear search", or picking a date): follow the store.
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value) } }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const push = (q: string, now: boolean): void => {
    if (timer.current) clearTimeout(timer.current)
    const run = (): void => { sent.current = q; onSearch(q) }
    if (now) run()
    else timer.current = setTimeout(run, SEARCH_DEBOUNCE_MS)
  }

  const keys = primaryKeys('history.search')
  const filtered = text !== '' || from !== '' || to !== ''

  return (
    <div className="q3-hist__tools" role="search">
      <label className="q3-hist__search nm-inset nm-sm">
        <Icon icon={MagnifyingGlass} weight="light" size="sm" />
        <input
          ref={inputRef}
          type="text"
          className="q3-hist__searchinput"
          value={text}
          placeholder={`Search party, bill no, item or amount${keys ? `  (${keys})` : ''}`}
          aria-label="Search bills"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setText(e.target.value); push(e.target.value, false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); push(text, true); onToResults() }
            else if (e.key === 'Escape') {
              e.preventDefault() // never also "Back": Esc first clears, then leaves the box
              if (text !== '') { setText(''); push('', true) } else onLeave()
            }
          }}
        />
      </label>
      <label className="q3-hist__range">
        <span>From</span>
        <input ref={fromRef} type="date" className="q3-input nm-inset nm-sm" aria-label="From date" value={from} max={to || undefined} onChange={(e) => onRange(e.target.value, to)} />
      </label>
      <label className="q3-hist__range">
        <span>To</span>
        <input type="date" className="q3-input nm-inset nm-sm" aria-label="To date" value={to} min={from || undefined} onChange={(e) => onRange(from, e.target.value)} />
      </label>
      <button
        type="button"
        className="q3-hist__refresh"
        disabled={!filtered}
        onClick={() => { setText(''); sent.current = ''; if (timer.current) clearTimeout(timer.current); onClear() }}
        aria-label="Clear search and date filter"
        title="Clear search and date filter (palette: Clear search and date filter)"
      >
        <Icon icon={X} weight="bold" size="sm" />
        <span>Clear</span>
      </button>
    </div>
  )
}
