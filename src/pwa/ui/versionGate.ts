import { countAside } from '../sync/aside'
import type { PhoneDb } from '../data/db'

/** Phase 186 - the version gate. Records written by a newer app (`min_reader_ver` above this build) are kept aside whole (Phase 179).
 *  This turns the count into the sentence the person sees. Nothing is ever stripped or deleted by showing it. */
export interface AsideCounts { readonly total: number; readonly bills: number }

export function versionGateMessage(c: AsideCounts): string | null {
  if (c.total <= 0) return null
  if (c.bills > 0) return `Update the app to see ${c.bills} ${c.bills === 1 ? 'bill' : 'bills'}.`
  return `Update the app to see ${c.total} newer ${c.total === 1 ? 'record' : 'records'}.`
}

export async function loadVersionGate(db: PhoneDb): Promise<string | null> {
  try {
    return versionGateMessage(await countAside(db))
  } catch {
    return null
  }
}
