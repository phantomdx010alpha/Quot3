import type { PhoneDb } from '../data/db'
import type { LinkInput, LinkResult } from '../sync/branch'
import type { ConnectCodeApi } from './ConnectCode'
import type { PhoneSyncEngine } from '../sync/engine'
import type { PaymentsSync } from '../sync/payments'
import type { EngineReader } from './loadDashboard'
import type { RestoreOutcome, RestoreProgress } from '../sync/restore'
import type { SelfCheckResult } from '../sync/selfCheck'

import type { ThemeName } from './themes'
import type { LayoutId } from './layouts/layoutRegistry'
export type { ThemeName }

/** What Settings needs to sign the phone in as its own seat / branch (Phase 178 `linkPhoneToOrganisation`) and out again.
 *  Null / absent until the real browser transport is wired (the form then says so). */
export interface SyncAdmin {
  link(input: LinkInput): Promise<LinkResult>
  signOut(): Promise<void>
  /** Phase 255: asks the main branch for this seat's Price List rights now ("Check again" in the sync status). Never throws. */
  checkPriceRights?(): Promise<void>
  /** Phase 294: the daily self-check (status line + "Check now" in Settings > Branch and sync). Absent = nothing is shown. */
  selfCheck?: SelfCheckApi
}

/** Phase 293: restore everything from the server (the runtime's `restore`). */
export interface RestoreApi {
  run(onProgress?: (p: RestoreProgress) => void): Promise<RestoreOutcome>
}

/** Phase 294: the daily self-check for Settings > Branch and sync ("Check now" and the status line). */
export interface SelfCheckApi {
  run(): Promise<SelfCheckResult>
  last(): Promise<SelfCheckResult | null>
}

/** What the running app hands to the screens. `db` is null when the database could not be opened (`error` says why). */
export interface AppServices {
  readonly db: PhoneDb | null
  readonly error?: string | null
  /** Null until the sync engine is wired to a real transport (a later phase); the Dashboard then shows the stored link state only. */
  readonly engine?: EngineReader | null
  readonly now?: () => Date
  /** Called after a screen changed bills (delete / restore). The sync engine's `notifySaved` goes here once it is wired. */
  readonly onDataChanged?: () => void
  /** Phase 246: asks the server for this seat's Price List rights and caches them (never throws). Absent = the phone keeps the rights it already knows. */
  readonly refreshPriceRights?: () => Promise<void>
  /** Phase 283: the Payments list sync (refresh / publish); absent = the list stays on this phone. */
  readonly payments?: PaymentsSync
  readonly theme?: ThemeName
  /** The saved phone layout (Phase 189), already checked by `resolveLayout`. Absent = classic. */
  readonly layout?: LayoutId
  /** Sign in / sign out for Settings (Phase 185). */
  readonly sync?: SyncAdmin | null
  /** The full sync engine (first-sync choice, Sync now). Null until the phone is linked to a real transport. */
  readonly syncEngine?: PhoneSyncEngine | null
  /** The app lock is on: the PIN screen shows before anything else (Phase 185). Decided at start by `bootstrapServices`. */
  readonly startLocked?: boolean
  /** Phase 269: the one-code first-launch screen. Absent (or `ready()` false) = the old behaviour, no gate. */
  readonly connectCode?: ConnectCodeApi | null
  /** Phase 293: the restore after a wipe (blank phone + one code, or "Restore from the server"). Absent = the old flow (Settings > sync). */
  readonly restore?: RestoreApi | null
}
