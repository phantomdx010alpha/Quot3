import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { visibleRange, scrollTopFor } from '@shared/items/windowing'
import { useScrollView } from './useScrollView'
import { buildSalesListRows, dateText, flagText, saleCells, salesColumns, GST_TAB, SALES_TAB_IDS, statsText, tabOf, type SalesTabId } from '@shared/items/salesView'
import type { GroupSales } from '@shared/items/api'
import { ITEMS_ROW_PX } from './GroupsWindow'

export interface SalesPanelProps {
  /** Sales of the selected group; null while loading / nothing selected. */
  sales: GroupSales | null
  /** The selected group's name ('' = none selected). */
  groupName: string
  tab: SalesTabId
  cursor: number
  /** Party filter (partyKey) and its display name. */
  partyFilter: string | null
  /** The scrolling element (the window's focusable content div). */
  getScroll: () => HTMLElement | null
  onTab: (id: SalesTabId) => void
  onCursor: (i: number) => void
  onOpen: (i: number) => void
  onParty: (partyKey: string) => void
  onClearParty: () => void
}

const TAB_LABEL: Record<SalesTabId, string> = { nonGst: 'Non-GST', gst: 'GST' }

/**
 * Phase 114 - Window 3: what the selected item sold for. Tabs Non-GST / GST (never mixed), a one-line summary, the party filter chip,
 * the sales (newest first, high / low rate flags), then "who paid what" (last rate per party). Virtualised: only visible rows are in the DOM.
 * The highlighted sale is `cursor`; keys live in `windowKeys.ts`. Enter / double-click opens the sale's bill.
 */
