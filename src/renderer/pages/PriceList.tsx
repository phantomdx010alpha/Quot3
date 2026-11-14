import { useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, ArrowsLeftRight, Columns, DownloadSimple, FunnelSimple, Percent, SidebarSimple, Tag } from '@phosphor-icons/react'
import { matchShortcut, primaryKeys } from '@shared/shortcuts'
import { ROUTES } from '@shared/routes'
import { Button, EmptyState } from '../components/ui'
import { CategoryPanel } from '../components/pricelist/CategoryPanel'
import { TabStrip } from '../components/pricelist/TabStrip'
import { PriceGrid } from '../components/pricelist/PriceGrid'
import { ColumnsDialog } from '../components/pricelist/ColumnsDialog'
import { TiersDialog } from '../components/pricelist/TiersDialog'
import { BulkDialog, FindDialog } from '../components/pricelist/ToolsDialogs'
import { PriceSearchBox } from '../components/pricelist/PriceSearchBox'
import { usePageMemory } from '../hooks/usePageMemory'
import { priceListAdapter } from '../pageMemory/adapters'
import { runPriceListAction } from '../stores/priceListActions'
import { usePriceListStore } from '../stores/priceListStore'
import { usePriceRightsStore } from '../stores/priceRightsStore'
import { rightsNotice } from '@shared/pricelist/perms'
import { useRouter } from '../router/routerStore'

/** Actions that make sense while the cursor is in the search box (the rest belong to the grid). */
const SEARCH_OK: ReadonlySet<string> = new Set(['pricelist.panel', 'pricelist.noPrice', 'pricelist.columns', 'pricelist.tiers', 'pricelist.newTab', 'pricelist.tabPrev', 'pricelist.tabNext', 'pricelist.search'])
const SAVE_TEXT = { saved: 'All changes saved', dirty: 'Saving soon...', saving: 'Saving...', error: 'Not saved' } as const

/**
 * Phase 238 (M23) - the Price List page (`/pricelist`): category panel, tab strip, toolbar, the grid and a status bar.
 * Edits autosave (no Save button) and the grid uses the bill grid's own keyboard engine (see PriceGrid / priceListStore).
 */
