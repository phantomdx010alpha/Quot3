import { useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, FileXls, GitMerge, FolderOpen, MagnifyingGlass, PencilSimple, Plus, Receipt, Trash, UsersThree, X } from '@phosphor-icons/react'
import { matchShortcut, primaryKeys } from '@shared/shortcuts'
import { describeCustomers } from '@shared/customers/customerList'
import { Button, ConfirmDialog, EmptyState, Icon } from '../components/ui'
import { BillList } from '../components/history/BillList'
import { CustomerList } from '../components/customers/CustomerList'
import { DuplicatesPanel } from '../components/customers/DuplicatesPanel'
import { useDuplicatesStore } from '../stores/duplicatesStore'
import { useCustomersStore } from '../stores/customersStore'
import { usePartyImportStore } from '../stores/partyImportStore'
import { useLegacyImportStore } from '../stores/legacyImportStore'
import { backToCustomers, cancelCustomerDelete, cancelCustomerEdit, confirmCustomerDelete, openCustomerBill, saveCustomerEdit, showCustomerBills } from '../stores/customersActions'
import { useRouter } from '../router/routerStore'
import { SaveFlow } from '../components/create/SaveFlow'

/**
 * Phase 45 - Customers: a searchable, virtualised list (name, phone, address, transport, bill count, last bill, total billed).
 * Keyboard: Ctrl+F search (Down / Enter go to the list), Up/Down/Home/End/PageUp/PageDown move, Enter or F2 edit inline
 * (Enter saves, Esc cancels, Tab next field), Insert adds, Right opens the customer's bills (Enter opens a bill in Create,
 * Left / Esc comes back), Delete asks first. Deleted customers keep their bills untouched.
 */
