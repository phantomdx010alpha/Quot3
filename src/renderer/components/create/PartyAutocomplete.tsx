import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { PARTY_FIELD_LABEL } from '@shared/partyFields'
import { normalizePartyName, type PartyLite } from '@shared/party/partyLite'
import { usePartyIndexStore } from '../../stores/partyIndexStore'

interface Props {
  value: string
  inputRef: (el: HTMLInputElement | null) => void
  onValueChange: (value: string) => void
  /** A suggestion was chosen (Enter on the highlighted row, or a click). */
  onPick: (party: PartyLite) => void
  /** Every key the list did not consume goes to the bar's own field flow (Tab / Enter / Right / undo …). */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onFocus: () => void
  className?: string
}

/**
 * Phase 26 — the Party name field with fuzzy suggestions. Typing a name that matches nothing is simply a NEW party:
 * no list, and Right / Tab / Enter continue to the optional fields as before. With a list open: Up/Down highlight,
 * Enter picks the highlighted row (Enter with nothing highlighted keeps the typed name and moves on), Esc closes the
 * list ONLY (it is consumed here so it does not reach page navigation), clicking a row picks it. Searching is local
 * (`partyIndexStore`), never IPC.
 */
export function PartyAutocomplete({ value, inputRef, onValueChange, onPick, onKeyDown, onFocus, className = '' }: Props): React.JSX.Element {
  const index = usePartyIndexStore((s) => s.index)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLUListElement | null>(null)

  const results = useMemo(() => index.search(value), [index, value])
  // Nothing to offer when the only match is exactly what is already typed.
  const only = results.length === 1 ? results[0] : undefined
  const show = open && results.length > 0 && !(only && normalizePartyName(only.name) === normalizePartyName(value))
  const activeId = show && active >= 0 ? `${listId}-o${active}` : undefined

  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const pick = (p: PartyLite): void => { setOpen(false); setActive(-1); onPick(p) }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
    if (plain && e.key === 'ArrowDown' && results.length > 0 && value.trim() !== '') {
      e.preventDefault()
      if (!show) { setOpen(true); setActive(0) } else setActive((i) => (i + 1) % results.length)
      return
    }
    if (show) {
      if (plain && e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); return }
      if (plain && e.key === 'Enter' && active >= 0) {
        const p = results[active]
        if (p) { e.preventDefault(); pick(p); return }
      }
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); setOpen(false); setActive(-1); return }
    }
    onKeyDown(e)
  }

  return (
    <label className={`q3-pbar__f ${className}`.trim()}>
      <span className="q3-pbar__l">{PARTY_FIELD_LABEL.name}</span>
      <input
        ref={inputRef} className="q3-input q3-pbar__in" type="text" value={value} autoComplete="off" spellCheck={false}
        data-party-field="name" role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={listId}
        {...(activeId ? { 'aria-activedescendant': activeId } : {})}
        onFocus={onFocus}
        onChange={(e) => { onValueChange(e.target.value); setOpen(true); setActive(-1) }}
        onKeyDown={handleKey}
        onBlur={() => { setOpen(false); setActive(-1) }}
      />
      {show ? (
        <ul className="q3-pac" id={listId} role="listbox" aria-label="Matching parties" ref={listRef}>
          {results.map((p, i) => (
            <li
              key={p.id} id={`${listId}-o${i}`} role="option" aria-selected={i === active} data-index={i} data-active={i === active ? '1' : undefined}
              className="q3-pac__o"
              onMouseDown={(e) => { e.preventDefault(); pick(p) }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="q3-pac__n">{p.name}</span>
              <span className="q3-pac__m">{[p.phone, p.transport].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  )
}
