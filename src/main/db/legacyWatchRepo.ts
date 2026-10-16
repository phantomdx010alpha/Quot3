import type Database from 'better-sqlite3'

/**
 * Phase 159: the only SQL for the legacy-watch tables (`legacy_watch_files`, `legacy_watch_bills`, `legacy_watch_review`,
 * `legacy_watch_activity`) plus the one read the classifier needs (bills of one date). Bills themselves are written through `billRepo`.
 */
export const ACTIVITY_KEEP = 200

export interface WatchFileRow { fileName: string; size: number; mtimeMs: number; contentHash: string; lastResult: string; billId: string | null; seenAt: string }
export interface WatchBillRow { billId: string; fileName: string; sourceMtimeMs: number; contentFp: string; contentJson: string; appliedRevision: number; updatedAt: string }
export interface ReviewRow {
  id: string; fileName: string; party: string; billDate: string; total: string; mtimeMs: number; why: string; reason: string
  candidateIds: string[]; payloadText: string; createdAt: string; resolvedAt: string | null; resolution: string | null
}
export interface ActivityRow {
  id: string; at: string; kind: string; fileName: string; billId: string | null; party: string; poNumber: string; detail: string
  revision: number | null; prevRevision: number | null; prevSourceMtimeMs: number | null; undoneAt: string | null
}
export interface BillOnDate { id: string; deletedAt: string | null; revision: number; partyName: string; legacyRef: string | null }

const safeIds = (t: string): string[] => { try { const v: unknown = JSON.parse(t); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [] } catch { return [] } }

