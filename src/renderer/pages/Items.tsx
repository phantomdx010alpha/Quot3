import { useEffect, useMemo, useRef } from 'react'
import { ArrowClockwise, ArrowCounterClockwise, ArrowLeft, ListMagnifyingGlass, MagnifyingGlass, X } from '@phosphor-icons/react'
import { matchShortcut, primaryKeys } from '@shared/shortcuts'
import { describeGroups, filterGroups } from '@shared/items/search'
import { Button, EmptyState, Icon } from '../components/ui'
import { buildGroupRows, buildSpellingRows } from '@shared/items/groupRows'
import { ItemsWindowFrame } from '../components/items/ItemsWindowFrame'
import { GroupsWindow } from '../components/items/GroupsWindow'
import { SpellingsWindow } from '../components/items/SpellingsWindow'
import { SalesPanel } from '../components/items/SalesPanel'
import { groupsKey, salesKey, spellingsKey } from '../components/items/windowKeys'
import { nextWindow, useItemsStore, type ItemsWindow } from '../stores/itemsStore'
import { useRouter } from '../router/routerStore'

/**
 * Phase 112 - Items page shell: three windows (Groups, Spellings, Sales), a search box, loading / empty / error states.
 * Keyboard: Ctrl+F search (Down / Enter move to Groups, Esc clears it), Tab / Shift+Tab or Ctrl+Alt+1/2/3 move between the windows,
 * F5 reads all bills again, Ctrl+Z undoes the last decision, Esc goes to the Dashboard.
 * Phase 113: Groups (families -> variants) and Spellings (with why, suggested merges) are real; M merge, S split, V move, Delete not-an-item, Enter / X on a suggestion.
 * Phase 114: Sales (Non-GST / GST tabs, summary, who-paid-what, party filter): G switches the tab, P filters by the highlighted party, Enter / double-click opens the bill (Esc comes back to the same selection), Ctrl+Alt+T copies the table.
 */
const TITLES: Record<ItemsWindow, string> = { groups: 'Groups', spellings: 'Spellings', sales: 'Sales' }
const PAGE_ACTIONS: ReadonlySet<string> = new Set(['items.search', 'items.rebuild', 'items.window1', 'items.window2', 'items.window3', 'items.undo', 'items.salesCopy'])
const ACTION_OF: Record<ItemsWindow, 'items.window1' | 'items.window2' | 'items.window3'> = { groups: 'items.window1', spellings: 'items.window2', sales: 'items.window3' }

