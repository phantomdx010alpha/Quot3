import { AppError } from '../ipc/envelope'
import type { SyncRecordRepo } from '../db/syncRecordRepo'
import { READER_VER, asideEnvelopeJson, decodeRecord, rawFromAside, type DecodeResult, type DecodedRecord, type RawRecord } from '../../shared/sync/codecV2'

/**
 * Phase 133 (SYNC_SHARED_STORE_SPEC section 8): the set-aside rule.
 * A record whose `min_reader_ver` is above this app's reader version is kept in `sync_aside` and is NEVER applied, stripped or
 * overwritten; the pull cursor still advances ("Update the app to see N bills"). After an update `retryAside()` decodes the kept
 * records again and hands every readable one to `apply`. A local edit of an aside record is refused (`assertEditable`).
 * Nothing here logs payload content.
 */
export interface AsideDeps {
  repo: SyncRecordRepo
  /** Applies one readable record locally (Phase 135 supplies the real applier). May throw: the record then stays set aside. */
  apply: (record: DecodedRecord) => void
  now?: () => Date
  /** This build's reader version; tests raise it to simulate an update. */
  readerVer?: () => number
}

export interface RetryResult {
  /** Records applied and removed from the set-aside list. */
  applied: number
  /** Still too new for this app. */
  stillAside: number
  /** Stored JSON damaged or no longer valid for a reader that is allowed to read it; kept for support. */
  invalid: number
  /** `apply` threw; kept and retried next time. */
  failed: number
}

export interface AsideService {
  /**
   * The one door for an incoming server record. `aside` is stored here; `apply` returns the decoded record for the caller to apply
   * (any older set-aside copy of the same record is dropped, because a readable version has arrived); `invalid` is only reported.
   */
  ingest(raw: RawRecord): DecodeResult
  retryAside(): RetryResult
  count(): number
  countsByKind(): Record<string, number>
  list(limit?: number): { kind: string; recId: string; version: number; minReaderVer: number; seenAt: string }[]
  isAside(kind: string, recId: string): boolean
  /** Throws `RECORD_ASIDE` when this record is set aside (local edit / delete blocked). */
  assertEditable(kind: string, recId: string): void
}

export function createAsideService(deps: AsideDeps): AsideService {
  const { repo } = deps
  const now = deps.now ?? (() => new Date())
  const ver = (): number => (deps.readerVer ? deps.readerVer() : READER_VER)

  return {
    ingest(raw) {
      const res = decodeRecord(raw, ver())
      if (res.outcome === 'aside') {
        repo.putAside({ kind: res.kind, recId: res.recId, version: res.version, minReaderVer: res.minReaderVer, payloadJson: asideEnvelopeJson(raw), seenAt: now().toISOString() })
      } else if (res.outcome === 'apply') {
        repo.removeAside(res.record.kind, res.record.recId)
      }
      return res
    },

    retryAside() {
      const out: RetryResult = { applied: 0, stillAside: 0, invalid: 0, failed: 0 }
      for (const row of repo.listAside(100_000)) {
        const raw = rawFromAside(row)
        if (!raw) { out.invalid++; continue }
        const res = decodeRecord(raw, ver())
        if (res.outcome === 'aside') { out.stillAside++; continue }
        if (res.outcome === 'invalid') { out.invalid++; continue }
        try {
          repo.transaction(() => {
            deps.apply(res.record)
            repo.removeAside(row.kind, row.recId)
          })
          out.applied++
        } catch {
          out.failed++
        }
      }
      return out
    },

    count: () => repo.asideCount(),
    countsByKind: () => repo.asideCountsByKind(),
    list: (limit) => repo.listAside(limit).map((r) => ({ kind: r.kind, recId: r.recId, version: r.version, minReaderVer: r.minReaderVer, seenAt: r.seenAt })),
    isAside: (k, id) => repo.isAside(k, id),
    assertEditable(kind, recId) {
      if (repo.isAside(kind, recId)) throw new AppError('RECORD_ASIDE', 'This record was changed by a newer version of Quot3. Update the app to edit it.')
    }
  }
}
