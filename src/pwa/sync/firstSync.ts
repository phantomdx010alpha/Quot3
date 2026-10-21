import { RECORD_KINDS, type RecordKind } from '../../shared/sync/codecV2'
import { planSync, planCounts, type LocalEntry, type PlanCounts, type RemoteEntry, type SyncPlan } from '../../shared/sync/diff'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { cursorAfterCompare } from '../../shared/sync/pull'
import { txDone, type PhoneDb } from '../data/db'
import { ensureClockOffset } from './clock'
import { listLocalHashes } from './encode'
import { enqueueManyTx, type EnqueueItem } from './outbox'
import { listStates, putStateTx } from './recordState'
import { SYNC_META, readCursor, setCursorTx, setRawTx } from './syncMeta'
import { PHONE_MANIFEST_PAGE, type PhoneManifestRow, type PhoneSharedPort } from './transport'

/**
 * Phase 179 - the phone's FIRST sync (docs/SYNC_SHARED_STORE_SPEC.md section 7) with the Q6 decision.
 *
 * `prepareFirstSync` asks the server for the light manifest of each kind (id, version, hash; no payloads), compares it with the phone's own records
 * (`diff.planSync`, unchanged) and returns counts plus a size assessment. It WRITES NOTHING, so it can be run again freely. The person (or the Phase 185
 * screen) then picks a scope and `applyFirstSync` writes everything in ONE transaction (all or nothing; no half-done first sync to resume):
 *  - skip     -> the server version is remembered (`sync_record_state`), nothing travels;
 *  - upload   -> the server version it builds on is remembered, the record is queued in the outbox (the push worker sends it);
 *  - conflict -> same as upload: the push carries the phone's `base_version` and the SERVER decides by the later `edited_at` (the loser is kept);
 *  - download -> the pull cursor is set just below the lowest record that still has to be downloaded (or decided), so the normal pull fetches them.
 * `base_version` / `base_hash` and the aside rules are never bypassed: every record that is stored got there through the normal pull path.
 *
 * Q6 scope (the phone's own data is large: about 1.9k legacy bills and 12.9k customers per the docs):
 *  - `all`: every bill and customer;
 *  - `recent`: all customers and the NEWEST `billLimit` bills (by the server's `server_seq`). Older bills are NOT stored on the phone (`floor_seq`); they stay on
 *    the server and on the PC. NOTE the notebook has no per-kind pull, so the phone still reads the pages it skips: `recent` saves phone STORAGE and apply
 *    time, not the download itself [A]. "Load older bills" (`requestOlderBills`) lifts the floor and pulls again.
 * Phone customers: kinds `party_merge` and `party` come first, so a bill never lands before its customer. `item_rule` records are not part of the phone.
 */
export const PHONE_RECORD_KINDS: readonly RecordKind[] = RECORD_KINDS.filter((k) => k !== 'item_rule')

/** [A] unconfirmed estimates of what one record costs on the phone (rows, JSON, revision snapshot). Not measured on a real phone. */
export const EST_BILL_BYTES = 8 * 1024
export const EST_PARTY_BYTES = 600
/** Without a storage estimate from the browser, "everything" is recommended up to this many estimated bytes. */
export const FIRST_SYNC_FALLBACK_LIMIT_BYTES = 80 * 1024 * 1024
/** "Everything" is recommended while it uses at most this share of the free storage the browser reports. */
export const FIRST_SYNC_MAX_SHARE = 0.5
/** [A] default for the "recent" choice. */
export const DEFAULT_RECENT_BILLS = 500

export interface StorageEstimate { quota: number | null; usage: number | null }
export type FirstSyncScope = { mode: 'all' } | { mode: 'recent'; billLimit: number }

export interface FirstSyncAssessment {
  downloadBills: number
  downloadParties: number
  /** Estimated bytes `all` would add (an estimate, see `EST_*`). */
  estimatedBytes: number
  freeBytes: number | null
  /** What the screen should preselect. */
  recommended: FirstSyncScope
  /** Plain words for the size note. */
  note: string
}

export const mb = (n: number): string => `${Math.max(0.1, Math.round(n / 1024 / 102.4) / 10).toFixed(1)} MB`

/** Pure. */
export function assessFirstSync(downloadBills: number, downloadParties: number, storage: StorageEstimate): FirstSyncAssessment {
  const estimatedBytes = downloadBills * EST_BILL_BYTES + downloadParties * EST_PARTY_BYTES
  const free = storage.quota !== null && storage.usage !== null ? Math.max(0, storage.quota - storage.usage) : null
  const fits = free !== null ? estimatedBytes <= free * FIRST_SYNC_MAX_SHARE : estimatedBytes <= FIRST_SYNC_FALLBACK_LIMIT_BYTES
  const recent: FirstSyncScope = { mode: 'recent', billLimit: DEFAULT_RECENT_BILLS }
  const needless = downloadBills <= DEFAULT_RECENT_BILLS
  return {
    downloadBills, downloadParties, estimatedBytes, freeBytes: free,
    recommended: fits || needless ? { mode: 'all' } : recent,
    note: `About ${downloadBills} bills and ${downloadParties} customers to download, roughly ${mb(estimatedBytes)} on this phone (an estimate).${free === null ? ' The browser did not say how much space is free.' : ` About ${mb(free)} is free.`}`
  }
}