export default function Items(): React.JSX.Element {
  const status = useItemsStore((s) => s.status)
  const error = useItemsStore((s) => s.error)
  const overview = useItemsStore((s) => s.overview)
  const query = useItemsStore((s) => s.query)
  const selectedId = useItemsStore((s) => s.selectedGroupId)
  const win = useItemsStore((s) => s.window)
  const rebuilding = useItemsStore((s) => s.rebuilding)
  const progress = useItemsStore((s) => s.progress)
  const detail = useItemsStore((s) => s.detail)
  const cursor = useItemsStore((s) => s.cursor)
  const pending = useItemsStore((s) => s.pending)
  const notice = useItemsStore((s) => s.notice)
  const undo = useItemsStore((s) => s.undo)
  const busy = useItemsStore((s) => s.busy)
  const sales = useItemsStore((s) => s.sales)
  const salesTab = useItemsStore((s) => s.salesTab)
  const salesCursor = useItemsStore((s) => s.salesCursor)
  const partyFilter = useItemsStore((s) => s.partyFilter)
  const refs = useRef<Record<ItemsWindow, HTMLDivElement | null>>({ groups: null, spellings: null, sales: null })
  const searchRef = useRef<HTMLInputElement>(null)
  // Phase 115: STABLE ref callbacks. An inline `(el) => ...` is a new function every render, so React detached and re-attached the ref on each render and the virtualised lists read a null scroll element in their layout effect (no rows drawn).
  const frameRefs = useMemo(() => ({
    groups: (el: HTMLDivElement | null): void => { refs.current.groups = el },
    spellings: (el: HTMLDivElement | null): void => { refs.current.spellings = el },
    sales: (el: HTMLDivElement | null): void => { refs.current.sales = el }
  }), [])

  const all = overview?.groups
  const rows = useMemo(() => (all ? filterGroups(all, query) : []), [all, query])
  const groupRows = useMemo(() => (all && overview ? buildGroupRows(rows, overview.families) : []), [all, overview, rows])
  const nameById = useMemo(() => new Map((all ?? []).map((g) => [g.id, g.display])), [all])
  const spellingRows = useMemo(() => (detail && detail.id === selectedId ? buildSpellingRows(detail, (id) => nameById.get(id) ?? id) : []), [detail, selectedId, nameById])
  const selected = useMemo(() => (selectedId === null ? null : (all?.find((g) => g.id === selectedId) ?? null)), [all, selectedId])

  useEffect(() => {
    const st = useItemsStore.getState()
    st.setPorts({
      focusWindow: (w) => { st.setWindow(w); refs.current[w]?.focus() },
      focusSearch: () => { searchRef.current?.focus(); searchRef.current?.select() }
    })
    void st.load()
    // Coming back from an opened bill (Esc) the store still holds the window that was active: focus that one.
    queueMicrotask(() => refs.current[useItemsStore.getState().window]?.focus())
    // Bills may have been saved, edited or deleted while another page (or window) was in front.
    const onFocus = (): void => { if (!useItemsStore.getState().rebuilding) void useItemsStore.getState().load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      useItemsStore.getState().setPorts({ focusWindow: null, focusSearch: null })
    }
  }, [])

  // Page-level keys from the registry (scope 'items').
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      const def = matchShortcut(e, ['items'])
      if (!def || def.scope !== 'items') return
      // Plain keys (M, S, V, X, Enter, Delete) belong to the focused window (windowKeys.ts) and must never fire while typing in the search box.
      if (!PAGE_ACTIONS.has(def.action)) return
      if (def.action === 'items.undo' && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return // native text undo
      const st = useItemsStore.getState()
      e.preventDefault()
      switch (def.action) {
        case 'items.search': st.ports.focusSearch?.(); break
        case 'items.rebuild': void st.rebuild(); break
        case 'items.window1': st.ports.focusWindow?.('groups'); break
        case 'items.window2': st.ports.focusWindow?.('spellings'); break
        case 'items.window3': st.ports.focusWindow?.('sales'); break
        case 'items.undo': void st.undoDecision(); break
        case 'items.salesCopy': void st.copySales(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goTo = (w: ItemsWindow): void => { useItemsStore.getState().ports.focusWindow?.(w) }
  const onWindowKey = (w: ItemsWindow) => (e: React.KeyboardEvent<HTMLElement>): void => {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) {
      if (w === 'groups') groupsKey(e)
      else if (w === 'spellings') spellingsKey(e)
      else salesKey(e)
      return
    }
    e.preventDefault()
    goTo(nextWindow(w, e.shiftKey ? -1 : 1))
  }

  const total = all?.length ?? 0
  const searching = query.trim() !== ''
  const searchKey = primaryKeys('items.search')
  const loading = status === 'loading' || (status === 'idle' && overview === null)
  const empty = status === 'ready' && total === 0
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const statusLine = pending
    ? `${pending.kind === 'merge' ? 'Merging' : 'Moving'} ${pending.label}: pick the item to put it into, then press M or Enter. Esc cancels.`
    : notice

  const body = (w: ItemsWindow): React.ReactNode => {
    if (loading) return <div className="q3-items__note" role="status">Reading the bills...</div>
    if (status === 'error' && overview === null) return <div className="q3-items__note">Nothing to show.</div>
    if (w === 'groups') {
      return (
        <GroupsWindow
          rows={groupRows}
          selectedId={selectedId}
          markedId={pending ? (pending.kind === 'merge' ? pending.fromGroupId : pending.groupId) : null}
          emptyText={searching ? 'No items match this search' : ''}
          getScroll={() => refs.current.groups}
          onSelect={(id) => useItemsStore.getState().selectGroup(id)}
        />
      )
    }
    if (w === 'spellings') {
      return <SpellingsWindow rows={spellingRows} cursor={cursor} groupName={selected?.display ?? ''} movingKey={pending?.kind === 'move' ? pending.spellingKey : null} onCursor={(i) => useItemsStore.getState().setCursor(i)} />
    }
    return (
      <SalesPanel
        sales={sales && sales.groupId === selectedId ? sales : null}
        groupName={selected?.display ?? ''}
        tab={salesTab}
        cursor={salesCursor}
        partyFilter={partyFilter}
        getScroll={() => refs.current.sales}
        onTab={(id) => useItemsStore.getState().setSalesTab(id)}
        onCursor={(i) => useItemsStore.getState().setSalesCursor(i)}
        onOpen={(i) => { void useItemsStore.getState().openSaleBill(i) }}
        onParty={(k) => { void useItemsStore.getState().setPartyFilter(k) }}
        onClearParty={() => { void useItemsStore.getState().clearPartyFilter() }}
      />
    )
  }

  return (
    <div className="q3-hist q3-items">
      <header className="q3-hist__head">
        <h1 className="q3-hist__title">Items</h1>
        <span className="q3-hist__count" aria-live="polite">
          {rebuilding ? (progress ? `Reading bills: ${progress.done} of ${progress.total}` : 'Reading bills...') : overview ? `${describeGroups(rows.length, total)} from ${overview.bills} bills` : ''}
        </span>
        <Button size="sm" icon={ArrowCounterClockwise} shortcut={primaryKeys('items.undo') ?? ''} disabled={undo === null || busy} title={undo ? `Undo: ${undo}` : 'Nothing to undo'} onMouseDown={keep} onClick={() => { void useItemsStore.getState().undoDecision() }}>Undo</Button>
        <Button size="sm" icon={ArrowClockwise} shortcut={primaryKeys('items.rebuild') ?? ''} disabled={rebuilding} title="Read all bills again" onMouseDown={keep} onClick={() => { void useItemsStore.getState().rebuild() }}>Rebuild</Button>
      </header>
      {!empty && (
        <div className="q3-hist__tools" role="search">
          <label className="q3-hist__search nm-inset nm-sm">
            <Icon icon={MagnifyingGlass} weight="light" size="sm" />
            <input
              ref={searchRef}
              className="q3-hist__searchinput"
              aria-label="Search items"
              placeholder={`Search items${searchKey ? ` (${searchKey})` : ''}`}
              value={query}
              autoComplete="off"
              onChange={(e) => useItemsStore.getState().setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goTo('groups') }
                else if (e.key === 'Escape') {
                  e.preventDefault(); e.stopPropagation()
                  if (query !== '') useItemsStore.getState().setQuery('')
                  else goTo('groups')
                }
              }}
            />
            {query !== '' && (
              <button type="button" className="q3-hist__refresh" aria-label="Clear search" onMouseDown={keep} onClick={() => { useItemsStore.getState().setQuery(''); goTo('groups') }}>
                <Icon icon={X} weight="bold" size="sm" />
              </button>
            )}
          </label>
        </div>
      )}
      {error !== '' && <div className="q3-hist__error" role="alert">{error}</div>}
      {statusLine !== '' && <div className="q3-items__status" role="status">{statusLine}</div>}
      {empty ? (
        <EmptyState icon={ListMagnifyingGlass} title="No items yet" description="Items appear here once bills are saved or old bills are imported." />
      ) : (
        <div className="q3-items__body">
          {(['groups', 'spellings', 'sales'] as const).map((w) => (
            <ItemsWindowFrame
              key={w}
              title={TITLES[w]}
              hint={primaryKeys(ACTION_OF[w]) ?? ''}
              active={win === w}
              frameRef={frameRefs[w]}
              onFocus={() => { if (useItemsStore.getState().window !== w) useItemsStore.getState().setWindow(w) }}
              onKeyDown={onWindowKey(w)}
              className={`q3-items__win q3-items__win--${w}`}
            >
              {body(w)}
            </ItemsWindowFrame>
          ))}
        </div>
      )}
      <div className="q3-hist__actions">
        <span className="q3-hist__selcount">{selected ? selected.display : ''}</span>
        <Button size="sm" icon={ArrowLeft} onMouseDown={keep} onClick={() => useRouter.getState().back()}>Back</Button>
      </div>
    </div>
  )
}
