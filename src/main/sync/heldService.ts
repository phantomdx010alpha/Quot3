import type { SyncRecordRepo } from '../db/syncRecordRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import type { HeldChange } from '../../shared/sync/pull'
import { decodeRecord, type DecodedRecord, type RawRecord } from '../../shared/sync/codecV2'
import type { RecordApplierV2 } from './recordApplierV2'
import { SHARED_STATE_KEYS } from './sharedState'

/**
 * Phase 136 - the open-bill banner of the v1 pull (Phase 56) over the v2 records.
 * The editor tells this service which bill is open (`setOpenBill`); the applier is given `isOpen`, so a received version of that bill is
 * never written under the owner's hands. The pull worker keeps such a record (flag `held`, no attempt counted) and retries it every run,
 * so it is applied by itself once the editor moves to another bill. While it waits, `list()` feeds the banner and `resolve` lets the owner
 * choose now: Keep mine (forget the received version; later saves build on it, so the next push is a plain accept) or Load theirs (apply it
 * now, regardless of the ordering; the unsent local change stays in the revision list and `onLoaded` tells the editor to reload).
 * Nothing here logs record content.
 */
export interface HeldServiceDeps {
  records: SyncRecordRepo
  sync: Pick<SyncStateRepo, 'get' | 'remove' | 'keys'>
  applier: RecordApplierV2
  offsetMs: () => number | null
  /** The editor reloads this bill (`bills:remoteChanged`). */
  onLoaded?: (billId: string) => void
  now?: () => Date
}

export interface HeldService {
  setOpenBill(billId: string | null): void
  openBill(): string | null
  /** For `createRecordApplierV2({ isOpen })`. */
  isOpen(billId: string): boolean
  list(): HeldChange[]
  resolve(billId: string, choice: 'keep' | 'load'): { done: boolean }
}

interface Stored { held?: boolean; payloadHash?: string; raw?: RawRecord & { fromBranch?: string | null } }

export function createHeldService(deps: HeldServiceDeps): HeldService {
  const now = deps.now ?? (() => new Date())
  let open: string | null = null

  const key = (billId: string): string => `${SHARED_STATE_KEYS.pullFail}bill.${billId}`
  const read = (billId: string): Stored | null => {
    const raw = deps.sync.get(key(billId))
    if (raw === undefined) return null
    try { const s = JSON.parse(raw) as Stored; return s.held === true && s.raw ? s : null } catch { return null }
  }

  return {
    setOpenBill(id) { open = id },
    openBill: () => open,
    isOpen: (id) => open === id,

    list() {
      const out: HeldChange[] = []
      for (const k of deps.sync.keys(`${SHARED_STATE_KEYS.pullFail}bill.`)) {
        const s = read(k.slice(`${SHARED_STATE_KEYS.pullFail}bill.`.length))
        if (!s?.raw) continue
        const bill = (s.raw.payload as { bill?: { poNumber?: unknown; revision?: unknown; updatedAt?: unknown } } | null)?.bill
        out.push({
          billId: s.raw.recId, poNumber: typeof bill?.poNumber === 'string' ? bill.poNumber : '', fromBranch: s.raw.fromBranch ?? '', fromBranchName: null,
          revision: typeof bill?.revision === 'number' ? bill.revision : 0, updatedAt: typeof bill?.updatedAt === 'string' ? bill.updatedAt : '', deleted: s.raw.deleted === true
        })
      }
      return out
    },

    resolve(billId, choice) {
      const s = read(billId)
      if (!s?.raw) return { done: false }
      const dec = decodeRecord(s.raw)
      if (dec.outcome !== 'apply') { deps.sync.remove([key(billId)]); return { done: true } }
      const rec: DecodedRecord = dec.record
      deps.records.transaction(() => {
        if (choice === 'load') deps.applier.apply(rec, { fromBranch: s.raw?.fromBranch ?? null, offsetMs: deps.offsetMs(), force: true })
        // Either way this computer has now SEEN that version: later saves build on it.
        deps.records.putState({ kind: rec.kind, recId: rec.recId, baseVersion: rec.version, baseHash: rec.payloadHash, serverSeq: rec.serverSeq, syncedAt: now().toISOString() })
        deps.sync.remove([key(billId)])
      })
      if (choice === 'load') { try { deps.onLoaded?.(billId) } catch { /* the editor refreshes on its next load */ } }
      return { done: true }
    }
  }
}

/** The `apply` callback of `createAsideService` after an app update: applies a record that was set aside and remembers its version. */
export function createAsideApply(deps: { applier: RecordApplierV2; records: SyncRecordRepo; offsetMs: () => number | null; now?: () => Date }): (rec: DecodedRecord) => void {
  const now = deps.now ?? (() => new Date())
  return (rec) => {
    const out = deps.applier.apply(rec, { fromBranch: null, offsetMs: deps.offsetMs(), fromAside: true })
    if (out === 'held') throw new Error('The bill is open in the editor.') // stays set aside; retried next time
    if (out === 'unsupported') throw new Error('This kind of record cannot be applied yet.')
    if (out !== 'kept_local') deps.records.putState({ kind: rec.kind, recId: rec.recId, baseVersion: rec.version, baseHash: rec.payloadHash, serverSeq: rec.serverSeq, syncedAt: now().toISOString() })
  }
}
