/**
 * Phase 134 (docs/SYNC_SHARED_STORE_SPEC.md section 7): the compare step of the shared notebook. Pure, no I/O, linear time
 * (a first sync compares tens of thousands of records). Used for the first sync of a computer and after a long offline spell.
 *
 * Content hash = `codecV2.hashPayload` (canonical sync fields; never `revision` / `updatedAt`; the `deleted` flag IS included), so
 * bills both computers already hold with the same id and content (e.g. merged through a backup) are skipped, and a legacy-imported
 * bill needs no special path: it is "only local", so it is uploaded.
 */

/** One record as this computer has it (built from SQLite + `sync_record_state`). */
export interface LocalEntry {
  recId: string
  /** Content hash of the record as it is now (`hashPayload`). */
  hash: string
  /** Server version this computer last saw (`sync_record_state.base_version`); 0 or absent = none known. */
  baseVersion?: number
  /** Content hash at that version (`sync_record_state.base_hash`); absent = none known. */
  baseHash?: string | null
}

/** One row of `sn_manifest`. */
export interface RemoteEntry {
  recId: string
  version: number
  payloadHash: string
  serverSeq: number
  deleted?: boolean
}

export interface SkipItem { recId: string; version: number; hash: string; serverSeq: number }
export interface UploadItem { recId: string; hash: string; /** What `sn_push` receives as `baseVersion` (0 = new on the server). */ baseVersion: number }
export interface DownloadItem { recId: string; version: number; hash: string; serverSeq: number; deleted: boolean }
export interface ConflictItem { recId: string; localHash: string; remoteHash: string; remoteVersion: number; baseVersion: number; serverSeq: number }

export interface SyncPlan {
  skip: SkipItem[]
  upload: UploadItem[]
  download: DownloadItem[]
  conflict: ConflictItem[]
}

/** Why a record landed in its bucket (tests and the progress screen use it). */
export type PlanReason = 'same_content' | 'only_local' | 'only_remote' | 'local_unchanged' | 'remote_unchanged' | 'both_changed' | 'no_base'

/**
 * The table of spec section 7:
 *  same id, same hash                          -> skip (record the server version as `base_version`)
 *  only local                                  -> upload
 *  only server                                 -> download
 *  both, differ, local unchanged since base    -> download
 *  both, differ, server still at local base    -> upload
 *  both, differ, both changed or no base known -> conflict (later skew-corrected `edited_at` wins; the loser is kept as a revision)
 * Output order follows the input order (local first, then remote-only), so a plan is deterministic. Duplicate ids: the last one wins.
 */
export function planSync(local: readonly LocalEntry[], remote: readonly RemoteEntry[]): SyncPlan {
  const remoteById = new Map<string, RemoteEntry>()
  for (const r of remote) remoteById.set(r.recId, r)
  const localById = new Map<string, LocalEntry>()
  for (const l of local) localById.set(l.recId, l)

  const plan: SyncPlan = { skip: [], upload: [], download: [], conflict: [] }
  for (const l of localById.values()) {
    const r = remoteById.get(l.recId)
    if (!r) { plan.upload.push({ recId: l.recId, hash: l.hash, baseVersion: 0 }); continue }
    if (r.payloadHash === l.hash) { plan.skip.push({ recId: l.recId, version: r.version, hash: r.payloadHash, serverSeq: r.serverSeq }); continue }
    const base = Number.isInteger(l.baseVersion) && (l.baseVersion as number) > 0 ? (l.baseVersion as number) : 0
    const baseKnown = base > 0 && typeof l.baseHash === 'string' && l.baseHash !== ''
    if (baseKnown && l.hash === l.baseHash) {
      plan.download.push({ recId: l.recId, version: r.version, hash: r.payloadHash, serverSeq: r.serverSeq, deleted: r.deleted === true })
    } else if (base > 0 && r.version === base) {
      plan.upload.push({ recId: l.recId, hash: l.hash, baseVersion: base })
    } else {
      plan.conflict.push({ recId: l.recId, localHash: l.hash, remoteHash: r.payloadHash, remoteVersion: r.version, baseVersion: base, serverSeq: r.serverSeq })
    }
  }
  for (const r of remoteById.values()) {
    if (!localById.has(r.recId)) plan.download.push({ recId: r.recId, version: r.version, hash: r.payloadHash, serverSeq: r.serverSeq, deleted: r.deleted === true })
  }
  return plan
}

