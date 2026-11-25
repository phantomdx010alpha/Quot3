/** Phase 292 - phone data protection. PURE: no IndexedDB, no browser globals (the reader is `ui/protectionRead.ts`).
 *  Honest limit (M25 4.6): a browser can clear everything, the sync login included. This only makes loss rare and visible;
 *  it never says the data "cannot be lost" and it never blocks anything (D7: warn only). */
import type { StorageHealth } from './storage'

export type Tri = 'yes' | 'no' | 'unknown'
export type MarkerCount = 'both' | 'one' | 'none'

export interface ProtectionState {
  readonly persisted: Tri
  readonly installed: Tri
  readonly used: number | null
  readonly quota: number | null
  /** Bills not on the server yet (unsent or failed outbox rows of kind `bill`) [A]: the warning line talks about bills only. */
  readonly pending: number
  /** ISO time of the newest successful push or pull; null = never / not known. */
  readonly lastSyncAt: string | null
  readonly markers: MarkerCount
}

export interface ProtectionInputs {
  readonly health: StorageHealth | null
  /** true = running as an installed app, false = in a browser tab, null = cannot tell. */
  readonly installed: boolean | null
  readonly pending: number
  readonly pushOkAt?: string | null
  readonly pullOkAt?: string | null
  readonly markerLocal: boolean
  readonly markerDb: boolean
}

const tri = (v: boolean | null | undefined): Tri => (v === true ? 'yes' : v === false ? 'no' : 'unknown')

function newest(a: string | null | undefined, b: string | null | undefined): string | null {
  const ta = a ? Date.parse(a) : NaN
  const tb = b ? Date.parse(b) : NaN
  if (Number.isNaN(ta) && Number.isNaN(tb)) return null
  if (Number.isNaN(tb) || ta >= tb) return a ?? null
  return b ?? null
}

export function protectionState(i: ProtectionInputs): ProtectionState {
  return {
    persisted: tri(i.health?.persisted),
    installed: tri(i.installed),
    used: i.health?.usageBytes ?? null,
    quota: i.health?.quotaBytes ?? null,
    pending: Math.max(0, Math.trunc(i.pending) || 0),
    lastSyncAt: newest(i.pushOkAt, i.pullOkAt),
    markers: i.markerLocal && i.markerDb ? 'both' : i.markerLocal || i.markerDb ? 'one' : 'none'
  }
}

export const PERSIST_BANNER_TEXT = 'Your phone may delete this data. Install the app and tap Keep my data.'
export const INSTALL_STEPS_TEXT = 'To install: open the browser menu and tap Install app (or Add to Home screen).'
export const KEEP_MY_DATA_LABEL = 'Ask the browser to keep my data'

export type ProtectionActionId = 'keep' | 'install'
export interface PersistBanner { text: string; actions: ProtectionActionId[]; steps: string | null }

/** The calm banner. [A] Shown only when the browser ANSWERED "not kept" (`persisted === 'no'`): when the answer is unknown (the API is missing or
 *  the call failed) there is nothing the person could tap, so no banner (Settings still says "unknown"). The contract line said `!== 'yes'`; see the phase log. */
export function persistBanner(s: ProtectionState, o: { persistApi: boolean; canInstall: boolean }): PersistBanner | null {
  if (s.persisted !== 'no') return null
  const actions: ProtectionActionId[] = []
  if (o.persistApi) actions.push('keep')
  if (o.canInstall) actions.push('install')
  const steps = s.installed !== 'yes' && !o.canInstall ? INSTALL_STEPS_TEXT : null
  return { text: PERSIST_BANNER_TEXT, actions, steps }
}

/** "N bills are only on this phone yet. Sync now." Only when the phone is linked and something is waiting. Nothing is blocked. */
export function unsyncedLine(s: ProtectionState, linked: boolean): string | null {
  if (!linked || s.pending <= 0) return null
  return s.pending === 1 ? '1 bill is only on this phone yet. Sync now.' : `${s.pending} bills are only on this phone yet. Sync now.`
}

/** Plain words for Settings > Storage. */
export function installedWord(s: ProtectionState): string {
  return s.installed === 'yes' ? 'yes' : s.installed === 'no' ? 'no, open in the browser' : 'unknown'
}
export function markersWord(m: MarkerCount): string {
  return m === 'both' ? 'two' : m === 'one' ? 'one' : 'none yet'
}

/** Whether to ask the browser to keep the data again: after the app was installed, and once after the first save, only while it is not kept. */
export function shouldReRequest(s: ProtectionState | null, trigger: 'installed' | 'firstSave'): boolean {
  if (trigger === 'installed') return true
  return s === null || s.persisted !== 'yes'
}
