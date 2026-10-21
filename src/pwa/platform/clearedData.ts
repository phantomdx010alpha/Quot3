/** Phase 186 - "storage was cleared" detector. IndexedDB cannot tell us it was wiped (it just opens empty), so a tiny marker
 *  (the single word "1", NOT bill data) is kept next to it. Marker present but the database empty and unlinked = the browser cleared our data.
 *  [A] unconfirmed: a marker in localStorage is acceptable (the rule bans localStorage for bill data only). */
export const DATA_MARKER_KEY = 'quot3.phone.hadData'

export interface MarkerStore {
  get(): string | null
  set(): void
}

export function browserMarkerStore(): MarkerStore | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return { get: () => localStorage.getItem(DATA_MARKER_KEY), set: () => localStorage.setItem(DATA_MARKER_KEY, '1') }
  } catch {
    return null
  }
}

export interface DataFacts { readonly bills: number; readonly customers: number; readonly linked: boolean }
export type ClearedVerdict = 'ok' | 'cleared'

/** Sets the marker the first time there is anything to lose; says `cleared` when the marker exists and everything is gone. */
export function checkDataCleared(facts: DataFacts, marker: MarkerStore | null): ClearedVerdict {
  if (!marker) return 'ok'
  const hasData = facts.bills > 0 || facts.customers > 0 || facts.linked
  if (hasData) { try { marker.set() } catch { /* a full or blocked store must not stop the app */ } return 'ok' }
  return marker.get() === '1' ? 'cleared' : 'ok'
}

export const CLEARED_NOTE = 'This phone\'s Quot3 data is empty, but it had data before. The browser may have cleared it. Import a backup file in Settings, or sign in to sync to get your bills back.'
