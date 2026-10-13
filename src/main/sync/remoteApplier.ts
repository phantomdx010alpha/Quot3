import { randomUUID } from 'node:crypto'
import type { RemoteApplyRepo, LocalHead } from '../db/remoteApplyRepo'
import type { SyncStateRepo } from '../db/syncStateRepo'
import { partySnapshotSchema, type BillRecord } from '../../shared/billModel'
import { normalizePartyName } from '../../shared/party/partyLite'
import { sameContent, type ConflictInfo, conflictDetailSchema } from '../../shared/sync/conflict'
import { incomingWins, type HeldChange, type RemoteChangedEvent, type RemoteSnapshot } from '../../shared/sync/pull'
import type { BranchRef, PostboxOp } from './transport'
import type { Logger } from '../logger'

/**
 * Phase 56 - applies ONE decrypted change from another branch to the local database.
 *  - the caller wraps `apply` in a transaction (the pull worker adds the cursor and the pending acknowledgement to it);
 *  - applying the same row twice changes nothing (an equal version never wins);
 *  - the bill that is open in the editor is never touched: a change that would win is kept aside (`held`) until the owner
 *    chooses Keep mine / Load theirs, or until the editor moves to another bill;
 *  - nothing here writes to the outbox: a change that came from another branch is never sent back out.
 */
export type ApplyOutcome = 'inserted' | 'updated' | 'conflicted' | 'ignored' | 'held'
export interface IncomingMeta { fromBranch: string; billId: string; op: PostboxOp; revision: number; updatedAt: string }

/** The sender or the bill's origin branch is not known locally nor in the list the server gave. The caller refreshes the list and retries. */
export class UnknownBranchError extends Error {
  constructor(readonly branchId: string) { super(`Unknown branch ${branchId}`); this.name = 'UnknownBranchError' }
}

interface HeldRecord { fromBranch: string; snapshot: RemoteSnapshot }
export const HELD_PREFIX = 'sync.held.'

export interface RemoteApplier {
  /** Inside the caller's transaction. Throws on an inconsistent or unwritable snapshot (nothing is partly written once the caller rolls back). */
  apply(meta: IncomingMeta, snap: RemoteSnapshot, branches: readonly BranchRef[]): ApplyOutcome
  /** Tells the applier which bill the editor has open. Leaving a bill releases a change that was held for it. */
  setOpenBill(billId: string | null): void
  openBill(): string | null
  held(): HeldChange[]
  /** Phase 57: bills still marked `conflict` (a local edit lost to another branch's change; its full snapshot is in `audit_log`). */
  conflicts(): ConflictInfo[]
  /** Phase 57: the owner has seen the conflict; the bill goes back to pending / synced. */
  dismissConflict(billId: string): { done: boolean }
  /** Keep mine: forget the held change. Load theirs: apply it now (regardless of the ordering) and tell the editor to reload. */
  resolve(billId: string, choice: 'keep' | 'load'): { done: boolean }
  /**
   * Phase 87: one-time repair of bills saved without a party link (received before Phase 87): link by exact normalised name,
   * creating the party when none exists. Idempotent (bills already linked are not listed); the caller guards it with a flag.
   */
  relinkParties(): { linked: number; created: number }
}