export function createLegacyWatchRepo(sqlite: Database.Database) {
  const fileGet = sqlite.prepare('SELECT file_name AS fileName, size, mtime_ms AS mtimeMs, content_hash AS contentHash, last_result AS lastResult, bill_id AS billId, seen_at AS seenAt FROM legacy_watch_files WHERE file_name = ?')
  const fileAll = sqlite.prepare('SELECT file_name AS fileName, size, mtime_ms AS mtimeMs, content_hash AS contentHash, last_result AS lastResult, bill_id AS billId, seen_at AS seenAt FROM legacy_watch_files')
  const fileUp = sqlite.prepare(
    `INSERT INTO legacy_watch_files (file_name, size, mtime_ms, content_hash, last_result, bill_id, seen_at)
     VALUES (@fileName, @size, @mtimeMs, @contentHash, @lastResult, @billId, @seenAt)
     ON CONFLICT(file_name) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, content_hash = excluded.content_hash,
       last_result = excluded.last_result, bill_id = excluded.bill_id, seen_at = excluded.seen_at`
  )
  const wbGet = sqlite.prepare('SELECT bill_id AS billId, file_name AS fileName, source_mtime_ms AS sourceMtimeMs, content_fp AS contentFp, content_json AS contentJson, applied_revision AS appliedRevision, updated_at AS updatedAt FROM legacy_watch_bills WHERE bill_id = ?')
  const wbUp = sqlite.prepare(
    `INSERT INTO legacy_watch_bills (bill_id, file_name, source_mtime_ms, content_fp, content_json, applied_revision, updated_at)
     VALUES (@billId, @fileName, @sourceMtimeMs, @contentFp, @contentJson, @appliedRevision, @updatedAt)
     ON CONFLICT(bill_id) DO UPDATE SET file_name = excluded.file_name, source_mtime_ms = excluded.source_mtime_ms, content_fp = excluded.content_fp,
       content_json = excluded.content_json, applied_revision = excluded.applied_revision, updated_at = excluded.updated_at`
  )
  const onDate = sqlite.prepare(
    `SELECT id, deleted_at AS deletedAt, revision, COALESCE(json_extract(party_snapshot_json, '$.name'), '') AS partyName, legacy_ref AS legacyRef FROM bills WHERE bill_date = ? ORDER BY id`
  )
  const revCols = 'id, file_name AS fileName, party, bill_date AS billDate, total, mtime_ms AS mtimeMs, why, reason, candidates_json AS candidatesJson, payload_text AS payloadText, created_at AS createdAt, resolved_at AS resolvedAt, resolution'
  const revInsert = sqlite.prepare(
    `INSERT OR IGNORE INTO legacy_watch_review (id, file_name, party, bill_date, total, mtime_ms, why, reason, candidates_json, payload_text, created_at)
     VALUES (@id, @fileName, @party, @billDate, @total, @mtimeMs, @why, @reason, @candidatesJson, @payloadText, @createdAt)`
  )
  const revOpen = sqlite.prepare(`SELECT ${revCols} FROM legacy_watch_review WHERE resolved_at IS NULL ORDER BY mtime_ms, file_name`)
  const revGet = sqlite.prepare(`SELECT ${revCols} FROM legacy_watch_review WHERE id = ?`)
  // Phase 163: list queries leave the stored file text out (it can be large); `payloadText` is '' there.
  const revLight = revCols.replace('payload_text AS payloadText', "'' AS payloadText")
  const revOpenLight = sqlite.prepare(`SELECT ${revLight} FROM legacy_watch_review WHERE resolved_at IS NULL ORDER BY mtime_ms, file_name`)
  const revIgnoredLight = sqlite.prepare(`SELECT ${revLight} FROM legacy_watch_review WHERE resolution = 'ignored' ORDER BY resolved_at DESC LIMIT 20`)
  const revCount = sqlite.prepare('SELECT COUNT(*) AS n FROM legacy_watch_review WHERE resolved_at IS NULL')
  const revReopen = sqlite.prepare("UPDATE legacy_watch_review SET resolved_at = NULL, resolution = NULL WHERE id = ? AND resolution = 'ignored'")
  const revResolve = sqlite.prepare('UPDATE legacy_watch_review SET resolved_at = @at, resolution = @resolution WHERE id = @id AND resolved_at IS NULL')
  const actCols = 'id, at, kind, file_name AS fileName, bill_id AS billId, party, po_number AS poNumber, detail, revision, prev_revision AS prevRevision, prev_source_mtime_ms AS prevSourceMtimeMs, undone_at AS undoneAt'
  const actInsert = sqlite.prepare(
    `INSERT INTO legacy_watch_activity (id, at, kind, file_name, bill_id, party, po_number, detail, revision, prev_revision, prev_source_mtime_ms)
     VALUES (@id, @at, @kind, @fileName, @billId, @party, @poNumber, @detail, @revision, @prevRevision, @prevSourceMtimeMs)`
  )
  const actTrim = sqlite.prepare('DELETE FROM legacy_watch_activity WHERE id NOT IN (SELECT id FROM legacy_watch_activity ORDER BY at DESC, rowid DESC LIMIT ?)')
  const actList = sqlite.prepare(`SELECT ${actCols} FROM legacy_watch_activity ORDER BY at DESC, rowid DESC LIMIT ?`)
  const actGet = sqlite.prepare(`SELECT ${actCols} FROM legacy_watch_activity WHERE id = ?`)
  const actUndone = sqlite.prepare('UPDATE legacy_watch_activity SET undone_at = @at WHERE id = @id AND undone_at IS NULL')

  type RevDb = Omit<ReviewRow, 'candidateIds'> & { candidatesJson: string }
  const toReview = (r: RevDb): ReviewRow => { const { candidatesJson, ...rest } = r; return { ...rest, candidateIds: safeIds(candidatesJson) } }

  return {
    getFile: (name: string): WatchFileRow | undefined => fileGet.get(name) as WatchFileRow | undefined,
    allFiles: (): WatchFileRow[] => fileAll.all() as WatchFileRow[],
    upsertFile: (r: WatchFileRow): void => { fileUp.run(r) },
    getWatchBill: (billId: string): WatchBillRow | undefined => wbGet.get(billId) as WatchBillRow | undefined,
    upsertWatchBill: (r: WatchBillRow): void => { wbUp.run(r) },
    /** Every bill (trashed included) dated `isoDate`, with its party name; the caller compares the normalised name. */
    billsOnDate: (isoDate: string): BillOnDate[] => onDate.all(isoDate) as BillOnDate[],
    /** Idempotent: the same file + mtime never makes a second open item. */
    insertReview: (r: Omit<ReviewRow, 'resolvedAt' | 'resolution' | 'candidateIds'> & { candidateIds: string[] }): boolean => {
      const { candidateIds, ...rest } = r
      return revInsert.run({ ...rest, candidatesJson: JSON.stringify(candidateIds) }).changes > 0
    },
    openReviews: (): ReviewRow[] => (revOpen.all() as RevDb[]).map(toReview),
    openReviewsLight: (): ReviewRow[] => (revOpenLight.all() as RevDb[]).map(toReview),
    ignoredReviewsLight: (): ReviewRow[] => (revIgnoredLight.all() as RevDb[]).map(toReview),
    countOpenReviews: (): number => (revCount.get() as { n: number }).n,
    /** Puts an IGNORED item back on the open list (never touches an imported / replaced one). */
    reopenReview: (id: string): boolean => revReopen.run(id).changes > 0,
    getReview: (id: string): ReviewRow | undefined => { const r = revGet.get(id) as RevDb | undefined; return r && toReview(r) },
    resolveReview: (id: string, resolution: string, at: string): boolean => revResolve.run({ id, resolution, at }).changes > 0,
    addActivity: (a: Omit<ActivityRow, 'undoneAt'>): void => { actInsert.run(a); actTrim.run(ACTIVITY_KEEP) },
    listActivity: (limit = ACTIVITY_KEEP): ActivityRow[] => actList.all(Math.min(Math.max(Math.trunc(limit), 1), ACTIVITY_KEEP)) as ActivityRow[],
    getActivity: (id: string): ActivityRow | undefined => actGet.get(id) as ActivityRow | undefined,
    markActivityUndone: (id: string, at: string): boolean => actUndone.run({ id, at }).changes > 0,
    /** `BEGIN IMMEDIATE`, like every other write path. */
    transaction: <T>(fn: () => T): T => sqlite.transaction(fn).immediate()
  }
}
export type LegacyWatchRepo = ReturnType<typeof createLegacyWatchRepo>
