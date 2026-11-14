/** Phase 245 (M23) - the shared pieces of the phone Price List screens (tidy / guided / inbox draw them in their own arrangement). Read only: no input here
 *  changes a record. Names and amounts are shown whole (wrap rule, `pricelist.css`); no truncation helper is used. Phosphor icons only, tokens only, no emoji. */
import { ListBullets, MagnifyingGlass } from '@phosphor-icons/react'
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { PhoneDb } from '../../data/db'
import { getSetting } from '../../data/settingsRepo'
import { RichName } from '../RichName'
import type { SyncLine } from '../dashboardModel'
import { EMPTY_CELL, SEARCH_HINT, emptyState, priceNotices, type PriceListData, type PriceEmpty, type ResolvedHit, type ViewRow } from './priceListModel'
import { usePriceList } from './usePriceList'
import { AddItemControls, PriceEditProvider, RowEditControls, StructurePanel } from './PriceEditParts'
import './pricelist.css'

export function PriceSearch(props: { value: string; onChange: (v: string) => void }): ReactElement {
  return (
    <div className="q3x-pl-searchwrap">
      <div className="q3x-pl-search">
        <MagnifyingGlass size={20} weight="light" aria-hidden="true" />
        <input type="search" className="q3x-pl-search-input" aria-label="Search the Price List" placeholder="Item name or price" enterKeyHint="search" autoComplete="off" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      </div>
      <p className="q3x-pl-hint-text">{SEARCH_HINT}</p>
    </div>
  )
}

/** One item or section row. Item: the name (bold / red / highlight runs kept) and every visible column with its label; a price column that points at a
 *  tier names the tier when that adds something. A missing price is a dash, and a row with no price at all says so quietly. */