export interface FirstSyncPreview {
  /** Per kind: what the compare decided. */
  plans: { kind: RecordKind; counts: PlanCounts }[]
  totals: PlanCounts
  assessment: FirstSyncAssessment
  /** Opaque: pass it back to `applyFirstSync`. */
  token: PreparedFirstSync
}

export interface PreparedFirstSync {
  readonly plansByKind: ReadonlyMap<RecordKind, SyncPlan>
  readonly localByKind: ReadonlyMap<RecordKind, ReadonlyMap<string, { deleted: boolean; revision: number }>>
  readonly highestSeq: number
  readonly stateByKind: ReadonlyMap<RecordKind, ReadonlyMap<string, { baseVersion: number; baseHash: string; serverSeq: number; syncedAt: string | null }>>
  /** Bill downloads, newest first (for the "recent" scope). */
  readonly billDownloadSeqsDesc: readonly number[]
}

export interface FirstSyncDeps {
  db: PhoneDb
  connect: () => Promise<{ port: PhoneSharedPort; creds: { license: string; branchId: string } }>
  appVer: string
  now?: () => Date
  progress?: (p: SyncProgress) => void
  /** `navigator.storage.estimate()`; defaults to the browser's when it exists. */
  storage?: () => Promise<StorageEstimate>
}

async function defaultStorage(): Promise<StorageEstimate> {
  try {
    const e = await (globalThis.navigator?.storage?.estimate?.() ?? Promise.resolve(undefined))
    return { quota: typeof e?.quota === 'number' ? e.quota : null, usage: typeof e?.usage === 'number' ? e.usage : null }
  } catch { return { quota: null, usage: null } }
}

async function manifestOf(port: PhoneSharedPort, c: { license: string; branchId: string }, kind: RecordKind): Promise<RemoteEntry[]> {
  const out: RemoteEntry[] = []
  let after: string | undefined
  for (;;) {
    const page: PhoneManifestRow[] = await port.manifest({ ...c, kind, ...(after !== undefined ? { afterRecId: after } : {}), limit: PHONE_MANIFEST_PAGE })
    for (const m of page) out.push({ recId: m.recId, version: m.version, payloadHash: m.payloadHash, serverSeq: m.serverSeq, deleted: m.deleted })
    if (page.length < PHONE_MANIFEST_PAGE) break
    after = (page[page.length - 1] as { recId: string }).recId
  }
  return out
}

/** Read-only compare. Throws a transport error when the server cannot be reached (the caller shows it; nothing was written). */
export async function prepareFirstSync(deps: FirstSyncDeps): Promise<FirstSyncPreview> {
  const now = deps.now ?? (() => new Date())
  const { db } = deps
  const { port, creds } = await deps.connect()
  const offsetMs = await ensureClockOffset(db, port, () => now().getTime())
  const tracker = createProgressTracker('receive', deps.progress ?? (() => undefined))
  const plansByKind = new Map<RecordKind, SyncPlan>()
  const localByKind = new Map<RecordKind, Map<string, { deleted: boolean; revision: number }>>()
  const stateByKind = new Map<RecordKind, Map<string, { baseVersion: number; baseHash: string; serverSeq: number; syncedAt: string | null }>>()
  let highestSeq = 0
  let first = true
  let examined = 0
  try {
    for (const kind of PHONE_RECORD_KINDS) {
      const remote = await manifestOf(port, creds, kind)
      const local = await listLocalHashes(db, kind, { offsetMs, appVer: deps.appVer })
      const states = new Map((await listStates(db, kind)).map((s) => [s.recId, s]))
      const entries: LocalEntry[] = local.map((l) => ({ recId: l.recId, hash: l.hash, baseVersion: states.get(l.recId)?.baseVersion ?? 0, baseHash: states.get(l.recId)?.baseHash ?? null }))
      plansByKind.set(kind, planSync(entries, remote))
      localByKind.set(kind, new Map(local.map((l) => [l.recId, { deleted: l.deleted, revision: l.revision }])))
      stateByKind.set(kind, new Map([...states].map(([id, s]) => [id, { baseVersion: s.baseVersion, baseHash: s.baseHash, serverSeq: s.serverSeq, syncedAt: s.syncedAt }])))
      // The cursor may only jump over what existed when the FIRST manifest was taken (a record another branch writes while the compare runs
      // gets a higher sequence and stays above the cursor). Same reasoning as the desktop compare.
      if (first) { for (const r of remote) if (r.serverSeq > highestSeq) highestSeq = r.serverSeq; first = false }
      examined += local.length + remote.length
      tracker.advance(0, examined)
      tracker.advance(local.length + remote.length, examined)
    }
  } finally {
    tracker.end()
  }
  const plans = PHONE_RECORD_KINDS.map((kind) => ({ kind, counts: planCounts(plansByKind.get(kind) as SyncPlan) }))
  const totals: PlanCounts = plans.reduce((a, p) => ({ skip: a.skip + p.counts.skip, upload: a.upload + p.counts.upload, download: a.download + p.counts.download, conflict: a.conflict + p.counts.conflict, total: a.total + p.counts.total }), { skip: 0, upload: 0, download: 0, conflict: 0, total: 0 })
  const billPlan = plansByKind.get('bill') as SyncPlan
  const partyPlan = plansByKind.get('party') as SyncPlan
  const assessment = assessFirstSync(billPlan.download.length, partyPlan.download.length, await (deps.storage ?? defaultStorage)())
  const billDownloadSeqsDesc = billPlan.download.map((d) => d.serverSeq).sort((a, b) => b - a)
  return { plans, totals, assessment, token: { plansByKind, localByKind, stateByKind, highestSeq, billDownloadSeqsDesc } }
}

