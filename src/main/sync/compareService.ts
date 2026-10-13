import type { SyncRecordRepo } from '../db/syncRecordRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import type { Logger } from '../logger'
import { type RecordKind, RECORD_KINDS } from '../../shared/sync/codecV2'
import { planSync, type LocalEntry, type RemoteEntry } from '../../shared/sync/diff'
import { createProgressTracker, type SyncProgress } from '../../shared/sync/progress'
import { cursorAfterCompare } from '../../shared/sync/pull'
import { classifySharedWorkerFailure, sharedBlockFor, type SharedBlock } from '../../shared/sync/push'
import { AppError } from '../ipc/envelope'
import type { SharedCredentials } from './activationV2'
import { SHARED_MANIFEST_MAX, SharedTransportError, type SharedStoreTransport } from './sharedTransport'
import { SHARED_STATE_KEYS, ensureClockOffset, readCursor, writeCursor } from './sharedState'

/**
 * Phase 135 - the first "Compare and sync" (docs/SYNC_SHARED_STORE_SPEC.md section 7). A new or returning computer asks the server for the
 * light manifest of each kind (`sn_manifest`: id, version, hash; no payloads), compares it with its own records (`planSync`), and:
 *  - skip     -> remembers the server version (`sync_record_state`), nothing travels;
 *  - upload   -> remembers the server version it builds on and queues the record in the outbox (the push worker sends it);
 *  - conflict -> same as upload: the push carries this computer's `base_version`, and the SERVER decides by the later `edited_at`
 *               (the loser is kept in `sn_history` / as a local revision), so no payload has to be fetched to decide;
 *  - download -> nothing now: the pull cursor is set just below the lowest record that still has to be downloaded (or decided), so the
 *               normal pull worker fetches them (and only them, plus whatever came after).
 * Resumable: the result of each finished kind is saved (`shared.compare`); a restart skips the kinds already done. Every step is
 * idempotent (states are overwritten, queueing an already queued record replaces the older row), so a crash costs repeated work only.
 * Records of a kind with no local source here (parties: Phase 136-137) are all "download".
 */
export interface CompareSource {
  kind: RecordKind
  /** Every local record of this kind with its content hash as the server would see it (`encodeLocalRecord`). */
  list(offsetMs: number | null): { recId: string; hash: string }[]
  /** Queues these records for sending (outbox). Called with ids the plan wants uploaded. Must be idempotent. */
  enqueue(recIds: readonly string[]): void
}

export interface CompareDeps {
  records: SyncRecordRepo
  sync: Pick<SyncStateRepo, 'get' | 'set' | 'remove'>
  sources: readonly CompareSource[]
  connect: () => Promise<{ transport: SharedStoreTransport; creds: Pick<SharedCredentials, 'license' | 'branchId'> }>
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  progress?: (p: SyncProgress) => void
  now?: () => Date
}

export interface CompareKindResult { kind: RecordKind; skip: number; upload: number; download: number; conflict: number }

export interface CompareResult {
  /** `done` = the compare ran to the end; `paused` = a connection / login problem stopped it (call again later: it resumes). */
  state: 'done' | 'paused'
  block: SharedBlock
  message: string | null
  kinds: CompareKindResult[]
  skip: number
  upload: number
  download: number
  conflict: number
  /** The pull cursor after the compare (only set when `state` is `done`). */
  cursor: number | null
}

interface Saved {
  startedAt: string
  done: CompareKindResult[]
  /** Lowest `server_seq` of a record that still has to be downloaded or decided (null = none yet). */
  lowestWanted: number | null
  /** Highest `server_seq` of the FIRST manifest fetched (see the comment where it is set). */
  highestSeq: number
}

export interface CompareService {
  /** True until a compare has run to the end on this computer. */
  needed(): boolean
  /** Forgets that a compare was done (a new activation / "compare again"). */
  reset(): void
  run(): Promise<CompareResult>
}

const sum = (xs: CompareKindResult[], k: 'skip' | 'upload' | 'download' | 'conflict'): number => xs.reduce((n, x) => n + x[k], 0)