export function SalesPanel(p: SalesPanelProps): React.JSX.Element {
  const { sales, groupName, tab, cursor, partyFilter } = p
  const t = sales ? tabOf(sales, tab) : null
  const list = useMemo(() => (t ? buildSalesListRows(t) : []), [t])
  const head = useRef<HTMLDivElement | null>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => { setMargin(head.current ? head.current.offsetHeight : 0) })
  // Phase 117: own windowing on the scrolling content div. The sticky header (`margin` px) sits above the list, so the list's own
  // viewport starts at scrollTop and is `h - margin` tall; rows are plain flow between two spacers (no absolute positions).
  const view = useScrollView(p.getScroll, list.length + margin)
  const cursorRow = t && cursor >= 0 && t.rows.length > 0 ? list.findIndex((r) => r.kind === 'sale' && r.index === Math.min(cursor, t.rows.length - 1)) : -1
  useLayoutEffect(() => {
    const el = p.getScroll()
    if (!el || cursorRow < 0) return
    const next = scrollTopFor(cursorRow, ITEMS_ROW_PX, el.scrollTop, el.clientHeight - margin, list.length)
    if (next !== el.scrollTop) el.scrollTop = next
    view.read()
  }, [cursorRow, list.length, margin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (groupName === '') return <div className="q3-items__note">Select an item in Groups.</div>
  if (!sales || !t) return <div className="q3-items__note" role="status">Reading the sales of {groupName}...</div>

  const cols = salesColumns(tab)
  const range = visibleRange(list.length, ITEMS_ROW_PX, view.top, view.h - margin, 12)
  const filterName = partyFilter === null ? '' : (t.rows[0]?.partyName ?? sales.nonGst.rows[0]?.partyName ?? sales.gst.rows[0]?.partyName ?? 'one party')
  const gstCount = sales.gst.stats.count
  const nonGstCount = sales.nonGst.stats.count
  const counts: Record<SalesTabId, number> = { nonGst: nonGstCount, gst: gstCount }
  const rowCls = tab === GST_TAB ? 'q3-items__row--sale q3-items__row--sale-gst' : 'q3-items__row--sale'

  return (
    <div className="q3-items__sales">
      <div ref={head} className="q3-items__saleshead">
        <div className="q3-items__tabs" role="tablist" aria-label="Sales by bill type">
          {SALES_TAB_IDS.map((id) => (
            <button key={id} type="button" role="tab" tabIndex={-1} aria-selected={id === tab} className={`q3-items__tab${id === tab ? ' q3-items__tab--on' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); p.getScroll()?.focus(); p.onTab(id) }}>
              {TAB_LABEL[id]} <span className="q3-items__muted">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="q3-items__stats" title={statsText(t.stats)}>{statsText(t.stats)}</div>
        {partyFilter !== null && (
          <div className="q3-items__chip">
            <span title={filterName}>Only {filterName}</span>
            <button type="button" tabIndex={-1} aria-label="Show all parties" onMouseDown={(e) => { e.preventDefault(); p.getScroll()?.focus(); p.onClearParty() }}>&times;</button>
          </div>
        )}
        {t.truncated && <div className="q3-items__status">Showing the newest {t.rows.length} sales. Filter by party to see the rest.</div>}
        {t.rows.length > 0 && (
          <div className={`q3-items__row q3-items__row--colhead ${rowCls}`} role="row">
            {cols.map((c, i) => <span key={c} role="columnheader" className={i >= 3 ? 'q3-items__num' : ''}>{c}</span>)}
            <span role="columnheader" />
          </div>
        )}
      </div>
      {t.rows.length === 0 ? (
        <div className="q3-items__note">{partyFilter !== null ? 'This party has no sales of the item here.' : `No ${TAB_LABEL[tab]} sales of ${groupName}.`}{tab === 'nonGst' && gstCount > 0 && partyFilter === null ? ' Press G for the GST sales.' : ''}</div>
      ) : (
        <div role="grid" aria-label={`${TAB_LABEL[tab]} sales of ${groupName}`} aria-rowcount={list.length} aria-activedescendant={t.rows[cursor] ? `q3-is-${cursor}` : undefined}>
          <div aria-hidden="true" style={{ height: range.start * ITEMS_ROW_PX }} />
          {list.slice(range.start, range.end).map((r, k) => {
            const pos = { height: ITEMS_ROW_PX } as const
            const rowNo = range.start + k + 1
            if (r.kind === 'sub') return <div key={r.key} role="presentation" className="q3-items__sub" style={pos}>{r.text}</div>
            if (r.kind === 'party') {
              const x = r.party
              return (
                <div key={r.key} role="row" aria-rowindex={rowNo} className={`q3-items__row q3-items__row--party${x.partyKey === partyFilter ? ' q3-items__row--mark' : ''}`} style={pos}
                  onMouseDown={(e) => { e.preventDefault(); p.getScroll()?.focus(); p.onParty(x.partyKey) }}>
                  <span role="gridcell" title={x.partyName}>{x.partyName}</span>
                  <span role="gridcell" className="q3-items__num" title="Last rate">{x.rate}</span>
                  <span role="gridcell" className="q3-items__muted" title={`${x.poNumber}`}>{dateText(x.date)}</span>
                  <span role="gridcell" className="q3-items__num q3-items__muted" title="Sales">{x.sales}</span>
                  <span role="gridcell" className={`q3-items__flag${x.outlier ? ` q3-items__flag--${x.outlier}` : ''}`}>{flagText(x.outlier)}</span>
                </div>
              )
            }
            const cells = saleCells(r.row, tab)
            const sel = r.index === cursor
            return (
              <div key={r.key} id={`q3-is-${r.index}`} role="row" aria-rowindex={rowNo} aria-selected={sel} className={`q3-items__row ${rowCls}`} style={pos}
                onMouseDown={(e) => { e.preventDefault(); p.getScroll()?.focus(); p.onCursor(r.index) }}
                onDoubleClick={() => p.onOpen(r.index)}>
                {cells.map((c, i) => <span key={cols[i]} role="gridcell" className={i >= 3 ? 'q3-items__num' : i === 0 ? 'q3-items__muted' : ''} title={i === 1 ? `${c}${r.row.name !== c ? ` - sold as ${r.row.name}` : ''}` : c}>{c}</span>)}
                <span role="gridcell" className={`q3-items__flag${r.row.outlier ? ` q3-items__flag--${r.row.outlier}` : ''}`} title={r.row.outlier ? `Rate is far ${r.row.outlier === 'high' ? 'above' : 'below'} the usual (median ${t.groupMedianRate ?? ''})` : ''}>{flagText(r.row.outlier)}</span>
              </div>
            )
          })}
          <div aria-hidden="true" style={{ height: (list.length - range.end) * ITEMS_ROW_PX }} />
        </div>
      )}
    </div>
  )
}
