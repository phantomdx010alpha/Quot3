import { useEffect, useId, useRef, useState } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import type { SearchHit } from '@shared/pricelist/search'
import { primaryKeys } from '@shared/shortcuts'
import { Icon } from '../ui'
import { jumpToHit, searchAll } from '../../stores/priceListTools'

const MIN = 2
const DEBOUNCE_MS = 250
const keep = (e: React.MouseEvent): void => e.preventDefault()

/**
 * Phase 252 (M24) - the Price List's ONE search: every tab, literal words (`shared/pricelist/search.ts`, the engine the old
 * "Search all" dialog used). The box and its results are LOCAL state: typing never touches the grid's cursor, the filter or the
 * store, so the box keeps focus however many letters are typed (the old "Filter this tab" box reset the grid cursor on every
 * letter and the grid took the focus). Down / Up move the highlight, Enter opens the highlighted result (the grid takes over),
 * Esc clears (a second Esc is the page's Back). The input element is owned by the page so the `pricelist.search` key can focus it.
 */
export function PriceSearchBox({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState(0)
  const [open, setOpen] = useState(false)
  const seq = useRef(0)
  const listId = useId()
  const optId = (i: number): string => `${listId}-o${i}`
  const short = q.trim().length < MIN

  useEffect(() => {
    const my = ++seq.current
    if (short) { setHits([]); setBusy(false); return }
    setBusy(true)
    const t = setTimeout(() => {
      void searchAll(q).then((h) => { if (my === seq.current) { setHits(h); setPick(0); setBusy(false) } }, () => { if (my === seq.current) { setHits([]); setBusy(false) } })
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, short])

  const clear = (): void => { seq.current++; setQ(''); setHits([]); setPick(0); setBusy(false); setOpen(false) }
  const go = (h: SearchHit | undefined): void => { if (!h) return; clear(); void jumpToHit(h) }
  const showList = open && !short && !busy && hits.length > 0
  const key = primaryKeys('pricelist.search')

  return (
    <div className="q3-plsrch">
      <label className="q3-hist__search nm-inset nm-sm">
        <Icon icon={MagnifyingGlass} weight="light" size="sm" />
        <input ref={inputRef} className="q3-hist__searchinput" role="combobox" aria-label="Search all tabs" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList ? optId(pick) : undefined} placeholder={`Search all tabs${key ? ` (${key})` : ''}`} value={q} autoComplete="off" spellCheck={false}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setOpen(true); setPick((p) => Math.min(p + 1, Math.max(0, hits.length - 1))) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setPick((p) => Math.max(p - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (showList) go(hits[pick]) }
            else if (e.key === 'Escape' && q !== '') { e.preventDefault(); e.stopPropagation(); clear() }
          }} />
        {q !== '' && <button type="button" className="q3-hist__refresh" aria-label="Clear search" onMouseDown={keep} onClick={() => { clear(); inputRef.current?.focus() }}><Icon icon={X} weight="bold" size="sm" /></button>}
      </label>
      <span className="q3-plsrch__note" role="status" aria-live="polite">
        {short ? '' : busy ? 'Searching...' : hits.length === 0 ? 'Nothing found.' : `${hits.length}${hits.length >= 100 ? '+' : ''} found`}
      </span>
      {showList && (
        <div id={listId} className="q3-plsearch q3-plsrch__list nm-raised nm-sm" role="listbox" aria-label="Search results">
          {hits.map((h, i) => (
            <div key={`${h.tabId}:${h.rowId}`} id={optId(i)} role="option" aria-selected={i === pick} className="q3-plsearch__hit" data-active={i === pick || undefined}
              onMouseDown={keep} onClick={() => go(h)}>
              <span className="q3-plsearch__name">{h.name === '' ? '(no name)' : h.name}</span>
              <span className="q3-plsearch__where">{h.tabName}{h.detail !== '' ? `  -  ${h.detail}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
