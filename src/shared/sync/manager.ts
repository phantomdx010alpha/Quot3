import { z } from 'zod'
import type { OutboxCounts } from './outbox'
import { deliveryText, type DeliveryMode, type PullStatus } from './pull'
import type { PushStatus } from './push'

/**
 * Phase 59: the sync manager's shared shapes and the ONE place that turns the workers' raw state into what the owner sees
 * (Settings > Sync status, the Dashboard chip). Pure: no Electron, no Node, no DOM.
 *
 * `mode` is the headline state:
 *  - `off`        no license is activated on this computer (sync does not exist here);
 *  - `paused`     activated but switched off by the owner: nothing is sent or fetched, changes are still queued;
 *  - `attention`  something needs the owner (license refused, key missing, a change given up on, a conflict, a change that could not be read);
 *  A change held for the bill open in the editor counts as `working` (the Create banner asks the owner).
 *  - `offline`    no connection to Supabase right now (retries on its own, nothing is lost);
 *  - `working`    changes are waiting to go out, or a run is in progress;
 *  - `ok`         everything is sent and received.
 */
export type SyncMode = 'off' | 'paused' | 'attention' | 'offline' | 'working' | 'ok'

/** What the workers report, trimmed to what the UI needs. */
export interface SyncSide {
  running: boolean
  /** `idle`, `offline`, `no_key`, `license`, `not_activated`, `stopped` and (pull only) `decrypt`. */
  block: string
  consecutiveFailures: number
  /** Milliseconds until the next automatic run after the current state (0 when not waiting). */
  nextDelayMs: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

export interface SyncOverview {
  /** A license is activated on this computer. */
  activated: boolean
  /** The owner's switch (always true while not activated, so the UI can show it as unavailable instead). */
  enabled: boolean
  /** The database is read-only (made by a newer version): nothing can be switched or retried. */
  readOnly: boolean
  mode: SyncMode
  /** Short chip text: `Sync: up to date`. */
  chip: string
  /** One sentence for the Sync status page. */
  headline: string
  push: SyncSide
  pull: SyncSide
  /** Changes waiting to be sent / given up on (retry puts them back). */
  pending: number
  failed: number
  /** Bills still marked `conflict`, and changes held for the bill open in the editor. */
  conflicts: number
  held: number
  /** Changes from other branches that could not be read and were skipped (still on the server). */
  skipped: number
  /** Applied changes whose acknowledgement has not reached the server yet. */
  unacked: number
  oldestPendingAt: string | null
  /** Latest successful send / receive (ISO) or null. */
  lastPushAt: string | null
  lastPullAt: string | null
  /** Distinct, short, human-readable problems (most important first). */
  errors: string[]
  /** Phase 136: records a newer app wrote, kept aside by this app (never applied, stripped or overwritten). */
  aside: AsideCounts
  /** "Update the app to see 12 bills." or '' when nothing is set aside (Sync status and History show it). */
  asideLine: string
  /** Phase 138: how changes arrive: `live` (the Realtime doorbell is connected) or `polling` (checked every minute). */
  delivery: DeliveryMode
  /** "Live" or "Checking every minute". */
  deliveryText: string
  /** Phase 139: the sync server is paused or not answering (free-plan pause), as opposed to "no internet". */
  serverPaused: boolean
  /** Phase 139: the stored login was refused and this computer must sign in again. */
  signedOut: boolean
  /** Phase 139: this computer's clock differs from the server's by this many ms (signed; 0 when unknown) and the sentence to show ('' when within `CLOCK_WARN_MS`). */
  clockOffsetMs: number
  clockWarning: string
}

/** Phase 139 [A]: a clock more than 2 minutes off the server's is worth a warning (the server clock only breaks ties between edits). */
export const CLOCK_WARN_MS = 120_000

/** The clock sentence ('' when the offset is small or unknown). Pure. */
export function clockWarningText(offsetMs: number): string {
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) <= CLOCK_WARN_MS) return ''
  const min = Math.round(Math.abs(offsetMs) / 60_000)
  return `This computer's clock is about ${min} ${min === 1 ? 'minute' : 'minutes'} ${offsetMs > 0 ? 'behind' : 'ahead of'} the server's. Fix the date and time in Windows so edits from different branches are ordered correctly.`
}

/** Set-aside records per kind (`asideService.countsByKind()`). */
export interface AsideCounts { bills: number; customers: number; rules: number; total: number }
export const NO_ASIDE: AsideCounts = { bills: 0, customers: 0, rules: 0, total: 0 }

