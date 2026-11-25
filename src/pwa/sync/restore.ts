/**
 * Phase 293 (M25-14) - RESTORE: a blank phone (or one that lost its data while the login survived) gets everything back from the server by itself.
 *
 * `runRestore` = `prepareFirstSync` -> `completeFirstSync` with scope `all` (no scope question; `recent` stays under Advanced) -> pull until the phone
 * holds what the server held -> fetch the company profile, the payments list and the rights. Progress is reported as counts by kind so the screen is never a
 * blank wait. The first sync is all or nothing (Phase 179): the compare is written in ONE transaction, so a failure BEFORE that leaves nothing half done and
 * "Try again" simply starts over; a failure AFTER it (during the pull) is resumed from the stored cursor. The marker `restore.state = 'applied'` says which.
 * Nothing here uploads anything the phone did not already queue; the normal base_version / aside rules apply to every downloaded record.
 * Honest limit (words below): what only lived on the old phone and never synced cannot come back.
 */
import { countRecords, reqToPromise, txDone, type PhoneDb } from '../data/db'
import type { FirstSyncPreview, FirstSyncResult } from './firstSync'
import { PhoneSyncError, toSyncFailure } from './errors'
import { listStates } from './recordState'
import { getRaw, setRaw } from './syncMeta'
import { isPriceKind } from '../../shared/sync/priceListRecords'

export const RESTORE_STATE_KEY = 'restore.state'

export const RESTORE_TITLE = 'Restoring a phone? Type the code'
export const RESTORE_INTRO = 'Same code as a new phone. Your bills, customers, Price List, company details and payments come back from the server by themselves.'
export const RESTORE_LIMIT_LINE = 'Anything that only lived on the old phone and never synced cannot come back.'
export const RESTORE_SERVER_TITLE = 'Restore from the server'
export const RESTORE_SERVER_INTRO = 'This phone\'s data is empty, but it had data before. No code is needed: this phone is still signed in, so everything that reached the server can be fetched again.'
export const RESTORE_BUTTON_SERVER = 'Restore from the server'
export const RESTORE_BUTTON_RETRY = 'Try again'
export const RESTORE_DONE_LINE = 'Everything the server had is back on this phone.'

export type RestoreStage = 'compare' | 'download' | 'extras' | 'done'

/** One progress snapshot: what the phone holds now against what the server said it would send. Never negative; `have` never passes `want`. */
export interface RestoreCounts { bills: number; customers: number; priceList: number }
export interface RestoreProgress { stage: RestoreStage; have: RestoreCounts; want: RestoreCounts }

export type RestoreExtra = 'company' | 'payments' | 'rights'
export type RestoreOutcome =
  | { ok: true; have: RestoreCounts; /** Parts that could not be fetched now; the phone retries them by itself while it syncs. */ later: RestoreExtra[] }
  | { ok: false; kind: string; message: string; /** True when "Try again" continues from the stored cursor instead of comparing again. */ resumes: boolean }

/** What `runRestore` needs from the running phone. Tests hand in a real engine on an in-memory server. */
export interface RestoreDeps {
  db: PhoneDb
  engine: {
    prepareFirstSync(): Promise<FirstSyncPreview>
    completeFirstSync(p: FirstSyncPreview, scope: { mode: 'all' }): Promise<FirstSyncResult>
    syncNow(): Promise<{ push: unknown; pull: { applied: number; failed: number; held: number; gaveUp: number; block: string } }>
  }
  /** The three small fetches after the records. Each never throws; a falsy result means "could not now". Absent = skipped. */
  fetchExtras?: () => Promise<Record<RestoreExtra, boolean>>
  onProgress?: (p: RestoreProgress) => void
}

export const ZERO_COUNTS: RestoreCounts = { bills: 0, customers: 0, priceList: 0 }

/** Pure: how many records the compare says will arrive, by kind (what the progress bar counts toward). */
export function wantedCounts(preview: Pick<FirstSyncPreview, 'plans'>): RestoreCounts {
  const out = { bills: 0, customers: 0, priceList: 0 }
  for (const p of preview.plans) {
    // A skipped record is already on the phone and counted in `have`, so it counts toward `want` too.
    const n = p.counts.download + p.counts.skip + p.counts.conflict + p.counts.upload
    if (p.kind === 'bill') out.bills += n
    else if (p.kind === 'party') out.customers += n
    else if (isPriceKind(p.kind)) out.priceList += n
  }
  return out
}

/** What the phone holds now (bills, customers, Price List records of the four kinds). */
export async function localCounts(db: PhoneDb): Promise<RestoreCounts> {
  const [bills, customers, a, b, c, d] = await Promise.all(['bills', 'parties', 'price_tiers', 'price_categories', 'price_tabs', 'price_rows'].map((s) => countRecords(db, s as 'bills')))
  return { bills: bills ?? 0, customers: customers ?? 0, priceList: (a ?? 0) + (b ?? 0) + (c ?? 0) + (d ?? 0) }
}

export const KIND_STORE = { bill: 'bills', party: 'parties', price_tier: 'price_tiers', price_category: 'price_categories', price_tab: 'price_tabs', price_row: 'price_rows' } as const

