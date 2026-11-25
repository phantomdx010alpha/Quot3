/**
 * Phase 294 (M25-15) - the phone's daily SELF-CHECK: it re-checks itself against the server and pulls what is missing.
 *
 * Step 1 (cheap): per record kind, the SERVER's row count (the light manifest: id / version / hash, no payloads, read page by page) against the phone's own
 * row count, plus the phone's pull cursor against the server's highest sequence. No local hashing, no `planSync`. Equal = "all in step" and nothing else runs.
 * Step 2 (only when they disagree, or the phone keeps only the newest bills): the full light-manifest compare (`prepareFirstSync`, read-only). The records
 * the compare says are MISSING or DIFFERENT on the server side (`plan.download`) are fetched through the NORMAL pull path: the cursor is moved just below the
 * lowest such record and the usual pull / push run (base_version, base_hash and aside rules unchanged; a record the phone edited after its base is `upload` or
 * `conflict` in the plan, so it is never in the fetch list and a newer local edit is never overwritten). NOTHING is queued for upload here: the check only
 * pulls, the outbox is whatever it already was. Before comparing, remembered versions of records the phone no longer holds are forgotten (Phase 293
 * `dropOrphanStates`), or the normal pull would skip them as "already known".
 * One check at a time (single flight). Never throws. Offline is quiet: a plain status line, no alarm, and the next try comes by itself.
 */
import { countRecords, type PhoneDb } from '../data/db'
import { toSyncFailure } from './errors'
import { PHONE_RECORD_KINDS, type FirstSyncPreview } from './firstSync'
import { KIND_STORE, dropOrphanStates } from './restore'
import { getRaw, readCursor, readFloorSeq, setRaw, writeCursor } from './syncMeta'
import { PHONE_MANIFEST_PAGE, type PhoneSharedPort } from './transport'
import { isPriceKind } from '../../shared/sync/priceListRecords'
import type { RecordKind } from '../../shared/sync/codecV2'

/** At most one check per this long (24 h). */
export const SELF_CHECK_EVERY_MS = 24 * 60 * 60 * 1000
/** Meta keys: when the last check that REACHED the server finished (drives `selfCheckDue`), and the last attempt's result (drives the status line). */
export const SELF_CHECK_DONE_KEY = 'selfcheck.done_at'
export const SELF_CHECK_LAST_KEY = 'selfcheck.last'
/** Pull rounds after the cursor was moved back (one round already pages to the end; more only covers records another phone wrote meanwhile). */
export const SELF_CHECK_MAX_ROUNDS = 4

export type SelfCheckOutcome = 'in_step' | 'fetched' | 'offline' | 'failed' | 'skipped'
export interface SelfCheckResult { at: string; outcome: SelfCheckOutcome; fetched: number; /** Plain reason for `failed`. */ reason: string }

/**
 * Pure. Due when the phone is online and idle and was never checked, or the last finished check is at least 24 h old (so: on start, then at most daily).
 * `lastCheck` = ISO time / epoch ms of the last finished check, or null. A clock that went backwards (last check in the future) counts as due.
 */
