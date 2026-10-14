import { useCallback, useEffect, useRef } from 'react'
import { matchShortcut } from '@shared/shortcuts'
import { describeBills } from '@shared/history/historyList'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import { BillList } from '../components/history/BillList'
import { DatesPanel } from '../components/history/DatesPanel'
import { HistoryHeader } from '../components/history/HistoryHeader'
import { ActionBar } from '../components/history/ActionBar'
import { SourceFilter } from '../components/history/SourceFilter'
import { SearchBox } from '../components/history/SearchBox'
import { SaveFlow } from '../components/create/SaveFlow'
import { TrashView } from '../components/history/TrashView'
import { UndoDeleteBar } from '../components/history/UndoDeleteBar'
import { Button, ConfirmDialog, Dialog, EmptyState, Input } from '../components/ui'
import { useHistoryStore } from '../stores/historyStore'
import { cancelDelete, confirmDelete, imageSelectedBill, openSelectedBill, pdfSelectedBill, printSelectedBill, requestDelete } from '../stores/historyActions'
import { useRouter } from '../router/routerStore'
import { useTrashStore } from '../stores/trashStore'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import { toggleRevisions } from '../stores/revisionActions'
import { cancelEmptyTrash, cancelPurge, confirmEmptyTrash, confirmPurge, requestEmptyTrash, requestPurge, restoreSelected, toggleTrash, undoLastDelete } from '../stores/trashActions'
import { describeTrashItems, isEmptyTrashConfirm } from '@shared/trash'
import { TRASH_RETENTION_DAYS } from '@shared/constants'

/**
 * Phase 41 — History layout: Dates (left) + bills of the selected date (right), newest first, keyboard first.
 * Tab / Shift+Tab (or Enter / Right and Left) move between the panels; Up/Down/Home/End/PageUp/PageDown inside one.
 * Phase 42: search box + From/To dates (Ctrl+F), Enter = Open/Edit, Ctrl+P / Ctrl+Shift+P print, Ctrl+I / Ctrl+Shift+I copy image,
 * Ctrl+O Open PDF, Ctrl+Shift+T copy (one bill: whole bill; several: the list), Delete (asks first), Shift+arrows / Space /
 * Ctrl+A multi-select, and the bottom action bar. The output keys are the global ones, routed to the History bill by `useAppActions`.
 */
