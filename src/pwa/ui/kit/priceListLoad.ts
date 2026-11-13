/** Phase 245 (M23) - reads the Price List from the phone database for the screens. READ ONLY (Phase 246 adds only the cached rights and the refused count, also reads): no `save*`, no `softDelete*`, no outbox, so it is safe in a
 *  read-only tab. The whole list is read in one go (a few thousand rows is small for IndexedDB); each tab's rows come from the repo's own `tab_idx` index. */
import type { PhoneDb } from '../../data/db'
import { getMeta } from '../../data/metaRepo'
import { hasPriceList, listCategories, listRows, listTabs, listTiers } from '../../data/priceListRepo'
import { readCachedPerms, readRefused, rightsFor } from '../../data/priceRights'
import { getAllSettings } from '../../data/settingsRepo'
import { readPriceListSettings, type PriceListSettings } from '../../../shared/pricelist/settings'
import type { PermFlags } from '../../../shared/pricelist/perms'
import type { PriceRowRec, PriceTabRec } from '../../../shared/sync/priceListRecords'
import { buildPriceData, type PriceListData } from './priceListModel'

export interface PriceListContext {
  /** The `pricelist.*` settings the phone reads (tolerant: a bad value falls back to its default). The phone writes none of them yet. */
  settings: PriceListSettings
  /** Linked to an organisation (sync signed in). */
  linked: boolean
  /** The seat's rights now: the last server answer cached on this phone (Phase 246); none cached on a linked phone = none [A]. */
  rights: PermFlags
  /** Local changes the main branch refused (the kept-list size; ids only). */
  refused: number
  /** False in a tab that is not the writer. */
  writable: boolean
}

export interface PriceListLoaded { data: PriceListData; context: PriceListContext }

export async function loadPriceContext(db: PhoneDb): Promise<PriceListContext> {
  const [all, meta, cached, refused] = await Promise.all([getAllSettings(db), getMeta(db), readCachedPerms(db), readRefused(db)])
  const linked = meta.org_id !== null && meta.branch_id !== null
  return { settings: readPriceListSettings(all), linked, rights: rightsFor(linked, cached), refused: refused.length, writable: db.canWrite() }
}

export async function loadPriceData(db: PhoneDb): Promise<PriceListData> {
  const [tiers, categories, anyRecords] = await Promise.all([listTiers(db), listCategories(db), hasPriceList(db)])
  const tabs: PriceTabRec[] = []
  for (const c of categories) tabs.push(...(await listTabs(db, c.id)))
  const rows: Record<string, PriceRowRec[]> = {}
  for (const t of tabs) rows[t.id] = await listRows(db, t.id)
  return buildPriceData({ tiers, categories, tabs, rows, anyRecords })
}

export async function loadPriceList(db: PhoneDb): Promise<PriceListLoaded> {
  const [data, context] = await Promise.all([loadPriceData(db), loadPriceContext(db)])
  return { data, context }
}
