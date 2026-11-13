/** Phase 248 (M23): the Price List in the phone's first-sync and sync-status screens, in plain words. Pure: no database, no clock, no network.
 *  Used by the NEW layouts only (the Classic screens keep their exact words, see PHASE_STATUS "Classic decision"). */
export const EST_PRICE_ITEM_BYTES = 300
/** `meta` key written when a first-sync compare found the server has no Price List tables yet (file 18 not run). */
export const SERVER_MISSING_KEY = 'pricelist.serverMissing'

export interface PriceSyncInfo {
  /** false = the server refused the Price List kinds (file 18 was not run); bills and customers still sync. */
  available: boolean
  /** Price List records the first sync would download / send (all four kinds together). */
  download: number
  upload: number
}

export const NO_SERVER_PRICE_LIST =
  'This server has no Price List yet. Bills and customers sync as usual. Ask the owner to set up the Price List on the server, then check again.'

const kb = (n: number): string => (n < 1024 * 100 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The Price List line of the first-sync preview. */
export function priceFirstSyncNote(info: PriceSyncInfo): string {
  if (!info.available) return NO_SERVER_PRICE_LIST
  if (info.download === 0 && info.upload === 0) return 'Price List: nothing to download or send.'
  const parts: string[] = []
  if (info.download > 0) parts.push(`${plural(info.download, 'Price List entry', 'Price List entries')} to download (roughly ${kb(info.download * EST_PRICE_ITEM_BYTES)} on this phone, an estimate)`)
  if (info.upload > 0) parts.push(`${plural(info.upload, 'entry', 'entries')} to send`)
  return `${parts.join(', ')}.`
}

export interface PriceSyncStatus {
  /** Items (not deleted) held on this phone. */
  items: number
  /** Price List changes waiting to be sent. */
  queued: number
  /** Changes the main branch refused; they stay on this phone. */
  refused: number
  /** The last first-sync found no Price List on the server. */
  serverMissing: boolean
  /** Linked to sync at all. */
  linked: boolean
}

/** The sync-status lines, in the order they are shown. Never empty. */
export function priceSyncLines(s: PriceSyncStatus): string[] {
  const out: string[] = []
  if (s.serverMissing) out.push(NO_SERVER_PRICE_LIST)
  out.push(s.items === 0 ? 'Price List: nothing on this phone yet.' : `Price List: ${plural(s.items, 'item', 'items')} on this phone.`)
  if (s.linked && !s.serverMissing) out.push(s.queued > 0 ? `${plural(s.queued, 'Price List change is', 'Price List changes are')} waiting to be sent.` : 'Price List: everything is sent.')
  if (s.refused > 0) out.push(refusedLine(s.refused))
  return out
}

/** Offline-revoke wording: the change stays on the phone, it is flagged, and nothing is lost. */
export function refusedLine(n: number): string {
  return `${plural(n, 'Price List change was', 'Price List changes were')} not accepted by the main branch. ${n === 1 ? 'It stays' : 'They stay'} on this phone and ${n === 1 ? 'was' : 'were'} not sent. Ask the owner about your Price List rights.`
}

/** Storage and backup note for the new layouts: what the Price List adds and that the backup carries it. */
export function priceStorageNote(items: number): string {
  if (items === 0) return 'The Price List is empty on this phone. A backup file includes it once it has items.'
  return `The Price List holds ${plural(items, 'item', 'items')}, roughly ${kb(items * EST_PRICE_ITEM_BYTES)} on this phone (an estimate). It is included in the backup file.`
}
