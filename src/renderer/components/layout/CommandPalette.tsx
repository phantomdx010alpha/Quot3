import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { allActions, primaryKeys, type ActionId } from '@shared/shortcuts'
import { searchActions } from '@shared/commandSearch'
import { Icon, Kbd } from '../ui'
import { useGamesStore } from '../../stores/gamesStore'
import { useHistoryStore } from '../../stores/historyStore'
import { parseTyped } from '../../stores/sentenceSearch'
import { useRouter } from '../../router/routerStore'
import { ROUTES } from '@shared/routes'
import type { QueryChip } from '@shared/ai/sentenceQuery'

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
  // Phase 229 (M22): a typed sentence ("ruby tomato to Sharma last month") adds a "Search bills" row first; plain command text never does.
  const [sentence, setSentence] = useState<{ text: string; chips: QueryChip[] } | null>(null)
  useEffect(() => {
    let live = true
    setSentence(null)
    if (!open || query.trim().length < 3) return
    void parseTyped(query).then((t) => { if (live) setSentence(t ? { text: query.trim(), chips: t.parsed.chips } : null) })
    return () => { live = false }
  }, [open, query])
  const total = results.length + (sentence ? 1 : 0)
  const searchBills = (): void => {
    if (!sentence) return
    const text = sentence.text
    onClose()
    queueMicrotask(() => {
      // History opens on its own page memory; the sentence goes in the search box and the normal sentence search answers it.
      void useHistoryStore.getState().setQuery(text)
      useRouter.getState().navigate(ROUTES.history)
    })
  }

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
      setIndex((i) => (total === 0 ? 0 : (i + 1) % total))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (total === 0 ? 0 : (i - 1 + total) % total))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sentence && index === 0) { searchBills(); return }
      const hit = results[index - (sentence ? 1 : 0)]
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
            aria-activedescendant={sentence && index === 0 ? 'q3-cmd-search-bills' : results[index - (sentence ? 1 : 0)] ? `q3-cmd-${results[index - (sentence ? 1 : 0)]!.id}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
          />
        </div>
        <ul ref={listRef} id="q3-palette-list" className="q3-palette__list" role="listbox" aria-label="Commands">
          {sentence && (
            <li
              id="q3-cmd-search-bills"
              role="option"
              aria-selected={index === 0}
              className={`q3-palette__row${index === 0 ? ' q3-palette__row--active' : ''}`}
              onMouseMove={() => setIndex(0)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={searchBills}
            >
              <span className="q3-palette__group">Search bills</span>
              <span className="q3-palette__label">{sentence.chips.map((c) => c.label).join('  ·  ')}</span>
            </li>
          )}
          {results.map((r, j) => {
            const a = r
            const i = j + (sentence ? 1 : 0)
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
          {total === 0 && <li className="q3-palette__empty">No matching command</li>}
        </ul>
      </div>
    </div>
  )
}