export default function History(): React.JSX.Element {
  const s = useHistoryStore()
  const datesRef = useRef<HTMLDivElement>(null)
  const billsRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fromRef = useRef<HTMLInputElement>(null)
  const trashRef = useRef<HTMLDivElement>(null)
  const t = useTrashStore()
  // Phase 136: records a newer app wrote are kept aside, never shown half-read; this line says how many (a string, so no fresh object per render).
  const asideLine = useSyncStatusStore((o) => o.overview.asideLine)

  useEffect(() => {
    void useHistoryStore.getState().refresh()
    useHistoryStore.getState().setPorts({
      focusDates: () => datesRef.current?.focus(),
      focusBills: () => billsRef.current?.focus(),
      focusSearch: () => { searchRef.current?.focus(); searchRef.current?.select() },
      focusDateRange: () => fromRef.current?.focus()
    })
    useTrashStore.getState().setFocusList(() => trashRef.current?.focus())
    queueMicrotask(() => datesRef.current?.focus())
    return () => {
      useHistoryStore.getState().setPorts({ focusDates: null, focusBills: null, focusSearch: null, focusDateRange: null })
      useTrashStore.getState().setFocusList(null)
      // The view does not outlive the page (the undo offer does: it is a 10 s timer, Ctrl+Z only acts while History is open).
      if (useTrashStore.getState().open) void useTrashStore.getState().setOpen(false)
    }
  }, [])

  // History-scope keys that work from anywhere on the page: Ctrl+F (search) and Ctrl+O (Open PDF; not inside a text field, where it is just a key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const def = matchShortcut(e, ['history'])
      if (!def || def.scope !== 'history') return
      if (def.action === 'history.search') { e.preventDefault(); useHistoryStore.getState().focusSearch?.() }
      else if (def.action === 'history.openPdf') { if (!useTrashStore.getState().open) { e.preventDefault(); void pdfSelectedBill() } }
      else if (def.action === 'history.trash') { e.preventDefault(); void toggleTrash() }
      else if (def.action === 'history.emptyTrash') { if (useTrashStore.getState().open) { e.preventDefault(); requestEmptyTrash() } }
      else if (def.action === 'history.undoDelete') {
        // In a text field Ctrl+Z is the field's own undo; the delete offer answers everywhere else.
        const el = e.target as HTMLElement | null
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
        if (useTrashStore.getState().undoOffer) { e.preventDefault(); void undoLastDelete() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Esc inside the Recently deleted view returns to the bills (consumed, so it is not also "Back").
  useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.key !== 'Escape' || !useTrashStore.getState().open) return
      const s = useTrashStore.getState()
      if (s.confirmPurge || s.confirmEmpty) return
      e.preventDefault()
      void toggleTrash()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [])

  const onEnterBill = useCallback(() => { openSelectedBill() }, [])
  const onSelectBill = useCallback((id: string | null) => { useHistoryStore.getState().selectBill(id) }, [])
  const onLoadMore = useCallback(() => { void useHistoryStore.getState().loadMore() }, [])
  const onLeft = useCallback(() => datesRef.current?.focus(), [])
  const onExtend = useCallback((id: string) => useHistoryStore.getState().extendSelection(id), [])
  const onToggle = useCallback((id: string) => useHistoryStore.getState().toggleSelected(id), [])
  const onSelectAll = useCallback(() => useHistoryStore.getState().selectAll(), [])
  const onDelete = useCallback(() => { requestDelete() }, [])

  const searching = s.query.trim() !== ''
  const filtered = searching || s.from !== '' || s.to !== '' || s.source !== 'all'
  // Phase 157: while only the last N days are listed, an empty list is NOT "no bills at all" (the search box must stay reachable).
  const limited = !filtered && s.cutoff !== ''
  const empty = s.status === 'ready' && s.dates.length === 0 && !filtered && !limited
  const total = s.dates.reduce((n, d) => n + d.count, 0)
  const count = s.selection.length > 0 ? s.selection.length : s.billId === null ? 0 : 1
  const selection = new Set(s.selection)
  const emptyText = s.status !== 'ready' ? undefined : searching ? 'No bills match this search' : filtered ? 'No bills match these filters' : limited ? `No bills since ${s.cutoff}. Search, or set a From / To date, to see older bills.` : undefined

  return (
    <div className="q3-hist">
      <HistoryHeader branches={s.branches} branch={s.branch} onBranch={(b) => { void s.setBranch(b) }} total={total} loading={s.status === 'loading'} onRefresh={() => { void s.refresh() }} />
      {limited && !t.open && <p className="q3-hist__note">{`Showing bills from ${s.cutoff} onward. Search or set a From / To date to see older bills (Settings > Behaviour changes this).`}</p>}
      {!t.open && <SourceFilter />}
      {!empty && !t.open && (
        <SearchBox
          value={s.query}
          onSearch={(q) => { void useHistoryStore.getState().setQuery(q) }}
          onToResults={() => billsRef.current?.focus()}
          onLeave={() => billsRef.current?.focus()}
          inputRef={searchRef}
          from={s.from}
          to={s.to}
          onRange={(f, t) => { void useHistoryStore.getState().setRange(f, t) }}
          onClear={() => { void useHistoryStore.getState().clearFilters() }}
          fromRef={fromRef}
        />
      )}
      {asideLine !== '' && <div className="q3-hist__aside" role="status">{asideLine}</div>}
      {s.status === 'error' && <div className="q3-hist__error" role="alert">{s.error}</div>}
      {t.open ? (
        <TrashView
          items={t.items}
          selectedId={t.billId}
          selection={new Set(t.selection)}
          status={t.status}
          error={t.error}
          retentionDays={TRASH_RETENTION_DAYS}
          onSelect={(id) => t.selectItem(id)}
          onExtend={(id) => t.extendSelection(id)}
          onToggle={(id) => t.toggleSelected(id)}
          onSelectAll={() => t.selectAll()}
          onRestore={() => { void restoreSelected() }}
          onPurge={() => { requestPurge() }}
          onEmpty={() => { requestEmptyTrash() }}
          onBack={() => { void toggleTrash() }}
          listRef={trashRef}
        />
      ) : empty ? (
        <EmptyState icon={ClockCounterClockwise} title="No saved bills yet" description="Bills you save on the Create page appear here, newest first. Press Ctrl+1 to start one." />
      ) : (
        <div className="q3-hist__body">
          <DatesPanel
            dates={s.dates}
            selected={searching ? null : s.date}
            onSelect={(d) => { void s.selectDate(d) }}
            onEnter={() => billsRef.current?.focus()}
            panelRef={datesRef}
          />
          <BillList
            bills={s.bills}
            selectedId={s.billId}
            hasMore={s.next !== null}
            onSelect={onSelectBill}
            onLoadMore={onLoadMore}
            onEnter={onEnterBill}
            onLeft={onLeft}
            listRef={billsRef}
            selection={selection}
            onExtend={onExtend}
            onToggle={onToggle}
            onSelectAll={onSelectAll}
            onDelete={onDelete}
            {...(emptyText ? { emptyText } : {})}
          />
        </div>
      )}
      {t.undoOffer && <UndoDeleteBar offer={t.undoOffer} onUndo={() => { void undoLastDelete() }} />}
      {!t.open && <div className="q3-hist__status" role="status" aria-live="polite">
        {searching && s.status === 'ready' ? `${s.bills.length}${s.truncated ? '+' : ''} ${s.bills.length === 1 ? 'match' : 'matches'} across all dates${s.truncated ? ' - showing the best ones, refine the search' : ''}` : ''}
      </div>}
      {!empty && !t.open && (
        <ActionBar
          count={count}
          onOpenPdf={() => { void pdfSelectedBill() }}
          onEdit={() => { openSelectedBill() }}
          onPrint={() => { void printSelectedBill('rough') }}
          onImage={() => { void imageSelectedBill('rough') }}
          onDelete={() => { requestDelete() }}
          onBack={() => useRouter.getState().back()}
          onTrash={() => { void toggleTrash() }}
          onRevisions={() => { toggleRevisions() }}
        />
      )}
      <ConfirmDialog
        open={s.confirmDelete !== null}
        title="Delete bills?"
        danger
        confirmLabel="Delete"
        message={s.confirmDelete ? `Delete ${describeBills(s.confirmDelete)}? ${s.confirmDelete.length === 1 ? 'It moves' : 'They move'} to Recently deleted and ${s.confirmDelete.length === 1 ? 'keeps its' : 'keep their'} bill number${s.confirmDelete.length === 1 ? '' : 's'}.` : ''}
        onConfirm={() => { void confirmDelete() }}
        onCancel={cancelDelete}
      />
      <ConfirmDialog
        open={t.confirmPurge !== null}
        title="Delete forever?"
        danger
        confirmLabel="Delete forever"
        message={t.confirmPurge ? `Delete ${describeTrashItems(t.confirmPurge)} forever? This cannot be undone.` : ''}
        onConfirm={() => { void confirmPurge() }}
        onCancel={cancelPurge}
      />
      <Dialog
        open={t.confirmEmpty}
        title="Empty Recently deleted?"
        onClose={cancelEmptyTrash}
        footer={
          <>
            <Button onClick={cancelEmptyTrash}>Cancel</Button>
            <Button variant="danger" disabled={!isEmptyTrashConfirm(t.emptyText)} onClick={() => { void confirmEmptyTrash() }}>Delete everything forever</Button>
          </>
        }
      >
        <p>This deletes all {t.items.length} {t.items.length === 1 ? 'bill' : 'bills'} in Recently deleted for good. Their bill numbers are never reused. Type EMPTY to confirm.</p>
        <Input
          label="Type EMPTY"
          value={t.emptyText}
          data-autofocus
          autoComplete="off"
          onChange={(e) => t.setEmptyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirmEmptyTrash() } }}
        />
      </Dialog>
      <SaveFlow />
    </div>
  )
}
