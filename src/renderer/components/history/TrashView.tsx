import { useEffect } from 'react'
import { ArrowLeft, ArrowCounterClockwise, Trash, TrashSimple } from '@phosphor-icons/react'
import { formatHistoryDate, formatHistoryTotal, isListKey, moveListIndex } from '@shared/history/historyList'
import { formatDeletedAt, formatPurgeIn, type TrashItem } from '@shared/trash'
import { primaryKeys } from '@shared/shortcuts'
import { Button, EmptyState, Icon } from '../ui'

export interface TrashViewProps {
  items: readonly TrashItem[]
  selectedId: string | null
  selection: ReadonlySet<string>
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  retentionDays: number
  onSelect: (id: string) => void
  onExtend: (id: string) => void
  onToggle: (id: string) => void
  onSelectAll: () => void
  onRestore: () => void
  onPurge: () => void
  onEmpty: () => void
  onBack: () => void
  listRef: React.RefObject<HTMLDivElement | null>
}

const keep = (e: React.MouseEvent): void => e.preventDefault()
const key = (a: Parameters<typeof primaryKeys>[0]): { shortcut: string } | Record<string, never> => { const v = primaryKeys(a); return v ? { shortcut: v } : {} }

/**
 * Phase 43 - Recently deleted. Replaces the Dates + Bills panels. Enter = Restore, Delete = Delete forever (asks first),
 * Ctrl+Shift+Delete = Empty trash (typed confirmation), Esc / Ctrl+Shift+D = back to the bills. Few rows by nature (30-day retention), so no virtualisation.
 */
export function TrashView(p: TrashViewProps): React.JSX.Element {
  const { items, selectedId, selection, listRef } = p
  const index = items.findIndex((b) => b.id === selectedId)
  const now = new Date()
  useEffect(() => { listRef.current?.querySelector(`#q3-ht-${CSS.escape(selectedId ?? '')}`)?.scrollIntoView?.({ block: 'nearest' }) }, [selectedId, listRef])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.metaKey) return
    if (e.ctrlKey) {
      if (!e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); p.onSelectAll() }
      return
    }
    if (isListKey(e.key)) {
      e.preventDefault()
      const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 260) / 26) - 1)
      const b = items[moveListIndex(index, items.length, e.key, page)]
      if (b) { if (e.shiftKey) p.onExtend(b.id); else p.onSelect(b.id) }
    } else if (e.key === ' ') {
      e.preventDefault()
      const b = items[index]
      if (b) p.onToggle(b.id)
    } else if (e.key === 'Enter') { e.preventDefault(); p.onRestore() }
    else if (e.key === 'Delete') { e.preventDefault(); p.onPurge() }
  }

  const count = selection.size > 0 ? selection.size : selectedId === null ? 0 : 1
  const none = count === 0
  const rows = (
    <div className="q3-hist__trashbody">
      {items.map((b, i) => (
        <div
          key={b.id}
          id={`q3-ht-${b.id}`}
          role="row"
          aria-rowindex={i + 1}
          aria-selected={b.id === selectedId || selection.has(b.id)}
          aria-current={b.id === selectedId ? 'true' : undefined}
          className="q3-hist__billrow q3-hist__trashcols"
          style={{ height: 'var(--row-height)' }}
          onMouseDown={(e) => {
            e.preventDefault()
            listRef.current?.focus()
            if (e.shiftKey) p.onExtend(b.id)
            else if (e.ctrlKey) p.onToggle(b.id)
            else p.onSelect(b.id)
          }}
          onDoubleClick={p.onRestore}
        >
          <span role="gridcell">{b.poNumber}</span>
          <span role="gridcell">{formatHistoryDate(b.billDate)}</span>
          <span role="gridcell" className="q3-hist__party" title={b.partyName}>{b.partyName || '—'}</span>
          <span role="gridcell" className="q3-hist__num">{formatHistoryTotal(b.grandTotal)}</span>
          <span role="gridcell">{formatDeletedAt(b.deletedAt)}</span>
          <span role="gridcell">{formatPurgeIn(b.purgeAt, now)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div className="q3-hist__trash">
      <div className="q3-hist__trashhead">
        <Icon icon={TrashSimple} weight="duotone" />
        <strong>Recently deleted</strong>
        <span className="q3-hist__trashnote">{items.length} {items.length === 1 ? 'bill' : 'bills'} - purged for good after {p.retentionDays} days. Restoring keeps the bill number.</span>
      </div>
      {p.status === 'error' && <div className="q3-hist__error" role="alert">{p.error}</div>}
      {items.length === 0 && p.status !== 'loading' ? (
        <EmptyState icon={TrashSimple} title="Nothing deleted" description="Bills you delete from History wait here for restoring. Press Esc to go back." />
      ) : (
        <section className="q3-hist__bills" aria-label="Recently deleted bills">
          <div className="q3-hist__thead q3-hist__trashcols" aria-hidden="true">
            <span>Bill No</span><span>Date</span><span>Party</span><span className="q3-hist__num">Total</span><span>Deleted</span><span>Purges in</span>
          </div>
          <div
            ref={listRef}
            className="q3-hist__billlist"
            role="grid"
            aria-label="Recently deleted bills, most recently deleted first"
            aria-rowcount={items.length}
            aria-multiselectable={true}
            tabIndex={0}
            aria-activedescendant={selectedId ? `q3-ht-${selectedId}` : undefined}
            onKeyDown={onKeyDown}
          >
            {rows}
          </div>
        </section>
      )}
      <div className="q3-hist__actions" role="toolbar" aria-label="Recently deleted actions">
        <span className="q3-hist__selcount" aria-live="polite">{count > 1 ? `${count} bills selected` : ''}</span>
        <Button size="sm" icon={ArrowCounterClockwise} shortcut="Enter" disabled={none} title={none ? 'Select a bill first' : 'Restore (keeps the bill number)'} onMouseDown={keep} onClick={p.onRestore}>Restore</Button>
        <Button size="sm" variant="danger" icon={Trash} shortcut="Delete" disabled={none} title={none ? 'Select a bill first' : 'Delete forever (asks first)'} onMouseDown={keep} onClick={p.onPurge}>Delete forever</Button>
        <Button size="sm" variant="danger" icon={TrashSimple} {...key('history.emptyTrash')} disabled={items.length === 0} title="Delete everything here forever (type EMPTY to confirm)" onMouseDown={keep} onClick={p.onEmpty}>Empty trash</Button>
        <Button size="sm" icon={ArrowLeft} shortcut="Esc" onMouseDown={keep} onClick={p.onBack}>Back to bills</Button>
      </div>
    </div>
  )
}