export default function Customers(): React.JSX.Element {
  const s = useCustomersStore()
  const listRef = useRef<HTMLDivElement>(null)
  const billsRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Phase 47: an import (or its undo) changes the saved customers while this page is open.
  useEffect(() => {
    const reload = (): void => { void useCustomersStore.getState().load() }
    usePartyImportStore.setState({ onChanged: reload })
    return () => { if (usePartyImportStore.getState().onChanged === reload) usePartyImportStore.setState({ onChanged: null }) }
  }, [])

  useEffect(() => {
    void useCustomersStore.getState().load()
    useCustomersStore.getState().setPorts({
      focusList: () => listRef.current?.focus(),
      focusSearch: () => { searchRef.current?.focus(); searchRef.current?.select() },
      focusBills: () => billsRef.current?.focus()
    })
    queueMicrotask(() => listRef.current?.focus())
    // Refresh when the window regains focus (bills may have been saved or deleted meanwhile).
    const onFocus = (): void => { if (!useCustomersStore.getState().edit) void useCustomersStore.getState().load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      useCustomersStore.getState().setPorts({ focusList: null, focusSearch: null, focusBills: null })
      useDuplicatesStore.getState().close()
      const st = useCustomersStore.getState()
      if (st.edit) st.cancelEdit()
      if (st.view === 'bills') st.closeBills()
    }
  }, [])

  // Page-level keys: Ctrl+F (search) and Insert (add) work from anywhere on the page except while an editor is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const def = matchShortcut(e, ['customers'])
      if (!def || def.scope !== 'customers') return
      const st = useCustomersStore.getState()
      if (st.edit || st.confirmDelete) return
      const typing = ((): boolean => { const el = e.target as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') })()
      if (def.action === 'customers.duplicates') { e.preventDefault(); if (st.view === 'bills') backToCustomers(); void useDuplicatesStore.getState().toggle(); return }
      if (def.action === 'customers.undoMerge') { e.preventDefault(); void useDuplicatesStore.getState().undoLast(); return }
      if (def.action === 'customers.merge' || def.action === 'customers.notSame') {
        // Plain letters: only while the section is open and no text box has the key (never swallow typing).
        if (typing || !useDuplicatesStore.getState().open) return
        e.preventDefault()
        if (def.action === 'customers.merge') void useDuplicatesStore.getState().merge(); else void useDuplicatesStore.getState().notSame()
        return
      }
      if (def.action === 'customers.search') { e.preventDefault(); if (st.view === 'bills') backToCustomers(); queueMicrotask(() => useCustomersStore.getState().focusSearch?.()) }
      else if (def.action === 'customers.add') {
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        e.preventDefault()
        if (st.view === 'bills') backToCustomers()
        st.startEdit(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onBillsLoadMore = useCallback(() => { void useCustomersStore.getState().loadMoreBills() }, [])
  const onSelectBill = useCallback((id: string | null) => useCustomersStore.getState().selectBill(id), [])
  const onEnterBill = useCallback((b: { id: string }) => { openCustomerBill(b.id) }, [])

  const searching = s.query.trim() !== ''
  const empty = s.status === 'ready' && s.all.length === 0 && s.edit === null
  const inBills = s.view === 'bills' && s.billsOf !== null
  const emptyText = s.status === 'ready' && s.rows.length === 0 && searching ? 'No customers match this search' : undefined
  const key = primaryKeys('customers.search')
  const noneSel = s.selected() === null || s.edit !== null
  const keep = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className="q3-hist">
      <header className="q3-hist__head">
        <h1 className="q3-hist__title">{inBills ? `Bills of ${s.billsOf!.name}` : 'Customers'}</h1>
        <span className="q3-hist__count" aria-live="polite">
          {inBills ? `${s.bills.length}${s.billsNext !== null ? '+' : ''} ${s.bills.length === 1 ? 'bill' : 'bills'}` : describeCustomers(s.rows.length, s.all.length)}
        </span>
        {!inBills && (
          <>
          <Button size="sm" icon={FileXls} shortcut={primaryKeys('partyImport.open') ?? ''} title="Import customers from an Excel file" onClick={() => { void usePartyImportStore.getState().start() }}>Import</Button>
          <Button size="sm" icon={GitMerge} shortcut={primaryKeys('customers.duplicates') ?? ''} title="Customers with similar names" onClick={() => { void useDuplicatesStore.getState().toggle() }}>Possible duplicates</Button>
          <Button size="sm" icon={FolderOpen} shortcut={primaryKeys('legacyImport.open') ?? ''} title="Import bills from the old app" onClick={() => { void useLegacyImportStore.getState().open() }}>Import old bills</Button>
          <Button size="sm" icon={Plus} {...(primaryKeys('customers.add') ? { shortcut: primaryKeys('customers.add')! } : {})} disabled={s.edit !== null} title="Add a customer" onClick={() => { s.startEdit(null) }}>Add customer</Button>
          </>
        )}
      </header>
      {!inBills && !empty && (
        <div className="q3-hist__tools" role="search">
          <label className="q3-hist__search nm-inset nm-sm">
            <Icon icon={MagnifyingGlass} weight="light" size="sm" />
            <input
              ref={searchRef}
              className="q3-hist__searchinput"
              aria-label="Search customers"
              placeholder={`Search name, phone or address${key ? ` (${key})` : ''}`}
              value={s.query}
              autoComplete="off"
              onChange={(e) => s.setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); listRef.current?.focus() }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (s.query !== '') s.setQuery(''); else listRef.current?.focus() }
              }}
            />
            {s.query !== '' && (
              <button type="button" className="q3-hist__refresh" aria-label="Clear search" onClick={() => { s.setQuery(''); listRef.current?.focus() }}>
                <Icon icon={X} weight="bold" size="sm" />
              </button>
            )}
          </label>
        </div>
      )}
      {s.status === 'error' && <div className="q3-hist__error" role="alert">{s.error}</div>}
      {s.edit && s.edit.error !== '' && <div className="q3-hist__error" role="alert">{s.edit.error}</div>}
      {!inBills && <DuplicatesPanel />}
      {empty ? (
        <EmptyState
          icon={UsersThree}
          title="No customers yet"
          description="Customers you save on a bill appear here, or add one now."
          action={<Button onClick={() => { s.startEdit(null) }}>Add customer</Button>}
        />
      ) : inBills ? (
        <div className="q3-hist__body">
          <BillList
            bills={s.bills}
            selectedId={s.billId}
            hasMore={s.billsNext !== null}
            onSelect={onSelectBill}
            onLoadMore={onBillsLoadMore}
            onEnter={onEnterBill}
            onLeft={backToCustomers}
            onEscape={backToCustomers}
            listRef={billsRef}
            {...(s.billsStatus === 'ready' && s.bills.length === 0 ? { emptyText: 'No bills for this customer yet' } : {})}
          />
        </div>
      ) : (
        <div className="q3-hist__body">
          <CustomerList
            rows={s.rows}
            selectedId={s.selectedId}
            edit={s.edit}
            listRef={listRef}
            onSelect={s.select}
            onEdit={(id) => { s.startEdit(id) }}
            onOpenBills={() => { void showCustomerBills() }}
            onDelete={() => { s.askDelete() }}
            onDraft={s.setDraft}
            onSave={() => { void saveCustomerEdit() }}
            onCancel={cancelCustomerEdit}
            {...(emptyText ? { emptyText } : {})}
          />
        </div>
      )}
      <div className="q3-hist__actions">
        <span className="q3-hist__selcount">{inBills ? 'Enter opens the bill' : s.selected() ? s.selected()!.name : ''}</span>
        {inBills ? (
          <Button size="sm" icon={ArrowLeft} onClick={backToCustomers}>Back to customers</Button>
        ) : (
          <>
            <Button size="sm" icon={Receipt} shortcut={primaryKeys('customers.bills') ?? ''} disabled={noneSel} onMouseDown={keep} onClick={() => { void showCustomerBills() }}>Bills</Button>
            <Button size="sm" icon={PencilSimple} shortcut={primaryKeys('customers.edit') ?? ''} disabled={noneSel} onMouseDown={keep} onClick={() => { s.startEdit(s.selectedId) }}>Edit</Button>
            <Button size="sm" variant="danger" icon={Trash} shortcut={primaryKeys('customers.delete') ?? ''} disabled={noneSel} onMouseDown={keep} onClick={() => { s.askDelete() }}>Delete</Button>
            <Button size="sm" icon={ArrowLeft} onMouseDown={keep} onClick={() => useRouter.getState().back()}>Back</Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={s.confirmDelete !== null}
        title="Delete customer?"
        danger
        confirmLabel="Delete"
        message={s.confirmDelete ? `Delete ${s.confirmDelete.name}? ${s.confirmDelete.billCount > 0 ? `Its ${s.confirmDelete.billCount} ${s.confirmDelete.billCount === 1 ? 'bill keeps' : 'bills keep'} the name and details they were saved with.` : 'It has no bills.'}` : ''}
        onConfirm={() => { void confirmCustomerDelete() }}
        onCancel={cancelCustomerDelete}
      />
      <SaveFlow />
    </div>
  )
}
