/**
 * Phase 55: shared shapes and timing rules of the push worker (docs/SYNC_POSTBOX_SPEC.md section 6). Pure.
 * Normal cadence 15 s; after a failed run the wait doubles each time up to 10 minutes; a success resets it.
 */
export const PUSH_INTERVAL_MS = 15_000
export const PUSH_BACKOFF_CAP_MS = 600_000
/** After a save the worker runs this soon (not instantly: the save transaction must have committed and quick saves coalesce). */
export const PUSH_KICK_DELAY_MS = 250
/** At most this many outbox rows are read per batch. */
export const PUSH_BATCH_ROWS = 50
/** Upper bound for the base64 ciphertext in ONE push call (the server refuses a request over 8 MB of JSON). */
export const PUSH_BATCH_MAX_BYTES = 4 * 1024 * 1024
/** Safety valve: one run sends at most this many batches, then yields until the next tick. */
export const PUSH_MAX_BATCHES_PER_RUN = 40

/** Wait before the next run after `failures` failed runs in a row (0 = the normal interval). Doubles, capped. */
export function pushDelayMs(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return PUSH_INTERVAL_MS
  const n = Math.min(Math.trunc(failures), 20)
  return Math.min(PUSH_INTERVAL_MS * 2 ** n, PUSH_BACKOFF_CAP_MS)
}

/**
 * Why the worker is not sending right now.
 * `idle` = working normally; `offline` = no connection / timeout / server trouble (retries on its own);
 * `no_key` = activated but the encryption key is missing (activate again); `license` = the server refused the license / branch;
 * `not_activated` = sync is off on this computer; `stopped` = `stop()` was called.
 */
export type PushBlock = 'idle' | 'offline' | 'no_key' | 'license' | 'not_activated' | 'stopped'

export interface PushRunResult {
  /** Rows delivered to the postbox (or settled with nothing to send) in this run. */
  sent: number
  /** Rows whose attempt counter went up in this run. */
  failedAttempts: number
  /** Rows that reached `failed` (10 attempts) in this run. */
  poisoned: number
  block: PushBlock
}

export interface PushStatus {
  running: boolean
  block: PushBlock
  /** Failed runs in a row (drives the backoff). */
  consecutiveFailures: number
  /** Wait that applies after the current run. */
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  /** Rows delivered since the app started. */
  sentTotal: number
}

/** Transport failure kinds that mean "no connection / server unhappy" - they never count against a row's attempts. */
export const PUSH_CONNECTIVITY_KINDS = ['offline', 'timeout', 'server'] as const
/** Kinds that mean the license / branch is not accepted - the whole worker pauses, no row is blamed. */
export const PUSH_LICENSE_KINDS = ['license', 'unknown_branch'] as const

// ------------------------------------------------------------------------------------------------------- Phase 135 (shared notebook)

/** Why the v2 push / pull worker is not working right now: the v1 reasons plus a refused login and a paused server. */
export type SharedBlock = PushBlock | 'auth' | 'paused'

/**
 * What a failure of the shared-notebook transport (a `SharedErrorKind`, or an app error code from `connect()`) means for a worker:
 *  `offline` - no connection / timeout / server trouble: nothing counts against a row, back off;
 *  `paused`  - the Supabase project is paused: back off, show the "restore it" message;
 *  `auth`    - the seat login was refused: pause until the owner fixes it;
 *  `license` - license / membership / branch not accepted: pause;
 *  `row`     - the server refused the request itself (too large, too many, invalid): blame the row, isolate it from the batch.
 */
export type SharedFailureClass = 'offline' | 'paused' | 'auth' | 'license' | 'row'

export function classifySharedWorkerFailure(kindOrCode: string): SharedFailureClass {
  switch (kindOrCode) {
    case 'offline': case 'timeout': case 'server': case 'SYNC_OFFLINE': return 'offline'
    case 'server_paused': case 'SERVER_PAUSED': return 'paused'
    case 'auth_failed': case 'anon_key': case 'AUTH_FAILED': return 'auth'
    case 'invalid_input': case 'too_large': case 'too_many': case 'VALIDATION': return 'row'
    default: return 'license'
  }
}

/** The pause a failure class puts the worker into (`row` never pauses). */
export const sharedBlockFor = (c: Exclude<SharedFailureClass, 'row'>): SharedBlock => (c === 'offline' ? 'offline' : c === 'paused' ? 'paused' : c === 'auth' ? 'auth' : 'license')

/** The clock offset is measured against `sn_now()` again after this long (spec section 6). */
export const CLOCK_REMEASURE_MS = 600_000
