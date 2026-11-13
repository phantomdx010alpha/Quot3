import { useState, type ReactElement } from 'react'
import { Button } from '../../kit/Button'
import { PriceChoices, PriceHits, PriceListGate, PriceRowList, PriceSearch } from '../../kit/PriceListParts'
import { rowCount, tabsOf, tabView, type PriceListData } from '../../kit/priceListModel'
import { usePriceSearch } from '../../kit/usePriceList'
import type { ScreenProps } from '../types'

const countWord = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Guided Price List (Phase 245, read only): one step at a time. Step 1 pick a category, step 2 pick a tab, step 3 read the rows. Search is always on top
 *  and, while it has two letters, replaces the steps. A text Back button steps up inside the screen; the top-bar Back leaves the Price List. */
function GuidedBrowse(props: { data: PriceListData }): ReactElement {
  const { data } = props
  const search = usePriceSearch(data)
  const [catId, setCatId] = useState<string | null>(null)
  const [tabId, setTabId] = useState<string | null>(null)
  const category = catId === null ? undefined : data.categories.find((c) => c.id === catId)
  const tabs = category ? tabsOf(data, category.id) : []
  const tab = tabId === null ? undefined : tabs.find((t) => t.id === tabId)
  return (
    <>
      <PriceSearch value={search.query} onChange={search.setQuery} />
      {search.active ? <PriceHits hits={search.results} /> : !category ? (
        <>
          <h2 className="q3x-pl-group-title">Step 1 of 3: pick a category</h2>
          <PriceChoices style="steps" label="Categories" items={data.categories.map((c) => ({ id: c.id, label: c.name, sub: countWord(tabsOf(data, c.id).length, 'tab', 'tabs') }))} onPick={setCatId} />
        </>
      ) : !tab ? (
        <>
          <p className="q3x-pl-crumb-text">{category.name}</p>
          <h2 className="q3x-pl-group-title">Step 2 of 3: pick a tab</h2>
          {tabs.length === 0 ? <p className="q3-muted" role="status">This category has no tabs yet.</p> : (
            <PriceChoices style="steps" label="Tabs" items={tabs.map((t) => ({ id: t.id, label: t.name, sub: countWord(rowCount(data, t.id), 'item', 'items') }))} onPick={setTabId} />
          )}
          <Button label="Back to categories" variant="text" onClick={() => setCatId(null)} />
        </>
      ) : (
        <>
          <p className="q3x-pl-crumb-text">{category.name} {'>'} {tab.name}</p>
          <h2 className="q3x-pl-group-title">Step 3 of 3: prices</h2>
          <PriceRowList tabId={tab.id} label={tab.name} rows={tabView(tab, data.rows[tab.id] ?? [], data.tiers).rows} />
          <Button label="Back to tabs" variant="text" onClick={() => setTabId(null)} />
        </>
      )}
    </>
  )
}

export function GuidedPriceList(props: ScreenProps): ReactElement {
  return <PriceListGate db={props.db} sync={props.dashboard?.view?.sync ?? null} onChanged={props.onChanged} refreshRights={props.refreshPriceRights} now={props.now}>{(data) => <GuidedBrowse data={data} />}</PriceListGate>
}
