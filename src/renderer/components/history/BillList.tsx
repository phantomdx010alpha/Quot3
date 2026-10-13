import { useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SyncBadgeMark } from '../sync/SyncBadgeMark'
import { formatHistoryDate, formatHistoryTotal, isListKey, moveListIndex, type BillListItem } from '@shared/history/historyList'

export const HISTORY_ROW_PX = 26

export interface BillListProps {
  bills: readonly BillListItem[]
  selectedId: string | null
  hasMore: boolean
  onSelect: (id: string | null) => void
  onLoadMore: () => void
  /** Enter / double-click on a bill: Open / Edit. */
  onEnter: (bill: BillListItem) => void
  /** Phase 42 multi-select: ids currently selected (empty = only the highlighted bill counts). */
  selection?: ReadonlySet<string>
  /** Shift+arrows / Shift+click: extend the selection from the anchor to this bill. */
  onExtend?: (id: string) => void
  /** Space / Ctrl+click: add or remove this bill. */
  onToggle?: (id: string) => void
  onSelectAll?: () => void
  onDelete?: () => void
  /** Shown instead of a bare empty list (search with no match, empty date range). */
  emptyText?: string
  /** Left arrow: back to the dates panel. */
  onLeft: () => void
  /** Phase 45: Esc inside the list (Customers: back to the customer list). Without it Esc keeps its normal "Back" meaning. */
  onEscape?: () => void
  listRef: React.RefObject<HTMLDivElement | null>
}

/** Right panel: `Bill No | Date | Party | Total`, virtualised (only the visible rows exist in the DOM). */
export function BillList({ bills, selectedId, hasMore, onSelect, onLoadMore, onEnter, onLeft, listRef, selection, onExtend, onToggle, onSelectAll, onDelete, emptyText, onEscape }: BillListProps): React.JSX.Element {
  const virt = useVirtualizer({
    count: bills.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => HISTORY_ROW_PX,
    overscan: 12
  })
  const index = bills.findIndex((b) => b.id === selectedId)

  useEffect(() => { if (index >= 0) virt.scrollToIndex(index, { align: 'auto' }) }, [index, virt])

  const items = virt.getVirtualItems()
  const lastVisible = items.length > 0 ? items[items.length - 1]!.index : -1
  // Next page when the scroll window OR the keyboard highlight gets within 20 rows of the end of what is loaded.
  const nearEnd = Math.max(lastVisible, index) >= bills.length - 20
  useEffect(() => { if (hasMore && nearEnd) onLoadMore() }, [hasMore, nearEnd, bills.length, onLoadMore])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.metaKey) return
    if (e.ctrlKey) {
      if (!e.shiftKey && e.key.toLowerCase() === 'a' && onSelectAll) { e.preventDefault(); onSelectAll() }
      return
    }
    if (isListKey(e.key)) {
      e.preventDefault()
      const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 260) / HISTORY_ROW_PX) - 1)
      const next = moveListIndex(index, bills.length, e.key, page)
      const b = bills[next]
      if (b) { if (e.shiftKey && onExtend) onExtend(b.id); else onSelect(b.id) }
    } else if (e.key === ' ' && onToggle) {
      e.preventDefault()
      const b = bills[index]
      if (b) onToggle(b.id)
    } else if (e.key === 'Delete' && onDelete) {
      e.preventDefault()
      onDelete()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const b = bills[index]
      if (b) onEnter(b)
    } else if (e.key === 'Escape' && onEscape) {
      e.preventDefault()
      e.stopPropagation()
      onEscape()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onLeft()
    }
  }

  return (
    <section className="q3-hist__bills" aria-label="Bills">
      <div className="q3-hist__thead q3-hist__billcols" aria-hidden="true">
        <span>Bill No</span>
        <span>Date</span>
        <span>Party</span>
        <span className="q3-hist__num">Total</span>
      </div>
      <div
        ref={listRef}
        className="q3-hist__billlist"
        role="grid"
        aria-label="Bills of the selected date, newest first"
        aria-rowcount={bills.length}
        aria-multiselectable={onToggle ? true : undefined}
        tabIndex={0}
        aria-activedescendant={selectedId ? `q3-hb-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
      >
        {bills.length === 0 && emptyText && <div className="q3-hist__none">{emptyText}</div>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {items.map((v) => {
            const b = bills[v.index]
            if (!b) return null
            return (
              <div
                key={b.id}
                id={`q3-hb-${b.id}`}
                role="row"
                aria-rowindex={v.index + 1}
                aria-selected={b.id === selectedId || (selection?.has(b.id) ?? false)}
                aria-current={b.id === selectedId ? 'true' : undefined}
                className="q3-hist__billrow q3-hist__billcols"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  listRef.current?.focus()
                  if (e.shiftKey && onExtend) onExtend(b.id)
                  else if (e.ctrlKey && onToggle) onToggle(b.id)
                  else onSelect(b.id)
                }}
                onDoubleClick={() => onEnter(b)}
              >
                <span role="gridcell" className="q3-hist__no"><span className="q3-hist__nonum">{b.poNumber}</span><SyncBadgeMark state={b.syncState} />{b.importBatchId ? <span className="q3-hist__imp" title={`Imported from the old app${b.legacyRef ? ` \u00b7 old number ${b.legacyRef}` : ''}`}>Imported</span> : null}</span>
                <span role="gridcell">{formatHistoryDate(b.billDate)}</span>
                <span role="gridcell" className="q3-hist__party" title={b.partyName}>{b.partyName || '—'}</span>
                <span role="gridcell" className="q3-hist__num">{formatHistoryTotal(b.grandTotal)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
