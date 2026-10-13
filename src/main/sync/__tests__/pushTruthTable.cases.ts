/**
 * Phase 130 - the conflict table of docs/SYNC_SHARED_STORE_SPEC.md section 6 as DATA plus a tiny reference model.
 *
 * This is the contract for the server rule `sn_push` (supabase/sql/15_rpcs.sql). Phase 132's InMemorySharedTransport MUST pass the
 * same `PUSH_CASES` (import them in its test and compare outcome / version / history / winner). Pure: no Electron, no DB, no I/O.
 * Timestamps are epoch milliseconds here only so the table is easy to read; the server compares timestamptz.
 */
export type PushOutcome = 'accepted' | 'noop' | 'won' | 'lost'
export type HistoryEntry = { reason: 'superseded' | 'conflict_loser'; side: 'stored' | 'incoming' } | null

export interface StoredRec {
  version: number
  payloadHash: string
  editedAt: number
  fromBranch: string | null
}
export interface IncomingItem {
  baseVersion: number
  payloadHash: string
  editedAt: number
}
export interface PushCase {
  name: string
  stored: StoredRec | null
  incoming: IncomingItem
  /** the pushing branch id */
  branch: string
  outcome: PushOutcome
  /** stored version after the call */
  versionAfter: number
  /** does the stored server_seq change (so every branch pulls it)? */
  seqBumps: boolean
  /** which payload is stored afterwards */
  storedAfter: 'incoming' | 'unchanged'
  history: HistoryEntry
}

export const ZERO_BRANCH = '00000000-0000-0000-0000-000000000000'
const A = '11111111-1111-4111-8111-111111111111' // smaller branch id
const B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' // greater branch id
const T = 1_700_000_000_000

const stored = (over: Partial<StoredRec> = {}): StoredRec => ({ version: 3, payloadHash: 'hash-stored', editedAt: T, fromBranch: A, ...over })

export const PUSH_CASES: PushCase[] = [
  { name: 'no row yet -> insert, version 1', stored: null, incoming: { baseVersion: 0, payloadHash: 'h1', editedAt: T }, branch: B, outcome: 'accepted', versionAfter: 1, seqBumps: true, storedAfter: 'incoming', history: null },
  { name: 'same hash, base current -> noop (idempotent resend)', stored: stored(), incoming: { baseVersion: 3, payloadHash: 'hash-stored', editedAt: T + 5 }, branch: B, outcome: 'noop', versionAfter: 3, seqBumps: false, storedAfter: 'unchanged', history: null },
  { name: 'same hash, stale base -> noop', stored: stored(), incoming: { baseVersion: 1, payloadHash: 'hash-stored', editedAt: T - 5 }, branch: B, outcome: 'noop', versionAfter: 3, seqBumps: false, storedAfter: 'unchanged', history: null },
  { name: 'base = stored version -> accepted, old row superseded', stored: stored(), incoming: { baseVersion: 3, payloadHash: 'h-new', editedAt: T - 999 }, branch: B, outcome: 'accepted', versionAfter: 4, seqBumps: true, storedAfter: 'incoming', history: { reason: 'superseded', side: 'stored' } },
  { name: 'base < stored, incoming edited later -> won, old stored row is the loser', stored: stored(), incoming: { baseVersion: 2, payloadHash: 'h-new', editedAt: T + 1 }, branch: A, outcome: 'won', versionAfter: 4, seqBumps: true, storedAfter: 'incoming', history: { reason: 'conflict_loser', side: 'stored' } },
  { name: 'base < stored, incoming edited earlier -> lost, incoming payload kept in history', stored: stored(), incoming: { baseVersion: 2, payloadHash: 'h-new', editedAt: T - 1 }, branch: B, outcome: 'lost', versionAfter: 4, seqBumps: true, storedAfter: 'unchanged', history: { reason: 'conflict_loser', side: 'incoming' } },
  { name: 'edited_at tie, incoming branch id greater -> won', stored: stored({ fromBranch: A }), incoming: { baseVersion: 1, payloadHash: 'h-new', editedAt: T }, branch: B, outcome: 'won', versionAfter: 4, seqBumps: true, storedAfter: 'incoming', history: { reason: 'conflict_loser', side: 'stored' } },
  { name: 'edited_at tie, incoming branch id smaller -> lost', stored: stored({ fromBranch: B }), incoming: { baseVersion: 1, payloadHash: 'h-new', editedAt: T }, branch: A, outcome: 'lost', versionAfter: 4, seqBumps: true, storedAfter: 'unchanged', history: { reason: 'conflict_loser', side: 'incoming' } },
  { name: 'both branches created the record (base 0, row exists), later wins', stored: stored({ version: 1 }), incoming: { baseVersion: 0, payloadHash: 'h-new', editedAt: T + 10 }, branch: A, outcome: 'won', versionAfter: 2, seqBumps: true, storedAfter: 'incoming', history: { reason: 'conflict_loser', side: 'stored' } },
  { name: 'base > stored (server restored from an older state) -> conflict path, not accepted', stored: stored(), incoming: { baseVersion: 9, payloadHash: 'h-new', editedAt: T - 1 }, branch: B, outcome: 'lost', versionAfter: 4, seqBumps: true, storedAfter: 'unchanged', history: { reason: 'conflict_loser', side: 'incoming' } },
  { name: 'tie against a row with no from_branch -> incoming wins (any real branch id > zero uuid)', stored: stored({ fromBranch: null }), incoming: { baseVersion: 1, payloadHash: 'h-new', editedAt: T }, branch: A, outcome: 'won', versionAfter: 4, seqBumps: true, storedAfter: 'incoming', history: { reason: 'conflict_loser', side: 'stored' } }
]

export interface PushResult {
  outcome: PushOutcome
  versionAfter: number
  seqBumps: boolean
  storedAfter: 'incoming' | 'unchanged'
  history: HistoryEntry
}

/** The rule, written once more in TypeScript. Must agree with sn_push in 15_rpcs.sql (checked by reading) and with every transport. */
export function referencePush(stored: StoredRec | null, incoming: IncomingItem, branch: string): PushResult {
  if (!stored) return { outcome: 'accepted', versionAfter: 1, seqBumps: true, storedAfter: 'incoming', history: null }
  if (stored.payloadHash === incoming.payloadHash) return { outcome: 'noop', versionAfter: stored.version, seqBumps: false, storedAfter: 'unchanged', history: null }
  if (incoming.baseVersion === stored.version) return { outcome: 'accepted', versionAfter: stored.version + 1, seqBumps: true, storedAfter: 'incoming', history: { reason: 'superseded', side: 'stored' } }
  const wins = incoming.editedAt > stored.editedAt || (incoming.editedAt === stored.editedAt && branch > (stored.fromBranch ?? ZERO_BRANCH))
  return wins
    ? { outcome: 'won', versionAfter: stored.version + 1, seqBumps: true, storedAfter: 'incoming', history: { reason: 'conflict_loser', side: 'stored' } }
    : { outcome: 'lost', versionAfter: stored.version + 1, seqBumps: true, storedAfter: 'unchanged', history: { reason: 'conflict_loser', side: 'incoming' } }
}

/** Newest-first cap per record (spec section 6 / sn_history_add). */
export const HISTORY_CAP = 20
export const capHistory = (count: number): number => Math.min(count, HISTORY_CAP)