export function PriceRowCard(props: { row: ViewRow; path?: string }): ReactElement {
  const { row } = props
  if (row.kind === 'section') {
    return <li className="q3x-pl-section" data-testid="price-section"><h3 className="q3x-pl-section-name"><RichName runs={row.runs} /></h3><RowEditControls rowId={row.id} /></li>
  }
  return (
    <li className="q3x-pl-row" data-testid="price-row">
      {props.path ? <p className="q3x-pl-path-text">{props.path}</p> : null}
      <p className="q3x-pl-item-name">{row.runs.length > 0 ? <RichName runs={row.runs} /> : <span className="q3-muted">No name</span>}</p>
      {row.cells.length > 0 ? (
        <dl className="q3x-pl-cells">
          {row.cells.map((c) => (
            <div key={c.key} className="q3x-pl-cell">
              <dt className="q3x-pl-cell-label">{c.tier === '' ? c.label : `${c.label} (${c.tier})`}</dt>
              <dd className={c.numeric ? 'q3x-pl-cell-value q3x-pl-amount' : 'q3x-pl-cell-value'}>{c.text === '' ? EMPTY_CELL : c.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row.noPrice ? <p className="q3x-pl-noprice-text">No price</p> : null}
      <RowEditControls rowId={row.id} />
    </li>
  )
}

/** `tabId` (Phase 246) adds the "Add item" control under the list when the screen can edit. */
export function PriceRowList(props: { rows: readonly ViewRow[]; label: string; tabId?: string }): ReactElement {
  const add = props.tabId ? <AddItemControls tabId={props.tabId} /> : null
  if (props.rows.length === 0) return <><p className="q3-muted" role="status">This tab has no items yet.</p>{add}</>
  return <><ul className="q3x-pl-list" aria-label={props.label}>{props.rows.map((r) => <PriceRowCard key={r.id} row={r} />)}</ul>{add}</>
}

export function PriceHits(props: { hits: readonly ResolvedHit[] }): ReactElement {
  if (props.hits.length === 0) return <p className="q3-muted" role="status">Nothing in the Price List matches.</p>
  return <ul className="q3x-pl-list" aria-label="Search results">{props.hits.map((h) => <PriceRowCard key={h.key} row={h.row} path={h.path} />)}</ul>
}

export function PriceNotices(props: { lines: readonly string[] }): ReactElement | null {
  if (props.lines.length === 0) return null
  return <section className="q3x-pl-notes" aria-label="Price List rights">{props.lines.map((l) => <p key={l} className="q3x-pl-note-text">{l}</p>)}</section>
}

export function PriceEmptyState(props: { empty: PriceEmpty }): ReactElement {
  return (
    <div className="q3x-pl-empty" role="status">
      <ListBullets size={40} weight="duotone" aria-hidden="true" />
      <h2 className="q3x-pl-empty-title">{props.empty.title}</h2>
      <p className="q3x-pl-empty-text">{props.empty.body}</p>
      {props.empty.syncLine !== '' ? <p className="q3x-pl-sync-text">Sync: {props.empty.syncLine}</p> : null}
    </div>
  )
}

export type PriceChoiceStyle = 'chips' | 'steps' | 'groups'
export interface PriceChoiceItem { id: string; label: string; sub?: string; on?: boolean }

/** A list of buttons to pick a category or a tab. `style` is how the layout wants it drawn; the content is the same. */
export function PriceChoices(props: { items: readonly PriceChoiceItem[]; onPick: (id: string) => void; label: string; style: PriceChoiceStyle }): ReactElement {
  return (
    <ul className={`q3x-pl-choices q3x-pl-choices-${props.style}`} aria-label={props.label}>
      {props.items.map((i) => (
        <li key={i.id} className="q3x-pl-choice-li">
          <button type="button" className="q3x-pl-choice" aria-pressed={i.on === undefined ? undefined : i.on} onClick={() => props.onPick(i.id)}>
            <span className="q3x-pl-choice-label">{i.label}</span>
            {i.sub ? <span className="q3x-pl-choice-sub-text">{i.sub}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Loads the Price List and draws the states every layout shares: loading, error, switched off, empty (with the sync state in plain words). Once there is
 *  something to browse it draws the rights lines once and hands the data to the layout. `sync` is the last sync line the Dashboard loaded (null = unknown). */
export function PriceListGate(props: { db: PhoneDb | null; sync: SyncLine | null; onChanged?: () => void; refreshRights?: () => Promise<void>; now?: () => Date; children: (data: PriceListData) => ReactNode }): ReactElement {
  const state = usePriceList(props.db, props.refreshRights)
  const { onChanged } = props
  const reload = state.status === 'ready' ? state.reload : null
  // A saved change: read the list again and kick the push (the same `onDataChanged` the bill editor uses).
  const done = useCallback(() => { reload?.(); onChanged?.() }, [reload, onChanged])
  if (state.status === 'loading') return <p className="q3-muted" role="status">Loading</p>
  if (state.status === 'error') return <p className="q3-note q3-note-warn" role="alert">{state.message}</p>
  const { data, context } = state.loaded
  const db = props.db!
  if (!context.settings.enabled || data.categories.length === 0) {
    const empty = <PriceEmptyState empty={emptyState({ enabled: context.settings.enabled, linked: context.linked, anyRecords: data.anyRecords, sync: props.sync })} />
    // A linked phone with rights may start the list from nothing (add the first category).
    if (context.settings.enabled && context.linked) {
      return <div className="q3x-pl-page">{empty}<PriceEditProvider db={db} data={data} flags={context.rights} writable={context.writable} now={props.now} onDone={done}><StructurePanel /></PriceEditProvider></div>
    }
    return <div className="q3x-pl-page">{empty}</div>
  }
  return (
    <div className="q3x-pl-page">
      <PriceNotices lines={priceNotices(context.rights, context.refused, context.refusedNeeds)} />
      <PriceEditProvider db={db} data={data} flags={context.rights} writable={context.writable} now={props.now} onDone={done}>
        <StructurePanel />
        {props.children(data)}
      </PriceEditProvider>
    </div>
  )
}

/** The Dashboard entry of the new layouts (the bottom nav keeps exactly five tabs). Hidden only when the Price List is switched off on this phone. */
export function PriceListEntry(props: { db: PhoneDb | null; onOpen: () => void }): ReactElement | null {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    if (!props.db) return undefined
    let off = false
    getSetting(props.db, 'pricelist.enabled').then((v) => { if (!off) setEnabled(v !== false) }, () => undefined)
    return () => { off = true }
  }, [props.db])
  if (!enabled) return null
  return (
    <button type="button" className="q3x-pl-entry" onClick={props.onOpen}>
      <ListBullets size={24} weight="light" aria-hidden="true" />
      <span className="q3x-pl-entry-label">Price List</span>
    </button>
  )
}