/**
 * A partly wiped phone can keep its `sync_record_state` ("I already have version N of this record") after the records themselves are gone, and the normal
 * pull would then SKIP them as already known. Before a restore compares, the remembered versions of records the phone no longer holds are forgotten.
 * Records that are still there keep their state untouched. Idempotent; writes nothing but those state rows.
 */
export async function dropOrphanStates(db: PhoneDb): Promise<number> {
  let dropped = 0
  for (const [kind, store] of Object.entries(KIND_STORE)) {
    const states = await listStates(db, kind)
    if (states.length === 0) continue
    const have = new Set((await reqToPromise(db.idb.transaction(store, 'readonly').objectStore(store).getAllKeys())) as string[])
    const orphans = states.filter((s) => !have.has(s.recId))
    if (orphans.length === 0) continue
    const tx = db.idb.transaction('sync_record_state', 'readwrite')
    const done = txDone(tx)
    for (const o of orphans) tx.objectStore('sync_record_state').delete([kind, o.recId])
    await done
    dropped += orphans.length
  }
  return dropped
}

const clampTo = (have: RestoreCounts, want: RestoreCounts): RestoreCounts => ({
  bills: Math.min(have.bills, Math.max(want.bills, 0)), customers: Math.min(have.customers, Math.max(want.customers, 0)), priceList: Math.min(have.priceList, Math.max(want.priceList, 0))
})

/** Pull rounds after the compare. Each `syncNow` already pages to the end; more than one round only covers a record another phone wrote meanwhile. */
export const RESTORE_MAX_ROUNDS = 6

/** The screen's one-line count text, by kind, plain words (pure). */
export function restoreCountLine(p: RestoreProgress): string {
  const part = (n: number, w: number, noun: string): string => (w > 0 ? `${n} of ${w} ${noun}` : '')
  return [part(p.have.bills, p.want.bills, 'bills'), part(p.have.customers, p.want.customers, 'customers'), part(p.have.priceList, p.want.priceList, 'Price List entries')].filter((s) => s !== '').join(' · ')
}

export function restoreStageWords(s: RestoreStage): string {
  if (s === 'compare') return 'Checking what the server holds…'
  if (s === 'download') return 'Bringing your records back…'
  if (s === 'extras') return 'Fetching company details, payments and rights…'
  return RESTORE_DONE_LINE
}

/** Runs the whole restore. Never throws: a failure is returned in plain words. Safe to call again (that is "Try again"). */
export async function runRestore(deps: RestoreDeps): Promise<RestoreOutcome> {
  const { db, engine } = deps
  const emit = (stage: RestoreStage, have: RestoreCounts, want: RestoreCounts): void => { try { deps.onProgress?.({ stage, have: clampTo(have, want), want }) } catch { /* the screen never breaks the work */ } }
  let want: RestoreCounts = ZERO_COUNTS
  let applied = false
  try {
    if (!db.canWrite()) return { ok: false, kind: 'read_only', message: 'Another Quot3 window is open. Close it and try again.', resumes: false }
    applied = (await getRaw<string | null>(db, RESTORE_STATE_KEY, null)) === 'applied'
    if (!applied) {
      emit('compare', ZERO_COUNTS, ZERO_COUNTS)
      await dropOrphanStates(db)
      const preview = await engine.prepareFirstSync()
      want = wantedCounts(preview)
      emit('compare', await localCounts(db), want)
      await engine.completeFirstSync(preview, { mode: 'all' }) // ONE transaction: all or nothing
      await setRaw(db, RESTORE_STATE_KEY, 'applied')
      applied = true
    } else {
      want = await localCounts(db) // a resumed run does not know the server's totals; the bar grows with what arrives
    }
    emit('download', await localCounts(db), want)
    for (let round = 0; round < RESTORE_MAX_ROUNDS; round++) {
      const { pull } = await engine.syncNow()
      // The pull worker never throws: a paused / offline pull comes back as a block. Not "idle" means the download did NOT complete.
      if (pull.block !== 'idle') throw new PhoneSyncError(pull.block === 'offline' ? 'offline' : pull.block === 'auth' ? 'auth_failed' : pull.block === 'paused' ? 'server_paused' : 'server')
      const have = await localCounts(db)
      want = { bills: Math.max(want.bills, have.bills), customers: Math.max(want.customers, have.customers), priceList: Math.max(want.priceList, have.priceList) }
      emit('download', have, want)
      if (pull.applied === 0 && pull.failed === 0 && pull.held === 0) break
    }
    emit('extras', await localCounts(db), want)
    const later: RestoreExtra[] = []
    if (deps.fetchExtras) {
      const r = await deps.fetchExtras().catch(() => ({ company: false, payments: false, rights: false }))
      for (const k of ['company', 'payments', 'rights'] as const) if (!r[k]) later.push(k)
    }
    await setRaw(db, RESTORE_STATE_KEY, null)
    const have = await localCounts(db)
    emit('done', have, { bills: Math.max(want.bills, have.bills), customers: Math.max(want.customers, have.customers), priceList: Math.max(want.priceList, have.priceList) })
    return { ok: true, have, later }
  } catch (e) {
    const f = toSyncFailure(e)
    return { ok: false, kind: f.kind, message: f.message !== '' ? f.message : 'Something went wrong. Try again.', resumes: applied }
  }
}
