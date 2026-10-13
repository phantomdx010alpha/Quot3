import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { addressPreview, type CustomerField, type CustomerRow } from '@shared/customers/customerList'
import { formatHistoryDate, formatHistoryTotal, isListKey, moveListIndex } from '@shared/history/historyList'
import type { CustomerEdit } from '../../stores/customersStore'

export const CUSTOMER_ROW_PX = 26

export interface CustomerListProps {
  rows: readonly CustomerRow[]
  selectedId: string | null
  edit: CustomerEdit | null
  emptyText?: string
  onSelect: (id: string | null) => void
  /** Enter / F2 / double-click on a customer; `null` = add. */
  onEdit: (id: string | null) => void
  onOpenBills: () => void
  onDelete: () => void
  onDraft: (field: CustomerField, value: string) => void
  onSave: () => void
  onCancel: () => void
  listRef: React.RefObject<HTMLDivElement | null>
}

/** The inline editor cells (one row of inputs in the same grid columns as a customer row). Enter saves, Esc cancels, Tab walks the fields. */
function EditCells({ edit, row, onDraft, onSave, onCancel }: { edit: CustomerEdit; row: CustomerRow | null; onDraft: CustomerListProps['onDraft']; onSave: () => void; onCancel: () => void }): React.JSX.Element {
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => { first.current?.focus(); first.current?.select() }, [])
  const keys = (e: React.KeyboardEvent, multiline = false): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
    else if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); onSave() }
  }
  const d = edit.draft
  const common = { disabled: edit.saving, autoComplete: 'off', className: 'q3-cust__input' } as const
  return (
    <>
      <input ref={first} {...common} aria-label="Name" value={d.name} onChange={(e) => onDraft('name', e.target.value)} onKeyDown={keys} aria-invalid={edit.error !== '' && d.name.trim() === '' ? true : undefined} />
      <input {...common} aria-label="Phone" value={d.phone} onChange={(e) => onDraft('phone', e.target.value)} onKeyDown={keys} />
      <textarea {...common} rows={1} aria-label="Address (Shift+Enter for a new line)" title="Shift+Enter for a new line" value={d.address} onChange={(e) => onDraft('address', e.target.value)} onKeyDown={(e) => keys(e, true)} />
      <input {...common} aria-label="Transport" value={d.transport} onChange={(e) => onDraft('transport', e.target.value)} onKeyDown={keys} />
      <span className="q3-hist__num">{row ? row.billCount : 0}</span>
      <span>{row && row.lastBillDate ? formatHistoryDate(row.lastBillDate) : '—'}</span>
      <span className="q3-hist__num">{row ? formatHistoryTotal(row.totalBilled) : '—'}</span>
    </>
  )
}

/** Customers table, virtualised (only the visible rows are in the DOM). Name | Phone | Address | Transport | Bills | Last bill | Total billed. */
export function CustomerList({ rows, selectedId, edit, emptyText, onSelect, onEdit, onOpenBills, onDelete, onDraft, onSave, onCancel, listRef }: CustomerListProps): React.JSX.Element {
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => listRef.current, estimateSize: () => CUSTOMER_ROW_PX, overscan: 12 })
  const index = rows.findIndex((r) => r.id === selectedId)
  useEffect(() => { if (index >= 0) virt.scrollToIndex(index, { align: 'auto' }) }, [index, virt])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return
    if (isListKey(e.key)) {
      e.preventDefault()
      const page = Math.max(1, Math.floor((listRef.current?.clientHeight ?? 260) / CUSTOMER_ROW_PX) - 1)
      const next = rows[moveListIndex(index, rows.length, e.key, page)]
      if (next) onSelect(next.id)
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault()
      if (rows[index]) onEdit(rows[index]!.id)
    } else if (e.key === 'Insert') {
      e.preventDefault()
      onEdit(null)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onOpenBills()
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onDelete()
    }
  }

  const adding = edit !== null && edit.id === null
  return (
    <section className="q3-hist__bills" aria-label="Customers">
      <div className="q3-hist__thead q3-cust__cols" aria-hidden="true">
        <span>Name</span><span>Phone</span><span>Address</span><span>Transport</span>
        <span className="q3-hist__num">Bills</span><span>Last bill</span><span className="q3-hist__num">Total billed</span>
      </div>
      {adding && (
        <div className="q3-cust__row q3-cust__cols q3-cust__row--editing" role="group" aria-label="New customer">
          <EditCells edit={edit} row={null} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
        </div>
      )}
      <div
        ref={listRef}
        className="q3-hist__billlist"
        role="grid"
        aria-label="Customers, A to Z"
        aria-rowcount={rows.length}
        tabIndex={0}
        aria-activedescendant={selectedId ? `q3-cu-${selectedId}` : undefined}
        onKeyDown={onKeyDown}
      >
        {rows.length === 0 && emptyText && <div className="q3-hist__none">{emptyText}</div>}
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index]
            if (!r) return null
            const editing = edit !== null && edit.id === r.id
            return (
              <div
                key={r.id}
                id={`q3-cu-${r.id}`}
                role="row"
                aria-rowindex={v.index + 1}
                aria-selected={r.id === selectedId}
                aria-current={r.id === selectedId ? 'true' : undefined}
                className={`q3-hist__billrow q3-cust__cols${editing ? ' q3-cust__row--editing' : ''}`}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: v.size, transform: `translateY(${v.start}px)` }}
                onMouseDown={(e) => { if (editing) return; e.preventDefault(); listRef.current?.focus(); onSelect(r.id) }}
                onDoubleClick={() => { if (!editing) onEdit(r.id) }}
              >
                {editing ? (
                  <EditCells edit={edit} row={r} onDraft={onDraft} onSave={onSave} onCancel={onCancel} />
                ) : (
                  <>
                    <span role="gridcell" className="q3-hist__party" title={r.name}>{r.name}</span>
                    <span role="gridcell" className="q3-hist__party" title={r.phone}>{r.phone || '—'}</span>
                    <span role="gridcell" className="q3-hist__party" title={r.address}>{addressPreview(r.address) || '—'}</span>
                    <span role="gridcell" className="q3-hist__party" title={r.transport}>{r.transport || '—'}</span>
                    <span role="gridcell" className="q3-hist__num">{r.billCount}</span>
                    <span role="gridcell">{r.lastBillDate ? formatHistoryDate(r.lastBillDate) : '—'}</span>
                    <span role="gridcell" className="q3-hist__num">{r.billCount === 0 ? '—' : formatHistoryTotal(r.totalBilled)}</span>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
