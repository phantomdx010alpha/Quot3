import type Database from 'better-sqlite3'

/**
 * Phase 133: the only SQL for `sync_record_state` (last server version seen per synced record) and `sync_aside` (records set aside
 * because this app is older than their `min_reader_ver`). SYNC_SHARED_STORE_SPEC sections 7 and 8.
 */
export interface RecordState {
  kind: string
  recId: string
  /** The server version this computer last saw (what `sn_push` receives as `baseVersion`). */
  baseVersion: number
  /** Content hash of that version (`codecV2.hashPayload`). */
  baseHash: string
  serverSeq: number
  syncedAt: string | null
}

export interface AsideRow {
  kind: string
  recId: string
  version: number
  minReaderVer: number
  /** The whole record envelope as JSON (see `asideEnvelopeJson`). */
  payloadJson: string
  seenAt: string
}

export interface SyncRecordRepo {
  getState(kind: string, recId: string): RecordState | undefined
  putState(s: RecordState): void
  putStates(list: readonly RecordState[]): void
  removeState(kind: string, recId: string): void
  /** Every known record of a kind (the local side of the first-sync compare). */
  listStates(kind: string): RecordState[]
  stateCount(): number
  /** Highest `server_seq` seen in any record state (0 when none). */
  maxServerSeq(): number

  /** Keeps the NEWER version when the record is already set aside (a later pull may bring a higher version). Returns true when stored. */
  putAside(row: AsideRow): boolean
  getAside(kind: string, recId: string): AsideRow | undefined
  isAside(kind: string, recId: string): boolean
  listAside(limit?: number): AsideRow[]
  asideCount(): number
  /** Count per kind, for the "Update the app to see N bills" line. */
  asideCountsByKind(): Record<string, number>
  removeAside(kind: string, recId: string): void
  transaction<T>(fn: () => T): T
}

interface StateRow { kind: string; rec_id: string; base_version: number; base_hash: string; server_seq: number; synced_at: string | null }
interface AsideDbRow { kind: string; rec_id: string; version: number; min_reader_ver: number; payload_json: string; seen_at: string }

const toState = (r: StateRow): RecordState => ({ kind: r.kind, recId: r.rec_id, baseVersion: r.base_version, baseHash: r.base_hash, serverSeq: r.server_seq, syncedAt: r.synced_at })
const toAside = (r: AsideDbRow): AsideRow => ({ kind: r.kind, recId: r.rec_id, version: r.version, minReaderVer: r.min_reader_ver, payloadJson: r.payload_json, seenAt: r.seen_at })

export function createSyncRecordRepo(sqlite: Database.Database): SyncRecordRepo {
  const getS = sqlite.prepare('SELECT * FROM sync_record_state WHERE kind = ? AND rec_id = ?')
  const putS = sqlite.prepare(
    `INSERT INTO sync_record_state (kind, rec_id, base_version, base_hash, server_seq, synced_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, rec_id) DO UPDATE SET base_version = excluded.base_version, base_hash = excluded.base_hash, server_seq = excluded.server_seq, synced_at = excluded.synced_at`
  )
  const delS = sqlite.prepare('DELETE FROM sync_record_state WHERE kind = ? AND rec_id = ?')
  const listS = sqlite.prepare('SELECT * FROM sync_record_state WHERE kind = ? ORDER BY rec_id')
  const cntS = sqlite.prepare('SELECT COUNT(*) AS n FROM sync_record_state')
  const maxS = sqlite.prepare('SELECT COALESCE(MAX(server_seq), 0) AS n FROM sync_record_state')

  const getA = sqlite.prepare('SELECT * FROM sync_aside WHERE kind = ? AND rec_id = ?')
  const putA = sqlite.prepare(
    `INSERT INTO sync_aside (kind, rec_id, version, min_reader_ver, payload_json, seen_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, rec_id) DO UPDATE SET version = excluded.version, min_reader_ver = excluded.min_reader_ver, payload_json = excluded.payload_json, seen_at = excluded.seen_at`
  )
  const delA = sqlite.prepare('DELETE FROM sync_aside WHERE kind = ? AND rec_id = ?')
  const listA = sqlite.prepare('SELECT * FROM sync_aside ORDER BY seen_at, kind, rec_id LIMIT ?')
  const cntA = sqlite.prepare('SELECT COUNT(*) AS n FROM sync_aside')
  const cntAK = sqlite.prepare('SELECT kind, COUNT(*) AS n FROM sync_aside GROUP BY kind')
  const many = sqlite.transaction((list: readonly RecordState[]) => { for (const s of list) putS.run(s.kind, s.recId, s.baseVersion, s.baseHash, s.serverSeq, s.syncedAt) })

  return {
    getState: (k, id) => { const r = getS.get(k, id) as StateRow | undefined; return r ? toState(r) : undefined },
    putState: (s) => void putS.run(s.kind, s.recId, s.baseVersion, s.baseHash, s.serverSeq, s.syncedAt),
    putStates: (l) => void many(l),
    removeState: (k, id) => void delS.run(k, id),
    listStates: (k) => (listS.all(k) as StateRow[]).map(toState),
    stateCount: () => (cntS.get() as { n: number }).n,
    maxServerSeq: () => (maxS.get() as { n: number }).n,

    putAside(row) {
      const cur = getA.get(row.kind, row.recId) as AsideDbRow | undefined
      if (cur && cur.version > row.version) return false
      putA.run(row.kind, row.recId, row.version, row.minReaderVer, row.payloadJson, row.seenAt)
      return true
    },
    getAside: (k, id) => { const r = getA.get(k, id) as AsideDbRow | undefined; return r ? toAside(r) : undefined },
    isAside: (k, id) => getA.get(k, id) !== undefined,
    listAside: (limit = 1000) => (listA.all(Math.max(1, Math.trunc(limit))) as AsideDbRow[]).map(toAside),
    asideCount: () => (cntA.get() as { n: number }).n,
    asideCountsByKind: () => Object.fromEntries((cntAK.all() as { kind: string; n: number }[]).map((r) => [r.kind, r.n])),
    removeAside: (k, id) => void delA.run(k, id),
    transaction: (fn) => sqlite.transaction(fn)()
  }
}
