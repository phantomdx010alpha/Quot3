import type { PhoneDb } from '../data/db'
import type { LinkInput, LinkResult } from '../sync/branch'
import type { EngineReader } from './loadDashboard'

export type ThemeName = 'navy-ember' | 'light'

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
  /** Sign in / sign out for Settings (Phase 185). */
  readonly sync?: SyncAdmin | null
  /** The app lock is on: the PIN screen shows before anything else (Phase 185). Decided at start by `bootstrapServices`. */
  readonly startLocked?: boolean
}
