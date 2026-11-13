import { useEffect } from 'react'
import { FolderOpen, Tag } from '@phosphor-icons/react'
import { Button } from '../ui'
import { PriceBillingSettings } from './PriceBillingSettings'
import { PriceRightsSettings } from './PriceRightsSettings'
import { PriceActivitySettings } from './PriceActivitySettings'
import { usePriceListImportStore } from '../../stores/priceListImportStore'
import { useRouter } from '../../router/routerStore'
import { ROUTES } from '@shared/routes'

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Phase 237 (M23) - Settings > Price List. For now: import from the old inventory file, with a preview that writes nothing (docs/PRICELIST_IMPORT_SPEC.md). The Price List page is under Open Price List (Alt+P). */
export function PriceListSection(): React.JSX.Element {
  const label = usePriceListImportStore((s) => s.fileLabel)
  const preview = usePriceListImportStore((s) => s.preview)
  const result = usePriceListImportStore((s) => s.result)
  const error = usePriceListImportStore((s) => s.error)
  const busy = usePriceListImportStore((s) => s.busy)
  useEffect(() => () => usePriceListImportStore.getState().reset(), [])
  const st = usePriceListImportStore.getState()
  const p = preview
  const nothing = p !== null && p.items.added === 0 && p.items.changed === 0 && p.categories.added === 0 && p.tabs.added === 0

  return (
    <div className="q3-set__form" aria-label="Price List">
      <div className="q3-set__row">
        <Button type="button" variant="primary" icon={Tag} onClick={() => useRouter.getState().navigate(ROUTES.pricelist)}>Open Price List</Button>
        <span className="q3-set__muted">Categories, tabs, columns and prices, edited like the bill grid.</span>
      </div>
      <PriceBillingSettings />
      <PriceRightsSettings />
      <PriceActivitySettings />
      <h2 className="q3-page__title">Import from the old inventory</h2>
      <p className="q3-set__muted">Choose the old inventory file (bills_data.db). It is opened read-only and only its inventory lists are read, never its bills. Nothing is written until you press Import, and a backup is taken first. Importing again is safe: items you changed here are never overwritten and nothing is deleted.</p>
      <div className="q3-set__row">
        <Button type="button" icon={FolderOpen} disabled={busy} onClick={() => { void st.pick() }}>Choose file</Button>
        <span className="q3-set__muted" data-testid="pl-file">{label !== '' ? `File: ${label}` : 'No file chosen yet.'}</span>
      </div>

      {p && (
        <div className="q3-set__panel" role="region" aria-label="Import preview" data-testid="pl-preview">
          <h3 className="q3-set__sub">Preview (nothing has been written)</h3>
          <p data-testid="pl-counts">{plural(p.categories.total, 'category', 'categories')}, {plural(p.tabs.total, 'tab', 'tabs')}, {plural(p.items.total, 'item', 'items')}.</p>
          <p>{p.items.withPrice} with a price, {p.items.nameOnly} name only (no price yet).</p>
          <p data-testid="pl-new">To add: {plural(p.categories.added, 'category', 'categories')}, {plural(p.tabs.added, 'tab', 'tabs')}, {plural(p.items.added, 'item', 'items')}. To update: {p.items.changed}. Already the same: {p.items.unchanged}.</p>
          {p.items.editedHere > 0 && <p role="note">{plural(p.items.editedHere, 'item was', 'items were')} changed here after the last import and also changed in the old file. They will be left as they are here.</p>}
          {p.items.removedHere > 0 && <p role="note">{plural(p.items.removedHere, 'item was', 'items were')} deleted here after the last import. They will not be brought back.</p>}
          {p.items.alreadyThere > 0 && <p role="note">{plural(p.items.alreadyThere, 'item', 'items')} already in the Price List with the same name. They will be left as they are.</p>}
          <p>Tidied names: {p.cleaned.lineBreaks} with line breaks, {p.cleaned.edgeSpaces} with spaces at the ends (letters and numbers are never changed).</p>
          {p.tabsWithGap > 0 && <p>{plural(p.tabsWithGap, 'tab has', 'tabs have')} a gap in the row order; the rows are closed up.</p>}
          {(p.skipped.emptyName + p.skipped.orphanTab + p.skipped.orphanItem) > 0 && <p role="note">Skipped: {p.skipped.emptyName} without a name, {p.skipped.orphanTab + p.skipped.orphanItem} that belong to nothing.</p>}
          {(p.droppedValues + p.unmappedValues) > 0 && <p role="note">{p.droppedValues + p.unmappedValues} price value(s) could not be used (not a plain number, or no matching column) and will not be imported.</p>}
          {p.missingTiers.length > 0 && <p role="note">This Price List no longer has the price level(s) {p.missingTiers.join(', ')}; those columns will not be imported.</p>}
          <p className="q3-set__muted">Columns for new tabs: Item name, {p.columns.map((c) => c.label).join(', ')}.</p>
          <div className="q3-set__row">
            <Button type="button" variant="primary" disabled={busy || nothing || result !== null} onClick={() => { void st.run() }}>Import</Button>
            <Button type="button" disabled={busy} onClick={() => { void st.refresh() }}>Check again</Button>
          </div>
          {nothing && result === null && <p className="q3-set__muted">There is nothing new to import.</p>}
        </div>
      )}
      {result && (
        <p role="status" className="q3-set__saved" data-testid="pl-result">
          Imported: {plural(result.added, 'item', 'items')} added, {result.updated} updated.{result.backupFile ? ' A backup was taken first (see Backup and restore).' : ''}
        </p>
      )}
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
    </div>
  )
}