export default function PriceList(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  usePageMemory(ROUTES.pricelist, rootRef, priceListAdapter(() => rootRef.current))
  const status = usePriceListStore((s) => s.status)
  const error = usePriceListStore((s) => s.error)
  const tree = usePriceListStore((s) => s.tree)
  const tabId = usePriceListStore((s) => s.tabId)
  const rows = usePriceListStore((s) => s.rows)
  const filter = usePriceListStore((s) => s.filter)
  const panelOpen = usePriceListStore((s) => s.panelOpen)
  const save = usePriceListStore((s) => s.save)
  const saveError = usePriceListStore((s) => s.saveError)
  const notice = usePriceListStore((s) => s.notice)
  const loading = usePriceListStore((s) => s.rowsLoading)
  const dupWarn = usePriceListStore((s) => s.dupWarn)
  const rights = usePriceRightsStore((s) => s.flags)
  const refusedCount = usePriceRightsStore((s) => s.info?.refused ?? 0)
  const refusedNeeds = usePriceRightsStore((s) => s.info?.refusedNeeds) // Phase 256: raw value (Phase 92 rule)

  useEffect(() => {
    const st = usePriceListStore.getState()
    st.setPorts({
      focusSearch: () => { searchRef.current?.focus(); searchRef.current?.select() },
      focusGrid: () => usePriceListStore.setState((s) => ({ focusTick: s.focusTick + 1 }))
    })
    void st.load()
    void usePriceRightsStore.getState().load(true) // Phase 242: ask the main branch what this seat may do (offline keeps the last answer)
    const onHide = (): void => { if (document.visibilityState === 'hidden') { usePriceListStore.getState().commit(); void usePriceListStore.getState().flush() } }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      const s = usePriceListStore.getState()
      s.setPorts({ focusSearch: null, focusGrid: null })
      s.commit()
      void s.flush() // leaving the page never loses an edit
    }
  }, [])

  // Page-level keys from the registry (scope 'pricelist').
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      if ((e.target as HTMLElement | null)?.closest?.('.q3-overlay')) return // a dialog is open: its own keys
      const def = matchShortcut(e, ['pricelist'])
      if (!def || def.scope !== 'pricelist') return
      const inSearch = e.target === searchRef.current
      if (inSearch && !SEARCH_OK.has(def.action)) return
      e.preventDefault()
      runPriceListAction(def.action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo(() => rows.filter((r) => r.kind === 'item' && r.nameRuns.length > 0).length, [rows])
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const noCats = status === 'ready' && (tree?.categories.length ?? 0) === 0
  const filterOn = filter.noPrice || filter.contains.trim() !== ''
  const notice242 = rightsNotice(rights, refusedCount, refusedNeeds ?? [])

  return (
    <div className="q3-hist q3-pl" ref={rootRef}>
      <header className="q3-hist__head">
        <h1 className="q3-hist__title">Price List</h1>
        <span className="q3-hist__count" aria-live="polite">{status === 'ready' && tabId ? `${items} item${items === 1 ? '' : 's'} in this tab` : ''}</span>
      </header>
      {status === 'error' && <div className="q3-hist__error" role="alert">{error}</div>}
      {notice242.length > 0 && <div className="q3-pl__rights" role="note" aria-label="Your rights in the Price List" data-testid="pl-rights">{notice242.map((t) => <p key={t}>{t}</p>)}</div>}
      {status === 'loading' && tree === null && <div className="q3-items__note" role="status">Opening the Price List...</div>}
      {noCats ? (
        <EmptyState icon={Tag} title="No price list yet" description="Add a category to start, or import the old inventory in Settings > Price List." />
      ) : status === 'ready' && (
        <>
          <div className="q3-hist__tools q3-pl__tools" role="search">
            <Button size="sm" icon={SidebarSimple} aria-pressed={panelOpen} shortcut={primaryKeys('pricelist.panel') ?? ''} title="Show or hide the categories" onMouseDown={keep} onClick={() => usePriceListStore.getState().togglePanel()}>Categories</Button>
            <PriceSearchBox inputRef={searchRef} />
            <Button size="sm" icon={FunnelSimple} aria-pressed={filter.noPrice} shortcut={primaryKeys('pricelist.noPrice') ?? ''} title="Show only items with no price" onMouseDown={keep} onClick={() => usePriceListStore.getState().setFilter({ noPrice: !filter.noPrice })}>No price</Button>
            <Button size="sm" icon={Columns} disabled={!tabId || !rights.structure} shortcut={primaryKeys('pricelist.columns') ?? ''} onMouseDown={keep} onClick={() => usePriceListStore.getState().openDialog('columns')}>Columns</Button>
            <Button size="sm" icon={Percent} disabled={!tabId || !rights.overwrite} shortcut={primaryKeys('pricelist.bulk') ?? ''} title="Change many prices at once" onMouseDown={keep} onClick={() => usePriceListStore.getState().openDialog('bulk')}>Bulk</Button>
            <Button size="sm" icon={ArrowsLeftRight} disabled={!tabId || !rights.edit} shortcut={primaryKeys('pricelist.find') ?? ''} title="Find and replace, tidy names" onMouseDown={keep} onClick={() => usePriceListStore.getState().openDialog('find')}>Replace</Button>
            <Button size="sm" icon={DownloadSimple} disabled={!tabId} shortcut={primaryKeys('pricelist.csv') ?? ''} title="Save this tab as a CSV file" onMouseDown={keep} onClick={() => runPriceListAction('pricelist.csv')}>CSV</Button>
            <Button size="sm" icon={Tag} disabled={!rights.structure} shortcut={primaryKeys('pricelist.tiers') ?? ''} onMouseDown={keep} onClick={() => usePriceListStore.getState().openDialog('tiers')}>Price levels</Button>
          </div>
          <div className="q3-pl__body">
            {panelOpen && <CategoryPanel />}
            <div className="q3-pl__main">
              <TabStrip />
              <div className="q3-pl__gridwrap" aria-busy={loading}>
                {tabId ? <PriceGrid /> : <EmptyState icon={Tag} title="No tabs in this category" description="Press Ctrl+Alt+A or the Tab button to add one." />}
              </div>
            </div>
          </div>
        </>
      )}
      <div className="q3-hist__actions q3-pl__status">
        <span className="q3-pl__save" data-state={save} role="status" aria-live="polite">{save === 'error' && saveError !== '' ? `Not saved: ${saveError}` : SAVE_TEXT[save]}</span>
        <span className="q3-hist__selcount">{notice !== '' ? notice : dupWarn !== '' ? dupWarn : filterOn ? 'Filter is on' : 'Autosaves. Ctrl+Z undoes.'}</span>
        <Button size="sm" icon={ArrowLeft} onMouseDown={keep} onClick={() => useRouter.getState().back()}>Back</Button>
      </div>
      <ColumnsDialog />
      <TiersDialog />
      <BulkDialog />
      <FindDialog />
    </div>
  )
}
