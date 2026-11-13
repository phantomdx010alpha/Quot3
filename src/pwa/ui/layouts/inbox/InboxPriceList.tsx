import { useState, type ReactElement } from 'react'
import { Button } from '../../kit/Button'
import { PriceChoices, PriceHits, PriceListGate, PriceRowList, PriceSearch } from '../../kit/PriceListParts'
import { rowCount, tabsOf, tabView, type PriceListData } from '../../kit/priceListModel'
import { usePriceSearch } from '../../kit/usePriceList'
import type { ScreenProps } from '../types'

/** Bills-inbox Price List (Phase 245, read only): search first, like the bills inbox. Below it every tab of every category is one list grouped by category;
 *  tapping a tab shows its rows with a Back to all tabs button. */
function InboxBrowse(props: { data: PriceListData }): ReactElement {
  const { data } = props
  const search = usePriceSearch(data)
  const [tabId, setTabId] = useState<string | null>(null)
  const tab = tabId === null ? undefined : data.tabs.find((t) => t.id === tabId)
  const category = tab ? data.categories.find((c) => c.id === tab.categoryId) : undefined
  return (
    <>
      <PriceSearch value={search.query} onChange={search.setQuery} />
      {search.active ? <PriceHits hits={search.results} /> : tab ? (
        <>
          <Button label="Back to all tabs" variant="text" onClick={() => setTabId(null)} />
          <h2 className="q3x-pl-group-title">{category ? `${category.name} > ${tab.name}` : tab.name}</h2>
          <PriceRowList tabId={tab.id} label={tab.name} rows={tabView(tab, data.rows[tab.id] ?? [], data.tiers).rows} />
        </>
      ) : (
        data.categories.map((c) => (
          <section key={c.id} aria-label={c.name}>
            <h2 className="q3x-pl-group-title">{c.name}</h2>
            {tabsOf(data, c.id).length === 0 ? <p className="q3-muted">No tabs yet.</p> : (
              <PriceChoices style="groups" label={c.name} items={tabsOf(data, c.id).map((t) => ({ id: t.id, label: t.name, sub: String(rowCount(data, t.id)) }))} onPick={setTabId} />
            )}
          </section>
        ))
      )}
    </>
  )
}

export function InboxPriceList(props: ScreenProps): ReactElement {
  return <PriceListGate db={props.db} sync={props.dashboard?.view?.sync ?? null} onChanged={props.onChanged} refreshRights={props.refreshPriceRights} now={props.now}>{(data) => <InboxBrowse data={data} />}</PriceListGate>
}
