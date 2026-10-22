import type { PhoneDb } from '../data/db'
import type { LinkInput, LinkResult } from '../sync/branch'
import type { PhoneSyncEngine } from '../sync/engine'
import type { EngineReader } from './loadDashboard'

import type { ThemeName } from './themes'
import type { LayoutId } from './layouts/layoutRegistry'
export type { ThemeName }

/** What Settings needs to sign the phone in as its own seat / branch (Phase 178 `linkPhoneToOrganisation`) and out again.
 *  Null / absent until the real browser transport is wired (the form then says so). */
export interface SyncAdmin {
  link(input: LinkInput): Promise<LinkResult>
  signOut(): Promise<void>
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
  readonly theme?: ThemeName
  /** The saved phone layout (Phase 189), already checked by `resolveLayout`. Absent = classic. */
  readonly layout?: LayoutId
  /** Sign in / sign out for Settings (Phase 185). */
  readonly sync?: SyncAdmin | null
  /** The full sync engine (first-sync choice, Sync now). Null until the phone is linked to a real transport. */
  readonly syncEngine?: PhoneSyncEngine | null
  /** The app lock is on: the PIN screen shows before anything else (Phase 185). Decided at start by `bootstrapServices`. */
  readonly startLocked?: boolean
}
