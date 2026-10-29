import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { allActions, primaryKeys, type ActionId } from '@shared/shortcuts'
import { searchActions } from '@shared/commandSearch'
import { Icon, Kbd } from '../ui'
import { useGamesStore } from '../../stores/gamesStore'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onRun: (id: ActionId) => void
}

/** Ctrl+K palette. The list is generated from ACTIONS; key hints from SHORTCUTS. */
export function CommandPalette({ open, onClose, onRun }: CommandPaletteProps): React.JSX.Element | null {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const gamesOn = useGamesStore((s) => s.enabled)
  // Phase 202: no "Go to Games" entry while Games is switched off.
  const results = useMemo(() => searchActions(query, allActions().filter((a) => gamesOn || a.id !== 'nav.games')), [query, gamesOn])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const opener = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    return () => opener?.focus?.()
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, results])

  if (!open) return null

  const run = (id: ActionId): void => {
    onClose()
    // Let focus return to the opener before the action may move it elsewhere.
    queueMicrotask(() => onRun(id))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = results[index]
      if (hit) run(hit.id)
    } else if (e.key === 'Tab') {
      e.preventDefault() // focus stays in the input; the list is driven by arrows
    }
  }

  return (
    <div className="q3-overlay q3-overlay--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="q3-palette nm-raised nm-lg" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="q3-palette__search">
          <Icon icon={MagnifyingGlass} />
          <input
            ref={inputRef}
            className="q3-palette__input"
            value={query}
            placeholder="Type a command…"
            role="combobox"
            aria-expanded="true"
            aria-controls="q3-palette-list"
            aria-activedescendant={results[index] ? `q3-cmd-${results[index].id}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
          />
        </div>
        <ul ref={listRef} id="q3-palette-list" className="q3-palette__list" role="listbox" aria-label="Commands">
          {results.map((a, i) => {
            const keys = primaryKeys(a.id)
            return (
              <li
                key={a.id}
                id={`q3-cmd-${a.id}`}
                role="option"
                aria-selected={i === index}
                className={`q3-palette__row${i === index ? ' q3-palette__row--active' : ''}`}
                onMouseMove={() => setIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(a.id)}
              >
                <span className="q3-palette__group">{a.group}</span>
                <span className="q3-palette__label">{a.label}</span>
                {keys && <Kbd keys={keys} />}
              </li>
            )
          })}
          {results.length === 0 && <li className="q3-palette__empty">No matching command</li>}
        </ul>
      </div>
    </div>
  )
}