export function selfCheckDue(now: Date | number, lastCheck: string | number | null, online: boolean, idle: boolean): boolean {
  if (!online || !idle) return false
  if (lastCheck === null || lastCheck === '') return true
  const last = typeof lastCheck === 'number' ? lastCheck : Date.parse(lastCheck)
  if (!Number.isFinite(last)) return true
  const t = typeof now === 'number' ? now : now.getTime()
  return t - last >= SELF_CHECK_EVERY_MS || last > t
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Pure. The one status line: "Checked 14:05, all in step" / "Fetched 37 missing records" / "Could not check: offline". Local time of the phone. */
export function selfCheckLine(r: SelfCheckResult | null): string {
  if (r === null) return ''
  const d = new Date(r.at)
  const hhmm = Number.isFinite(d.getTime()) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
  switch (r.outcome) {
    case 'in_step': return `Checked ${hhmm}, all in step`.replace(' ,', ',')
    case 'fetched': return `Fetched ${r.fetched} missing record${r.fetched === 1 ? '' : 's'}`
    case 'offline': return 'Could not check: offline'
    case 'failed': return `Could not check: ${r.reason !== '' ? r.reason : 'the server did not answer'}`
    default: return ''
  }
}

/** Reads the stored last result (never throws; null = never checked). Read-only, so it is safe in a read-only tab. */
export async function readSelfCheck(db: PhoneDb): Promise<SelfCheckResult | null> {
  try {
    const v = await getRaw<unknown>(db, SELF_CHECK_LAST_KEY, null)
    if (v && typeof v === 'object') {
      const o = v as Partial<SelfCheckResult>
      if (typeof o.at === 'string' && typeof o.outcome === 'string') return { at: o.at, outcome: o.outcome, fetched: typeof o.fetched === 'number' ? o.fetched : 0, reason: typeof o.reason === 'string' ? o.reason : '' }
    }
  } catch { /* no line */ }
  return null
}

export interface SelfCheckDeps {
  db: PhoneDb
  engine: {
    state(): string
    prepareFirstSync(): Promise<FirstSyncPreview>
    syncNow(): Promise<{ push: unknown; pull: { applied: number; failed: number; held: number; gaveUp: number; block: string } }>
  }
  connect: () => Promise<{ port: PhoneSharedPort; creds: { license: string; branchId: string } }>
  now?: () => Date
  /** Told after every finished attempt (the screens re-read their line). */
  onResult?: (r: SelfCheckResult) => void
}

export interface SelfChecker {
  /** Runs one check now (manual "Check now" or the automatic one). A second call while one runs returns the same promise (never two at once). */
  run(): Promise<SelfCheckResult>
  /** Runs only when `selfCheckDue` says so; resolves to null when it did not run. */
  maybeRun(env: { online: boolean; idle: boolean }): Promise<SelfCheckResult | null>
  running(): boolean
  last(): Promise<SelfCheckResult | null>
}

/** The kinds the cheap step counts (every phone kind; `item_rule` is not on the phone). */
const COUNTED: readonly RecordKind[] = PHONE_RECORD_KINDS

async function serverCounts(port: PhoneSharedPort, c: { license: string; branchId: string }): Promise<{ counts: Map<RecordKind, number>; highestSeq: number; missing: Set<RecordKind> }> {
  const counts = new Map<RecordKind, number>()
  const missing = new Set<RecordKind>()
  let highestSeq = 0
  for (const kind of COUNTED) {
    let n = 0
    let after: string | undefined
    try {
      for (;;) {
        const page = await port.manifest({ ...c, kind, ...(after !== undefined ? { afterRecId: after } : {}), limit: PHONE_MANIFEST_PAGE })
        for (const m of page) { n++; if (m.serverSeq > highestSeq) highestSeq = m.serverSeq }
        if (page.length < PHONE_MANIFEST_PAGE) break
        after = (page[page.length - 1] as { recId: string }).recId
      }
    } catch (e) {
      // A server without the Price List SQL refuses those kinds (same rule as the first sync): leave the kind out. Never for other kinds.
      if (isPriceKind(kind) && toSyncFailure(e).kind === 'invalid_input') { missing.add(kind); continue }
      throw e
    }
    counts.set(kind, n)
  }
  return { counts, highestSeq, missing }
}

/** Rows the phone holds per kind (`party_merge` has no store of its own: it is remembered through `sync_record_state` only, so it is not counted). */
async function localCount(db: PhoneDb, kind: RecordKind): Promise<number | null> {
  const store = (KIND_STORE as Record<string, string | undefined>)[kind]
  return store === undefined ? null : countRecords(db, store as 'bills')
}

async function totalLocal(db: PhoneDb): Promise<number> {
  let n = 0
  for (const kind of COUNTED) n += (await localCount(db, kind)) ?? 0
  return n
}

export function createSelfChecker(deps: SelfCheckDeps): SelfChecker {
  const { db, engine } = deps
  const now = deps.now ?? ((): Date => new Date())
  let current: Promise<SelfCheckResult> | null = null

  const finish = async (r: SelfCheckResult): Promise<SelfCheckResult> => {
    if (r.outcome !== 'skipped') {
      try {
        if (db.canWrite()) {
          await setRaw(db, SELF_CHECK_LAST_KEY, r)
          if (r.outcome === 'in_step' || r.outcome === 'fetched') await setRaw(db, SELF_CHECK_DONE_KEY, r.at)
        }
      } catch { /* the line is a convenience */ }
      try { deps.onResult?.(r) } catch { /* a listener never breaks the check */ }
    }
    return r
  }

  async function check(): Promise<SelfCheckResult> {
    const at = now().toISOString()
    const mk = (outcome: SelfCheckOutcome, fetched = 0, reason = ''): SelfCheckResult => ({ at, outcome, fetched, reason })
    try {
      if (!db.canWrite() || engine.state() !== 'running') return mk('skipped') // another tab is the writer, not linked, or the first sync is not done
      const { port, creds } = await deps.connect()
      // Step 1: the cheap counts.
      const server = await serverCounts(port, creds)
      const floor = await readFloorSeq(db)
      let disagree = floor > 0 // a phone that keeps only the newest bills legitimately holds fewer: go straight to the compare, which respects the floor
      if (!disagree) {
        for (const kind of COUNTED) {
          if (server.missing.has(kind)) continue
          const local = await localCount(db, kind)
          if (local !== null && local !== (server.counts.get(kind) ?? 0)) { disagree = true; break }
        }
      }
      if (!disagree && (await readCursor(db)) < server.highestSeq) disagree = true
      if (!disagree) return mk('in_step')
      // Step 2: the full light compare, then fetch what is missing through the normal pull path.
      await dropOrphanStates(db)
      const preview = await engine.prepareFirstSync()
      let lowest: number | null = null
      for (const [kind, plan] of preview.token.plansByKind) {
        for (const d of plan.download) {
          if (kind === 'bill' && floor > 0 && d.serverSeq < floor) continue // an older bill the phone chose not to store
          if (lowest === null || d.serverSeq < lowest) lowest = d.serverSeq
        }
      }
      if (lowest === null) return mk('in_step')
      const cursor = await readCursor(db)
      if (lowest - 1 < cursor) await writeCursor(db, Math.max(0, lowest - 1)) // the pull then re-reads from just below the lowest wanted record; held records are skipped by their remembered version
      const before = await totalLocal(db)
      let applied = 0
      for (let round = 0; round < SELF_CHECK_MAX_ROUNDS; round++) {
        const { pull } = await engine.syncNow()
        if (pull.block !== 'idle') return mk(pull.block === 'offline' ? 'offline' : 'failed', 0, pull.block === 'offline' ? '' : pull.block === 'auth' ? 'sign in again' : pull.block === 'paused' ? 'the server is paused' : 'the server did not answer')
        applied += pull.applied
        if (pull.applied === 0 && pull.failed === 0 && pull.held === 0) break
      }
      // What actually arrived: the growth in rows the phone holds (an updated record adds none, so applied counts is the fallback).
      const fetched = Math.max(0, (await totalLocal(db)) - before) || applied
      return fetched > 0 ? mk('fetched', fetched) : mk('in_step')
    } catch (e) {
      const f = toSyncFailure(e)
      if (f.kind === 'offline') return mk('offline')
      return mk('failed', 0, f.message.replace(/\.$/, '').toLowerCase())
    }
  }

  function run(): Promise<SelfCheckResult> {
    if (current) return current
    current = check().then(finish).finally(() => { current = null })
    return current
  }

  return {
    run,
    async maybeRun(env) {
      if (current) return null
      let done: string | null = null
      try { done = await getRaw<string | null>(db, SELF_CHECK_DONE_KEY, null) } catch { /* never checked */ }
      if (!selfCheckDue(now(), done, env.online, env.idle)) return null
      return run()
    },
    running: () => current !== null,
    last: () => readSelfCheck(db)
  }
}
