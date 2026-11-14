import { useRouter } from '../router/routerStore'
import { ROUTES, currentPath } from '@shared/routes'
import type { ActionId } from '@shared/shortcuts'
import { usePriceListStore } from './priceListStore'
import { exportCsv } from './priceListTools'

/**
 * Phase 238 (M23) - ONE runner for every Price List action. The page's window keydown listener (scope 'pricelist') and the command
 * palette (`useAppActions`) both call it, so a key and a palette entry can never behave differently.
 * Off the Price List page the palette entries only take you there (they need the page's grid and ports).
 */
export const PRICELIST_ACTION_IDS: readonly ActionId[] = [
  'pricelist.rowAbove', 'pricelist.rowBelow', 'pricelist.rowDelete', 'pricelist.rowUp', 'pricelist.rowDown',
  'pricelist.section', 'pricelist.columns', 'pricelist.tiers', 'pricelist.panel', 'pricelist.noPrice', 'pricelist.newTab',
  'pricelist.tabPrev', 'pricelist.tabNext', 'pricelist.fillDown', 'pricelist.fillRight', 'pricelist.search', 'pricelist.find', 'pricelist.bulk', 'pricelist.csv'
]

export function runPriceListAction(id: ActionId): void {
  const st = usePriceListStore.getState()
  switch (id) {
    case 'pricelist.rowAbove': st.insertRow('above'); break
    case 'pricelist.rowBelow': st.insertRow('below'); break
    case 'pricelist.rowDelete': st.deleteSelected(); break
    case 'pricelist.rowUp': st.moveSelected(-1); break
    case 'pricelist.rowDown': st.moveSelected(1); break
    case 'pricelist.section': st.toggleSection(); break
    case 'pricelist.columns': if (st.tabId) st.openDialog('columns'); break
    case 'pricelist.tiers': st.openDialog('tiers'); break
    case 'pricelist.panel': st.togglePanel(); break
    case 'pricelist.noPrice': st.setFilter({ noPrice: !st.filter.noPrice }); break
    case 'pricelist.newTab': st.ports.askAddTab?.(); break
    case 'pricelist.tabPrev': void st.stepTab(-1); break
    case 'pricelist.tabNext': void st.stepTab(1); break
    case 'pricelist.fillDown': st.fill('down'); break
    case 'pricelist.fillRight': st.fill('right'); break
    case 'pricelist.search': st.ports.focusSearch?.(); break
    case 'pricelist.find': if (st.tabId) st.openDialog('find'); break
    case 'pricelist.bulk': if (st.tabId) st.openDialog('bulk'); break
    case 'pricelist.csv': exportCsv(); break
    default: break
  }
}

/** Palette / hotkey entry: on the page run it, elsewhere go to the page first. */
export function viaPriceList(id: ActionId, navigate: (p: string) => void): void {
  if (currentPath(useRouter.getState().nav) === ROUTES.pricelist) { runPriceListAction(id); return }
  navigate(ROUTES.pricelist)
}
