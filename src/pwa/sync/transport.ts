import type { RecordKind } from '../../shared/sync/codecV2'
import type { SharedErrorKind } from '../../shared/sync/license'

/**
 * Phase 178 - the part of the shared-notebook transport the phone needs for login and branch.
 *
 * Why a port and not an import: `src/main/sync/sharedTransport.ts` is desktop code (Node `crypto` / `Buffer`), and phone code may never import
 * `src/main`. These shapes are a structural SUBSET of `SharedStoreTransport` (same field names, same meaning), so the desktop's
 * `InMemorySharedTransport` already satisfies the port in tests. The real browser transport (supabase-js in a phone bundle) is
 * a Phase 179 / 186 job and is a STANDING GAP until the owner runs it on a real phone + Supabase. [A]
 */
export interface PhoneSession { accessToken: string; refreshToken: string; expiresAt: number; userId: string }
export interface PhoneBranch { branchId: string; name: string; poPrefix: string }
export interface PhoneActivateArgs { license: string; branchId: string; name: string; poPrefix: string; device: string; takeover: boolean }
export interface PhoneActivateResult { orgId: string; seatNo: number; serverTime: string; maxServerSeq: number; branches: PhoneBranch[] }

export interface PhoneSyncPort {
  signIn(a: { email: string; password: string }): Promise<PhoneSession>
  restoreSession(s: PhoneSession): Promise<PhoneSession>
  onSessionChange(cb: (s: PhoneSession) => void): () => void
  signOut(): Promise<void>
  activate(a: PhoneActivateArgs): Promise<PhoneActivateResult>
  branchNameFree(a: { license: string; name: string; branchId?: string }): Promise<boolean>
  now(): Promise<{ serverTime: string }>
}

/** What a failed call means to the person (text from the shared message table; never the server's own text, never a secret). */
export interface SyncFailure { kind: SharedErrorKind; message: string }

// ------------------------------------------------------------------------------------------------------- Phase 179: push / pull

/** Limits of the shared notebook's RPCs (same numbers as `SHARED_*` in the desktop transport; phone code cannot import `src/main`). */
export const PHONE_PUSH_MAX_ITEMS = 200
export const PHONE_PULL_PAGE = 200
export const PHONE_PAYLOAD_MAX_BYTES = 1024 * 1024
export const PHONE_MANIFEST_PAGE = 1000

export interface PhoneBranchInfo extends PhoneBranch { deviceName: string; lastSeenAt: string | null }
export interface PhoneBranchScope { license: string; branchId: string }
export interface PhoneManifestRow { recId: string; version: number; payloadHash: string; serverSeq: number; deleted: boolean }
export interface PhonePushItem {
  kind: RecordKind
  recId: string
  /** The version the phone last saw (0 = new on the server). */
  baseVersion: number
  payload: Record<string, unknown>
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  deleted: boolean
}
export type PhonePushOutcome = 'accepted' | 'noop' | 'won' | 'lost'
export interface PhonePushResult { kind: RecordKind; recId: string; outcome: PhonePushOutcome; version: number; serverSeq: number }
export interface PhonePulled {
  kind: RecordKind
  recId: string
  version: number
  serverSeq: number
  deleted: boolean
  payload: Record<string, unknown>
  payloadHash: string
  schemaVer: number
  minReaderVer: number
  appVer: string
  editedAt: string
  fromBranch: string | null
}
export interface PhonePullResult { items: PhonePulled[]; hasMore: boolean; serverTime: string }

/**
 * Phase 179 - everything the phone's push / pull / first-sync code needs from the shared notebook: a structural SUBSET of the desktop's
 * `SharedStoreTransport`, so `InMemorySharedTransport` satisfies it in tests. The real browser transport (supabase-js in the phone bundle)
 * is NOT built yet (Phase 186 / owner's real-Supabase checklist): a STANDING GAP. [A]
 */
export interface PhoneSharedPort extends PhoneSyncPort {
  listBranches(a: PhoneBranchScope): Promise<PhoneBranchInfo[]>
  manifest(a: PhoneBranchScope & { kind: RecordKind; afterRecId?: string; limit?: number }): Promise<PhoneManifestRow[]>
  /** All or nothing (one transaction). Outcomes come back in input order. */
  push(a: PhoneBranchScope & { items: PhonePushItem[] }): Promise<PhonePushResult[]>
  /** Records with `serverSeq > afterSeq`, in order. Deletes nothing on the server. */
  pull(a: PhoneBranchScope & { afterSeq: number; limit?: number }): Promise<PhonePullResult>
  /** The data-less doorbell: `onRing` = "something changed, pull now"; `onLive(false)` = the socket is down (the 60 s poll covers). Returns an unsubscribe. */
  subscribeDoorbell(a: { orgId: string }, onRing: () => void, onLive?: (live: boolean) => void): () => void
}