/** `asideService.countsByKind()` (kind -> count) in the shape the UI uses. Unknown kinds count in `total` only. */
export function asideCountsFrom(byKind: Readonly<Record<string, number>>): AsideCounts {
  const n = (k: string): number => { const v = byKind[k]; return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0 }
  const total = Object.values(byKind).reduce((a, v) => a + (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0), 0)
  return { bills: n('bill'), customers: n('party') + n('party_merge'), rules: n('item_rule'), total }
}

/** The one sentence about set-aside records ('' when none). Bills first; other kinds only when there are no bills to name. */
export function asideLine(a: AsideCounts): string {
  if (a.total <= 0) return ''
  if (a.bills > 0) return `Update the app to see ${a.bills} ${a.bills === 1 ? 'bill' : 'bills'}.`
  return `Update the app to see ${a.total} ${a.total === 1 ? 'change' : 'changes'} from other branches.`
}

/** Raw inputs for `deriveOverview` (the manager collects them; tests build them by hand). */
export interface OverviewInput {
  activated: boolean
  enabled: boolean
  readOnly: boolean
  push: PushStatus | null
  pull: PullStatus | null
  counts: OutboxCounts
  oldestPendingAt: string | null
  conflicts: number
  /** Phase 136 (optional: absent = none). */
  aside?: AsideCounts
  /** Phase 138: the doorbell is connected (absent = not live: the minute poll is doing the work). */
  live?: boolean
  /** Phase 139 (optional: absent = false / 0). `offsetMs` = server time minus this computer's time. */
  serverPaused?: boolean
  signedOut?: boolean
  clockOffsetMs?: number
}

const IDLE_SIDE: SyncSide = { running: false, block: 'stopped', consecutiveFailures: 0, nextDelayMs: 0, lastRunAt: null, lastSuccessAt: null, lastError: null }

function side(s: PushStatus | PullStatus | null): SyncSide {
  if (!s) return IDLE_SIDE
  return { running: s.running, block: s.block, consecutiveFailures: s.consecutiveFailures, nextDelayMs: s.nextDelayMs, lastRunAt: s.lastRunAt, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError }
}

/** Latest of two optional ISO times. */
const latest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a >= b ? a : b)

const CHIP: Record<SyncMode, string> = {
  off: 'Sync: off',
  paused: 'Sync: paused',
  attention: 'Sync: needs attention',
  offline: 'Sync: offline',
  working: 'Sync: sending',
  ok: 'Sync: up to date'
}