export function createCompareService(deps: CompareDeps): CompareService {
  const now = deps.now ?? (() => new Date())
  const { records, sync, log } = deps
  let running: Promise<CompareResult> | null = null

  const load = (): Saved | null => {
    const raw = sync.get(SHARED_STATE_KEYS.compare)
    if (!raw) return null
    try {
      const s = JSON.parse(raw) as Saved
      return Array.isArray(s.done) && typeof s.startedAt === 'string' ? s : null
    } catch { return null }
  }
  const save = (s: Saved): void => sync.set(SHARED_STATE_KEYS.compare, JSON.stringify(s))

  async function manifestOf(transport: SharedStoreTransport, creds: { license: string; branchId: string }, kind: RecordKind): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = []
    let after: string | undefined
    for (;;) {
      const page = await transport.manifest({ license: creds.license, branchId: creds.branchId, kind, ...(after !== undefined ? { afterRecId: after } : {}), limit: SHARED_MANIFEST_MAX })
      for (const m of page) out.push({ recId: m.recId, version: m.version, payloadHash: m.payloadHash, serverSeq: m.serverSeq, deleted: m.deleted })
      if (page.length < SHARED_MANIFEST_MAX) break
      after = (page[page.length - 1] as { recId: string }).recId
    }
    return out
  }

  async function run(): Promise<CompareResult> {
    const empty = (state: CompareResult['state'], block: SharedBlock, message: string | null, done: CompareKindResult[], cursor: number | null): CompareResult => ({
      state, block, message, kinds: done, skip: sum(done, 'skip'), upload: sum(done, 'upload'), download: sum(done, 'download'), conflict: sum(done, 'conflict'), cursor
    })
    const saved: Saved = load() ?? { startedAt: now().toISOString(), done: [], lowestWanted: null, highestSeq: 0 }
    const tracker = createProgressTracker('receive', deps.progress ?? (() => undefined))
    let examined = 0
    try {
      const { transport, creds } = await deps.connect()
      const offsetMs = await ensureClockOffset(sync, transport, () => now().getTime())
      for (const kind of RECORD_KINDS) {
        if (saved.done.some((d) => d.kind === kind)) continue
        const remote = await manifestOf(transport, creds, kind)
        const source = deps.sources.find((s) => s.kind === kind)
        const localList = source ? source.list(offsetMs) : []
        const stateById = new Map(records.listStates(kind).map((s) => [s.recId, s]))
        const local: LocalEntry[] = localList.map((l) => {
          const st = stateById.get(l.recId)
          return { recId: l.recId, hash: l.hash, baseVersion: st?.baseVersion ?? 0, baseHash: st?.baseHash ?? null }
        })
        const plan = planSync(local, remote)
        tracker.advance(0, examined + local.length + remote.length)
        const at = now().toISOString()
        records.transaction(() => {
          records.putStates(plan.skip.map((s) => ({ kind, recId: s.recId, baseVersion: s.version, baseHash: s.hash, serverSeq: s.serverSeq, syncedAt: at })))
          // Upload / conflict: build on the server version this computer knows; nothing is claimed about the content (empty base hash).
          const build = (recId: string, baseVersion: number, serverSeq: number): void => {
            if (baseVersion <= 0) return // new on the server: the push says base_version 0
            const st = stateById.get(recId)
            records.putState({ kind, recId, baseVersion, baseHash: st?.baseHash ?? '', serverSeq: st?.serverSeq ?? serverSeq, syncedAt: st?.syncedAt ?? null })
          }
          for (const u of plan.upload) build(u.recId, u.baseVersion, 0)
          for (const c of plan.conflict) build(c.recId, c.baseVersion, c.serverSeq)
        })
        const toSend = [...plan.upload.map((u) => u.recId), ...plan.conflict.map((c) => c.recId)]
        if (source && toSend.length > 0) source.enqueue(toSend)
        // The pull cursor may only jump over what was SEEN at the very start: the first manifest fetched. A record that another computer
        // writes while this compare runs gets a higher sequence than everything that existed when that first manifest was taken, so it
        // stays above the cursor and is pulled. (Taking the maximum over all kinds could jump over such a record.)
        if (saved.done.length === 0) for (const r of remote) if (r.serverSeq > saved.highestSeq) saved.highestSeq = r.serverSeq
        for (const w of [...plan.download.map((d) => d.serverSeq), ...plan.conflict.map((c) => c.serverSeq)]) {
          if (saved.lowestWanted === null || w < saved.lowestWanted) saved.lowestWanted = w
        }
        examined += local.length + remote.length
        tracker.advance(local.length + remote.length, examined)
        saved.done.push({ kind, skip: plan.skip.length, upload: plan.upload.length, download: plan.download.length, conflict: plan.conflict.length })
        save(saved)
      }
      const cursor = cursorAfterCompare(readCursor(sync), saved.lowestWanted, saved.highestSeq)
      writeCursor(sync, cursor)
      sync.set(SHARED_STATE_KEYS.compareDone, now().toISOString())
      sync.remove([SHARED_STATE_KEYS.compare])
      log.info('First sync compare finished', { skip: sum(saved.done, 'skip'), upload: sum(saved.done, 'upload'), download: sum(saved.done, 'download'), conflict: sum(saved.done, 'conflict') })
      return empty('done', 'idle', null, saved.done, cursor)
    } catch (e) {
      let c: ReturnType<typeof classifySharedWorkerFailure> | null = null
      if (e instanceof SharedTransportError) c = classifySharedWorkerFailure(e.kind)
      else if (e instanceof AppError) c = classifySharedWorkerFailure(e.code)
      if (c === null) throw e
      const block = c === 'row' ? 'license' : sharedBlockFor(c)
      log.warn('First sync compare paused', { reason: block })
      return empty('paused', block, e instanceof Error ? e.message : null, saved.done, null)
    } finally {
      tracker.end()
    }
  }

  return {
    needed: () => sync.get(SHARED_STATE_KEYS.compareDone) === undefined,
    reset() { sync.remove([SHARED_STATE_KEYS.compareDone, SHARED_STATE_KEYS.compare]) },
    run() {
      if (running) return running
      running = run().finally(() => { running = null })
      return running
    }
  }
}

export { RECORD_KINDS }