export interface FirstSyncResult {
  /** Records queued for sending. */
  queued: number
  /** Server versions remembered without a download. */
  skipped: number
  cursor: number
  /** Bills the "recent" choice left on the server. */
  deferredBills: number
  floorSeq: number
}

/** Writes the compare in ONE transaction and marks the first sync done. Safe to call once per prepared compare. */
export async function applyFirstSync(deps: Pick<FirstSyncDeps, 'db' | 'now'>, preview: FirstSyncPreview, scope: FirstSyncScope): Promise<FirstSyncResult> {
  const { db } = deps
  db.assertWritable()
  const now = (deps.now ?? (() => new Date()))()
  const at = now.toISOString()
  const t = preview.token
  const seqs = t.billDownloadSeqsDesc
  const limit = scope.mode === 'recent' ? Math.max(1, Math.trunc(scope.billLimit)) : seqs.length
  const floorSeq = scope.mode === 'recent' && seqs.length > limit ? (seqs[limit - 1] as number) : 0
  const deferred = floorSeq > 0 ? seqs.filter((s) => s < floorSeq).length : 0

  const currentCursor = await readCursor(db) // read BEFORE the transaction opens: nothing but IndexedDB requests may happen inside it
  const tx = db.idb.transaction(['meta', 'sync_record_state', 'sync_outbox'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  const lw: { v: number | null } = { v: null }
  const want = (seq: number): void => { if (lw.v === null || seq < lw.v) lw.v = seq }
  const toQueue: EnqueueItem[] = []
  let skipped = 0
  try {
    // Customers (and merges) are queued before bills: the outbox sorts parties first anyway, this keeps the creation order obvious.
    for (const kind of PHONE_RECORD_KINDS) {
      const plan = t.plansByKind.get(kind) as SyncPlan
      const states = t.stateByKind.get(kind)
      const locals = t.localByKind.get(kind)
      for (const s of plan.skip) { putStateTx(tx, { kind, recId: s.recId, baseVersion: s.version, baseHash: s.hash, serverSeq: s.serverSeq, syncedAt: at }); skipped++ }
      // Upload / conflict: build on the server version the phone knows; nothing is claimed about the content (empty base hash).
      const build = (recId: string, baseVersion: number, serverSeq: number): void => {
        if (baseVersion <= 0) return // new on the server: the push says base_version 0
        const st = states?.get(recId)
        putStateTx(tx, { kind, recId, baseVersion, baseHash: st?.baseHash ?? '', serverSeq: st?.serverSeq ?? serverSeq, syncedAt: st?.syncedAt ?? null })
      }
      const queue = (recId: string): void => {
        const l = locals?.get(recId)
        if (kind === 'bill' || kind === 'party') toQueue.push({ kind, recId, op: l?.deleted ? 'delete' : 'upsert', revision: l?.revision ?? 0 })
      }
      for (const u of plan.upload) { build(u.recId, u.baseVersion, 0); queue(u.recId) }
      for (const c of plan.conflict) { build(c.recId, c.baseVersion, c.serverSeq); queue(c.recId); want(c.serverSeq) }
      for (const d of plan.download) {
        if (kind === 'bill' && floorSeq > 0 && d.serverSeq < floorSeq) continue // an older bill the phone chose not to store
        want(d.serverSeq)
      }
    }
    enqueueManyTx(tx, toQueue, at)
    const cursor = cursorAfterCompare(currentCursor, lw.v, t.highestSeq)
    setCursorTx(tx, cursor)
    setRawTx(tx, SYNC_META.floorSeq, floorSeq)
    setRawTx(tx, SYNC_META.deferredBills, deferred)
    setRawTx(tx, SYNC_META.compareDone, at)
    await done
    return { queued: toQueue.length, skipped, cursor, deferredBills: deferred, floorSeq }
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
}

/** "Load older bills": lifts the floor and starts the pull from the beginning (records already held are skipped by their remembered version). */
export async function requestOlderBills(db: PhoneDb): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction('meta', 'readwrite')
  setRawTx(tx, SYNC_META.floorSeq, 0)
  setRawTx(tx, SYNC_META.deferredBills, 0)
  setCursorTx(tx, 0)
  await txDone(tx)
}

