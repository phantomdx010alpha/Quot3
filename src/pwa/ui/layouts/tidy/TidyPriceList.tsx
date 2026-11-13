import { useState, type ReactElement } from 'react'
import { PriceChoices, PriceHits, PriceListGate, PriceRowList, PriceSearch } from '../../kit/PriceListParts'
import { rowCount, tabsOf, tabView, type PriceListData } from '../../kit/priceListModel'
import { usePriceSearch } from '../../kit/usePriceList'
import type { ScreenProps } from '../types'

/** Tidy tabs Price List (Phase 245, read only): search on top, categories and tabs as wrapping chips, then the rows of the chosen tab with that tab's own
 *  columns. The first category and its first tab are open when the screen opens. */
function TidyBrowse(props: { data: PriceListData }): ReactElement {
  const { data } = props
  const search = usePriceSearch(data)
  const [catId, setCatId] = useState<string | null>(null)
  const [tabId, setTabId] = useState<string | null>(null)
  const category = data.categories.find((c) => c.id === catId) ?? data.categories[0]!
  const tabs = tabsOf(data, category.id)
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0]
  return (
    <>
      <PriceSearch value={search.query} onChange={search.setQuery} />
      {search.active ? <PriceHits hits={search.results} /> : (
        <>
          <PriceChoices style="chips" label="Categories" items={data.categories.map((c) => ({ id: c.id, label: c.name, on: c.id === category.id }))} onPick={(id) => { setCatId(id); setTabId(null) }} />
          {tabs.length === 0 ? <p className="q3-muted" role="status">This category has no tabs yet.</p> : (
            <PriceChoices style="chips" label="Tabs" items={tabs.map((t) => ({ id: t.id, label: t.name, sub: String(rowCount(data, t.id)), on: t.id === tab?.id }))} onPick={setTabId} />
          )}
          {tab ? <PriceRowList tabId={tab.id} label={tab.name} rows={tabView(tab, data.rows[tab.id] ?? [], data.tiers).rows} /> : null}
        </>
      )}
    </>
  )
}

export function TidyPriceList(props: ScreenProps): ReactElement {
  return <PriceListGate db={props.db} sync={props.dashboard?.view?.sync ?? null} onChanged={props.onChanged} refreshRights={props.refreshPriceRights} now={props.now}>{(data) => <TidyBrowse data={data} />}</PriceListGate>
}