/** The reason a single pair lands where it does (same rules as `planSync`; for explanations, not for the hot path). */
export function explainPair(l: LocalEntry | undefined, r: RemoteEntry | undefined): PlanReason {
  if (l && !r) return 'only_local'
  if (!l && r) return 'only_remote'
  if (!l || !r) throw new TypeError('explainPair: both sides missing')
  if (l.hash === r.payloadHash) return 'same_content'
  const base = Number.isInteger(l.baseVersion) && (l.baseVersion as number) > 0 ? (l.baseVersion as number) : 0
  if (base > 0 && typeof l.baseHash === 'string' && l.baseHash !== '' && l.hash === l.baseHash) return 'local_unchanged'
  if (base > 0 && r.version === base) return 'remote_unchanged'
  return base === 0 ? 'no_base' : 'both_changed'
}

export interface PlanCounts { skip: number; upload: number; download: number; conflict: number; total: number }
export const planCounts = (p: SyncPlan): PlanCounts => ({
  skip: p.skip.length, upload: p.upload.length, download: p.download.length, conflict: p.conflict.length,
  total: p.skip.length + p.upload.length + p.download.length + p.conflict.length
})

// ------------------------------------------------------------------------------------------------------------------ conflicts

/** One side of a conflict. `editedAt` must already be corrected by the sender's measured clock offset (`correctedEditedAt`). */
export interface ConflictSide { editedAt: string; branchId: string }

const stamp = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/**
 * Later (skew-corrected) `edited_at` wins; a tie goes to the greater branch id (same rule as the server's `sn_push`). An unparseable
 * time loses to a parseable one. Returns which side wins; the other is kept as a local revision / server history, never dropped.
 * Equal in every respect -> `a` (the same inputs always give the same answer).
 */
export function resolveConflict(a: ConflictSide, b: ConflictSide): 'a' | 'b' {
  const ta = stamp(a.editedAt)
  const tb = stamp(b.editedAt)
  if (ta !== tb) return ta > tb ? 'a' : 'b'
  if (a.branchId === b.branchId) return 'a'
  return a.branchId > b.branchId ? 'a' : 'b'
}

// ---------------------------------------------------------------------------------------------------------------- clock offset

/** Above this offset (either direction) the app shows a quiet "check this computer's clock" warning (spec section 6). */
export const CLOCK_WARN_MS = 120_000

/**
 * Offset to ADD to this computer's clock to get server time: server time minus the midpoint of the request (the server stamped its
 * answer somewhere inside the round trip). Returns null when any input is unusable.
 */
export function offsetFromServerTime(serverTimeIso: string, requestStartMs: number, responseEndMs: number): number | null {
  const server = Date.parse(serverTimeIso)
  if (Number.isNaN(server) || !Number.isFinite(requestStartMs) || !Number.isFinite(responseEndMs) || responseEndMs < requestStartMs) return null
  return Math.round(server - (requestStartMs + responseEndMs) / 2)
}

export const isClockSkewLarge = (offsetMs: number | null | undefined): boolean => typeof offsetMs === 'number' && Math.abs(offsetMs) > CLOCK_WARN_MS

/** The sender's clock corrected by its measured offset, as an ISO string (an unknown offset = the raw clock). */
export function correctedEditedAt(localMs: number, offsetMs: number | null | undefined): string {
  return new Date(localMs + (typeof offsetMs === 'number' && Number.isFinite(offsetMs) ? offsetMs : 0)).toISOString()
}