export interface RemoteApplierDeps {
  repo: RemoteApplyRepo
  sync: SyncStateRepo
  /** The local branch id (tie-break for a local version that was not yet sent). */
  localBranchId: () => string
  emit: (channel: 'bills:remoteChanged', payload: RemoteChangedEvent) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export function createRemoteApplier(deps: RemoteApplierDeps, opts: { now?: () => Date; newId?: () => string } = {}): RemoteApplier {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const { repo, sync, log } = deps
  let open: string | null = null

  /**
   * Who made the local version: the branch that saved its revision (`bill_revisions.saved_by_branch`). Every version applied from
   * another branch gets such a row, so a revision WITHOUT a row is a delete / restore made on this computer (trash bumps the revision only).
   */
  const stampOfLocal = (h: LocalHead): { updatedAt: string; revision: number; branchId: string } => ({
    updatedAt: h.updatedAt, revision: h.revision,
    branchId: repo.authorOf(h.id, h.revision) ?? deps.localBranchId()
  })

  function check(meta: IncomingMeta, snap: RemoteSnapshot): void {
    const b = snap.bill
    if (b.id !== meta.billId || b.revision !== meta.revision || b.updatedAt !== meta.updatedAt) throw new Error('The change does not match its envelope (bill, revision or time).')
    if (snap.deleted !== (b.deletedAt !== null) || (meta.op === 'delete') !== snap.deleted) throw new Error('The change disagrees with itself about being deleted.')
    if (snap.rows.some((r) => r.billId !== b.id)) throw new Error('A row of the change belongs to another bill.')
  }

  function ensureBranch(id: string, branches: readonly BranchRef[]): void {
    if (repo.branchExists(id)) return
    const known = branches.find((x) => x.branchId === id)
    if (!known) throw new UnknownBranchError(id)
    repo.insertBranch({ id, name: known.name, poPrefix: known.poPrefix, createdAt: now().toISOString() })
  }

  /** Phase 87: the party a bill's snapshot names, by exact normalised name; created (source 'sync') when none exists. Null for a blank name. */
  function partyFor(snapJson: { name: string; phone: string; address: string; transport: string }): { id: string; created: boolean } | null {
    const norm = normalizePartyName(snapJson.name)
    if (norm === '') return null
    const found = repo.findPartyByNorm(norm)
    if (found) return { id: found, created: false }
    const id = newId()
    const nz = (v: string): string | null => (v.trim() === '' ? null : v.trim())
    repo.insertParty({ id, name: snapJson.name.trim().replace(/\s+/g, ' '), nameNorm: norm, phone: nz(snapJson.phone), address: nz(snapJson.address), transport: nz(snapJson.transport), at: now().toISOString() })
    return { id, created: true }
  }

  function write(snap: RemoteSnapshot, fromBranch: string, head: LocalHead | undefined): ApplyOutcome {
    let partyId = snap.bill.partyId !== null && repo.partyExists(snap.bill.partyId) ? snap.bill.partyId : null
    // Phase 87: a party this computer does not know is linked by exact normalised name, or created. A deleted bill never creates one.
    if (partyId === null && !snap.deleted) {
      try {
        const ps = partySnapshotSchema.safeParse(JSON.parse(snap.bill.partySnapshotJson))
        if (ps.success) partyId = partyFor(ps.data)?.id ?? null
      } catch { /* unreadable snapshot: the bill stays unlinked, the relink may try again */ }
    }
    // Phase 57: a local edit that was never sent and now loses is kept in full before it is overwritten.
    // A local version "loses a race" when it was never sent (pending), or when it was made here and the winner is NOT built on it:
    // a winner whose revision number is not higher cannot have seen it (two branches editing the same base reach the same number).
    // A higher winning revision may be a normal continuation, and the older local version then stays in the revision list.
    let conflict = false
    const madeHere = head !== undefined && (repo.authorOf(head.id, head.revision) ?? deps.localBranchId()) === deps.localBranchId()
    if (head && (head.syncState === 'pending' || (madeHere && snap.bill.revision <= head.revision))) {
      const local = repo.record(head.id)
      if (local) {
        const rows = repo.rows(head.id)
        if (!sameContent({ bill: local, rows }, { bill: snap.bill, rows: snap.rows })) {
          conflict = true
          repo.auditConflict({
            at: now().toISOString(), branchId: deps.localBranchId(), billId: head.id,
            detail: {
              lost: local.deletedAt !== null ? 'delete' : 'edit', loserRevision: local.revision, loserUpdatedAt: local.updatedAt,
              winnerBranch: fromBranch, winnerRevision: snap.bill.revision, winnerUpdatedAt: snap.bill.updatedAt, winnerDeleted: snap.deleted,
              snapshot: { bill: local, rows }
            }
          })
        }
      }
    }
    const state = conflict || head?.syncState === 'conflict' ? 'conflict' : head?.syncState === 'pending' ? 'pending' : 'synced'
    const record: BillRecord = { ...snap.bill, partyId, syncState: state }
    repo.upsertBill(record)
    repo.replaceRows(record.id, snap.rows)
    repo.deleteRevisionsAbove(record.id, record.revision)
    repo.putRevision({ id: newId(), billId: record.id, revision: record.revision, snapshotJson: JSON.stringify({ bill: record, rows: snap.rows }), savedAt: record.updatedAt, savedByBranch: fromBranch })
    repo.pruneRevisions(record.id)
    if (conflict) log.warn('A local edit lost to a change from another branch (kept in the audit log)', { billId: record.id })
    return conflict ? 'conflicted' : head ? 'updated' : 'inserted'
  }

  const readHeld = (billId: string): HeldRecord | null => {
    const raw = sync.get(HELD_PREFIX + billId)
    if (raw === undefined) return null
    try { return JSON.parse(raw) as HeldRecord } catch { return null }
  }

  function describe(billId: string, h: HeldRecord): HeldChange {
    const head = repo.head(billId)
    return {
      billId, poNumber: h.snapshot.bill.poNumber || head?.poNumber || '', fromBranch: h.fromBranch, fromBranchName: null,
      revision: h.snapshot.bill.revision, updatedAt: h.snapshot.bill.updatedAt, deleted: h.snapshot.deleted
    }
  }

  function emit(id: string, held: boolean): void {
    try { deps.emit('bills:remoteChanged', { id, held }) } catch (e) { log.warn('Could not announce a remote change', { err: e instanceof Error ? e.message : String(e) }) }
  }

  return {
    apply(meta, snap, branches) {
      check(meta, snap)
      // Phase 88: the same legacy file already lives here under another bill id (fingerprint is unique): never a second copy.
      const fp = snap.bill.importFingerprint
      if (fp && repo.fingerprintOwner(fp, meta.billId) !== undefined) return 'ignored'
      const head = repo.head(meta.billId)
      const incoming = { updatedAt: snap.bill.updatedAt, revision: snap.bill.revision, branchId: meta.fromBranch }
      if (head && !incomingWins(stampOfLocal(head), incoming)) return 'ignored'
      // The very same version re-sent under another sender (the loser of a conflict pushes the winner's content on): nothing to do.
      if (head && head.updatedAt === incoming.updatedAt && head.revision === incoming.revision && sameContent({ bill: repo.record(head.id)!, rows: repo.rows(head.id) }, { bill: snap.bill, rows: snap.rows })) return 'ignored'
      ensureBranch(snap.bill.branchId, branches)
      ensureBranch(meta.fromBranch, branches)
      if (open === meta.billId) {
        const prev = readHeld(meta.billId)
        if (prev && !incomingWins({ updatedAt: prev.snapshot.bill.updatedAt, revision: prev.snapshot.bill.revision, branchId: prev.fromBranch }, incoming)) return 'held'
        sync.set(HELD_PREFIX + meta.billId, JSON.stringify({ fromBranch: meta.fromBranch, snapshot: snap } satisfies HeldRecord))
        return 'held'
      }
      return write(snap, meta.fromBranch, head)
    },

    openBill: () => open,

    setOpenBill(billId) {
      const prev = open
      open = billId
      if (prev === null || prev === billId) return
      const h = readHeld(prev)
      if (!h) return
      try {
        repo.transaction(() => {
          const head = repo.head(prev)
          const incoming = { updatedAt: h.snapshot.bill.updatedAt, revision: h.snapshot.bill.revision, branchId: h.fromBranch }
          if (!head || incomingWins(stampOfLocal(head), incoming)) write(h.snapshot, h.fromBranch, head)
          sync.remove([HELD_PREFIX + prev])
        })
        emit(prev, false)
      } catch (e) {
        log.warn('Could not apply a held change after the editor moved on', { billId: prev, err: e instanceof Error ? e.message : String(e) })
      }
    },

    held: () => sync.keys(HELD_PREFIX).flatMap((k) => {
      const id = k.slice(HELD_PREFIX.length)
      const h = readHeld(id)
      return h ? [describe(id, h)] : []
    }),

    conflicts() {
      return repo.conflicts().flatMap((c) => {
        let raw: unknown
        try { raw = JSON.parse(c.detailJson) } catch { return [] }
        const d = conflictDetailSchema.safeParse(raw)
        if (!d.success) return []
        const { snapshot: _snapshot, ...rest } = d.data
        void _snapshot
        return [{ billId: c.billId, poNumber: c.poNumber, at: c.at, ...rest } satisfies ConflictInfo]
      })
    },

    relinkParties() {
      return repo.transaction(() => {
        let linked = 0, created = 0
        for (const b of repo.unlinkedBills()) {
          let ps: ReturnType<typeof partySnapshotSchema.safeParse>
          try { ps = partySnapshotSchema.safeParse(JSON.parse(b.partySnapshotJson)) } catch { continue }
          if (!ps.success) continue
          const p = partyFor(ps.data)
          if (!p) continue
          repo.linkParty(b.id, p.id)
          linked++
          if (p.created) created++
        }
        return { linked, created }
      })
    },

    dismissConflict: (billId) => ({ done: repo.transaction(() => repo.clearConflict(billId)) }),

    resolve(billId, choice) {
      const h = readHeld(billId)
      if (!h) return { done: false }
      repo.transaction(() => {
        if (choice === 'load') write(h.snapshot, h.fromBranch, repo.head(billId))
        sync.remove([HELD_PREFIX + billId])
      })
      if (choice === 'load') emit(billId, false)
      return { done: true }
    }
  }
}
