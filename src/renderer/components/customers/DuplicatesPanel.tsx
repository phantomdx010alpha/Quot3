import { useEffect, useRef } from 'react'
import { ArrowArcLeft, GitMerge, UsersThree, X } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { Button, Icon } from '../ui'
import { useDuplicatesStore } from '../../stores/duplicatesStore'

/**
 * Phase 137 - "Possible duplicates": customers whose names are similar but not equal. Nothing is merged unless the owner says so.
 * Keys: Up / Down / Home / End move, Enter or M merges, N = Not the same, Esc closes; Undo last merge has its own key.
 * The page-level handler owns the registered shortcuts; this panel only handles movement and Enter / Esc while it has focus.
 */
export function DuplicatesPanel(): React.JSX.Element | null {
  const open = useDuplicatesStore((s) => s.open)
  const status = useDuplicatesStore((s) => s.status)
  const error = useDuplicatesStore((s) => s.error)
  const items = useDuplicatesStore((s) => s.items)
  const index = useDuplicatesStore((s) => s.index)
  const busy = useDuplicatesStore((s) => s.busy)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) queueMicrotask(() => ref.current?.focus()) }, [open])

  if (!open) return null
  const st = useDuplicatesStore.getState
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); st().move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); st().move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); st().move('first') }
    else if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); st().move('last') }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void st().merge() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st().close() }
  }
  const none = status === 'ready' && items.length === 0

  return (
    <section className="q3-dup" aria-label="Possible duplicates">
      <header className="q3-dup__head">
        <Icon icon={UsersThree} weight="duotone" size="lg" />
        <h2 className="q3-dup__title">Possible duplicates</h2>
        <span className="q3-dup__count" aria-live="polite">{status === 'loading' ? 'Looking...' : `${items.length}${items.length >= 200 ? '+' : ''}`}</span>
        <Button size="sm" icon={ArrowArcLeft} shortcut={primaryKeys('customers.undoMerge') ?? ''} disabled={busy} onMouseDown={keep} onClick={() => { void st().undoLast() }}>Undo last merge</Button>
        <Button size="sm" icon={X} shortcut={primaryKeys('customers.duplicates') ?? ''} onMouseDown={keep} onClick={() => st().close()}>Close</Button>
      </header>
      {status === 'error' && <div className="q3-hist__error" role="alert">{error}</div>}
      <div ref={ref} className="q3-dup__list" role="listbox" aria-label="Possible duplicate customers" tabIndex={0} onKeyDown={onKeyDown} aria-activedescendant={items[index] ? `q3-dup-${index}` : undefined}>
        {none && <p className="q3-dup__empty">No similar names found. Customers with exactly the same name are combined automatically.</p>}
        {items.map((it, i) => (
          <div key={`${it.survivorId}|${it.mergedId}`} id={`q3-dup-${i}`} role="option" aria-selected={i === index} className="q3-dup__row" onClick={() => st().select(i)}>
            <span className="q3-dup__names">
              <strong className="q3-dup__keep" title="Kept">{it.survivor.name}</strong>
              <span className="q3-dup__bills">{it.survivor.billCount} {it.survivor.billCount === 1 ? 'bill' : 'bills'}</span>
              <Icon icon={GitMerge} weight="light" size="sm" />
              <span className="q3-dup__merge" title="Merged into the first">{it.merged.name}</span>
              <span className="q3-dup__bills">{it.merged.billCount} {it.merged.billCount === 1 ? 'bill' : 'bills'}</span>
            </span>
            <span className="q3-dup__why">{it.reason}</span>
          </div>
        ))}
      </div>
      <div className="q3-dup__actions">
        <Button size="sm" icon={GitMerge} shortcut={primaryKeys('customers.merge') ?? ''} disabled={busy || items.length === 0} onMouseDown={keep} onClick={() => { void st().merge() }}>Merge</Button>
        <Button size="sm" icon={X} shortcut={primaryKeys('customers.notSame') ?? ''} disabled={busy || items.length === 0} onMouseDown={keep} onClick={() => { void st().notSame() }}>Not the same</Button>
        <Button size="sm" disabled={busy} onMouseDown={keep} onClick={() => { void st().unify() }} title="Combine customers whose names are exactly equal">Combine equal names</Button>
      </div>
    </section>
  )
}