/** Pure: the headline state and every number the Sync status page and the Dashboard chip show. */
export function deriveOverview(i: OverviewInput): SyncOverview {
  const push = side(i.push), pull = side(i.pull)
  const held = i.pull?.held.length ?? 0
  const skipped = i.pull?.skipped.length ?? 0
  const unacked = i.pull?.unacked ?? 0
  const errors: string[] = []
  const add = (m: string | null | undefined): void => { if (m && m.trim() !== '' && !errors.includes(m)) errors.push(m) }

  let mode: SyncMode
  let headline: string
  if (!i.activated) {
    mode = 'off'; headline = 'Sync is off. Sign in with this computer\'s login to share bills with other branches.'
  } else if (!i.enabled) {
    mode = 'paused'
    headline = i.counts.pending > 0
      ? `Sync is switched off here. ${i.counts.pending} ${i.counts.pending === 1 ? 'change is' : 'changes are'} kept and will be sent when you switch it on.`
      : 'Sync is switched off here. Changes you make are kept and will be sent when you switch it on.'
  } else {
    const blocks = [push.block, pull.block]
    if (blocks.includes('no_key')) { add('The encryption key is missing on this computer. Deactivate and activate again.') }
    if (blocks.includes('license')) { add('Supabase refused the license or this branch. Check the license in Sync and license above.') }
    if (pull.block === 'decrypt') { add('A change from another branch could not be read (wrong passphrase on one branch, or damaged data).') }
    if (i.counts.failed > 0) add(`${i.counts.failed} ${i.counts.failed === 1 ? 'change was' : 'changes were'} given up on after repeated errors. Use Retry.`)
    const asideNote = asideLine(i.aside ?? NO_ASIDE)
    if (asideNote !== '') add(asideNote)
    if (skipped > 0) add(`${skipped} ${skipped === 1 ? 'change' : 'changes'} from other branches could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`)
    if (i.conflicts > 0) add(`${i.conflicts} ${i.conflicts === 1 ? 'bill was' : 'bills were'} changed on two branches at once. Review the list below.`)
    if (i.signedOut === true || blocks.includes('auth')) add('This computer is signed out of sync (the login was refused). Sign in again below.')
    const hard = errors.length > 0
    const paused = i.serverPaused === true || blocks.includes('paused')
    const offline = !paused && blocks.includes('offline')
    if (offline) add(push.block === 'offline' ? push.lastError : pull.lastError)
    if (hard) {
      mode = 'attention'
      headline = errors[0] ?? 'Something needs your attention.'
    } else if (paused) {
      mode = 'offline'
      headline = 'The sync server is paused or not answering (a free Supabase project pauses after about a week without use). Ask the owner to restore it in the Supabase dashboard. Nothing is lost.'
    } else if (offline) {
      mode = 'offline'
      headline = i.counts.pending > 0
        ? `No connection to Supabase. ${i.counts.pending} ${i.counts.pending === 1 ? 'change is' : 'changes are'} waiting and will go out when the connection is back.`
        : 'No connection to Supabase. Nothing is lost; Quot3 keeps trying.'
    } else if (held > 0) {
      mode = 'working'; headline = `${held} ${held === 1 ? 'change from another branch is' : 'changes from other branches are'} waiting for the bill open in the editor.`
      add(headline)
    } else if (i.counts.pending > 0 || push.running || pull.running) {
      mode = 'working'
      headline = i.counts.pending > 0 ? `${i.counts.pending} ${i.counts.pending === 1 ? 'change is' : 'changes are'} waiting to be sent.` : 'Checking for changes from other branches.'
    } else {
      mode = 'ok'; headline = 'Everything is sent and received.'
    }
  }

  return {
    activated: i.activated, enabled: i.activated ? i.enabled : true, readOnly: i.readOnly, mode, chip: CHIP[mode], headline, push, pull,
    pending: i.counts.pending, failed: i.counts.failed, conflicts: i.conflicts, held, skipped, unacked,
    oldestPendingAt: i.oldestPendingAt, lastPushAt: push.lastSuccessAt, lastPullAt: pull.lastSuccessAt,
    errors,
    aside: i.aside ?? NO_ASIDE, asideLine: asideLine(i.aside ?? NO_ASIDE),
    delivery: i.live === true ? 'live' : 'polling', deliveryText: deliveryText(i.live === true ? 'live' : 'polling'),
    serverPaused: i.activated && i.enabled && (i.serverPaused === true || [push.block, pull.block].includes('paused')),
    signedOut: i.activated && i.enabled && (i.signedOut === true || [push.block, pull.block].includes('auth')),
    clockOffsetMs: Number.isFinite(i.clockOffsetMs ?? 0) ? (i.clockOffsetMs ?? 0) : 0,
    clockWarning: clockWarningText(i.clockOffsetMs ?? 0)
  }
}

/** A sync overview for a renderer with no bridge / before the first answer. */
export const EMPTY_OVERVIEW: SyncOverview = deriveOverview({ activated: false, enabled: true, readOnly: false, push: null, pull: null, counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, conflicts: 0 })

/** Convenience for the UI: the latest activity of either direction. */
export const lastActivityAt = (o: SyncOverview): string | null => latest(o.lastPushAt, o.lastPullAt)

/** `sync:setEnabled` payload. */
export const setEnabledSchema = z.object({ enabled: z.boolean() }).strict()
export type SetEnabledInput = z.infer<typeof setEnabledSchema>
/** `sync:retry` payload: no ids = every failed change. */
export const retrySchema = z.object({ ids: z.array(z.number().int().positive()).max(1000).optional() }).strict()
export type RetryInput = z.infer<typeof retrySchema>

/** `sync_state` key that holds the owner's switch (`'0'` = off; missing = on). Removed by Deactivate with the other `sync.*` keys. */
export const SYNC_ENABLED_KEY = 'sync.enabled'

/** Per-bill badge for History: text, tone and the sentence for the tooltip. `local_only` shows nothing. */
export type SyncBadgeTone = 'ok' | 'wait' | 'bad'
export interface SyncBadge { text: string; tone: SyncBadgeTone; title: string }
export function syncBadge(state: string | undefined): SyncBadge | null {
  switch (state) {
    case 'synced': return { text: 'Synced', tone: 'ok', title: 'Sent to the other branches' }
    case 'pending': return { text: 'Waiting', tone: 'wait', title: 'Saved here, not yet sent to the other branches' }
    case 'conflict': return { text: 'Conflict', tone: 'bad', title: 'Changed on two branches at once; see Settings > Sync status' }
    default: return null
  }
}
