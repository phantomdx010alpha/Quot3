import type { PhoneDb } from '../data/db'
import { getSetting, resetSetting, setSetting } from '../data/settingsRepo'
import { masterErrorWords } from '../../shared/master/errors'
import { isTransientKind, toSyncFailure } from './errors'
import { PhoneMasterError, type PhoneMasterClient } from './master'
import type { SessionVault } from './session'
import type { PhoneSyncPort } from './transport'

/**
 * Phase 269 (M24) - the phone side of "a reset seat reconnects by itself" (API_CONTRACTS.md M24-O; desktop twin: Phase 267).
 * Called ONLY when the stored login was refused (`auth_failed`). With a device token in the vault the phone asks the master ONCE for the seat's
 * new password (`refresh`), signs in with it for this call only (the password is never stored or logged), and keeps the new session in the vault.
 * - master says the seat was removed (Q3M07) or the device is unknown (Q3M04): the `seat removed` flag is set (a screen shows it); local data stays.
 * - master unreachable / any other master problem: nothing changes, the phone keeps its "paused, will retry" state.
 * - no device token, legacy seat (no password), or the new password is refused: the old "Sign in again" path.
 * - no loops: one attempt per 60 s.
 */
export const RECREDENTIAL_MIN_GAP_MS = 60_000
export const SEAT_REMOVED_SETTING = 'connect.seatRemoved'
export const SEAT_REMOVED_WORDS = 'This seat was removed. Ask the admin for a new code.'

export type RecredentialResult =
  | { state: 'recovered' }
  | { state: 'removed'; message: string }
  | { state: 'unreachable'; message: string }
  | { state: 'none' } // no device token / legacy seat / new password refused: fall back to "Sign in again"
  | { state: 'throttled' }

export interface RecredentialDeps {
  db: PhoneDb
  vault: SessionVault
  port: Pick<PhoneSyncPort, 'signIn'>
  master: PhoneMasterClient
  nowMs?: () => number
}

export interface PhoneRecredential { attempt(): Promise<RecredentialResult> }

export function createPhoneRecredential(deps: RecredentialDeps): PhoneRecredential {
  let lastAt = -Infinity
  let last: RecredentialResult = { state: 'none' }

  async function run(): Promise<RecredentialResult> {
    let data: Awaited<ReturnType<SessionVault['load']>>
    try { data = await deps.vault.load() } catch { return { state: 'none' } }
    if (!data?.deviceToken || !deps.master.configured()) return { state: 'none' }
    let seatEmail: string
    let password: string | null
    try {
      const r = await deps.master.refresh(data.deviceToken)
      seatEmail = r.seat.email
      password = r.seat.password
    } catch (e) {
      const code = e instanceof PhoneMasterError ? e.code : 'Q3M99'
      if (code === 'Q3M07' || code === 'Q3M04') {
        try { await setSetting(deps.db, SEAT_REMOVED_SETTING, true) } catch { /* the words below still stop this attempt */ }
        return { state: 'removed', message: SEAT_REMOVED_WORDS }
      }
      return { state: 'unreachable', message: masterErrorWords(code) }
    }
    if (!password) return { state: 'none' } // a legacy seat has no code-managed password
    try {
      const session = await deps.port.signIn({ email: seatEmail, password })
      const latest = (await deps.vault.load()) ?? data
      await deps.vault.save({ ...latest, email: seatEmail, session })
      return { state: 'recovered' }
    } catch (e) {
      const f = toSyncFailure(e)
      return isTransientKind(f.kind) ? { state: 'unreachable', message: f.message } : { state: 'none' } // refused: the old "Sign in again" path
    }
  }

  return {
    async attempt() {
      const now = (deps.nowMs ?? Date.now)()
      // Within the gap: repeat the last "paused" / "removed" answer (the workers retry often), never a fresh master call.
      if (now - lastAt < RECREDENTIAL_MIN_GAP_MS) return last.state === 'unreachable' || last.state === 'removed' ? last : { state: 'throttled' }
      let hasToken = false
      try { hasToken = Boolean((await deps.vault.load())?.deviceToken) } catch { /* treated as no token */ }
      if (hasToken) lastAt = now
      const r = await run()
      last = r
      return r
    }
  }
}

export async function isSeatRemoved(db: PhoneDb): Promise<boolean> {
  return (await getSetting<boolean>(db, SEAT_REMOVED_SETTING, false)) === true
}

export async function clearSeatRemoved(db: PhoneDb): Promise<void> {
  await resetSetting(db, SEAT_REMOVED_SETTING)
}
