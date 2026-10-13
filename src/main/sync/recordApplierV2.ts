import type { BillRepo } from '../db/billRepo'
import type { RemoteApplyRepo } from '../db/remoteApplyRepo'
import type { OutboxRepo } from '../db/outboxRepo'
import type { ItemRulesRepo } from '../db/itemRulesRepo'
import type { Logger } from '../logger'
import { partySnapshotSchema, type BillRecord, type BillRowRecord } from '../../shared/billModel'
import { normalizePartyName } from '../../shared/party/partyLite'
import type { ItemRuleRow } from '../../shared/items/rules'
import { hashPayload, type DecodedRecord } from '../../shared/sync/codecV2'
import { correctedEditedAt, resolveConflict } from '../../shared/sync/diff'
import { UnknownBranchError } from './remoteApplier'
import type { SharedBranch } from './sharedTransport'

/**
 * Phase 135 - applies ONE decoded record from the shared notebook to the local database (the minimum the pull worker needs; Phase 136
 * adds party records, the open-bill banner and the History count). Rules:
 *  - the caller wraps `apply` in a transaction with the `sync_record_state` write, so a record is applied and remembered together;
 *  - applying the same version twice changes nothing (equal content is never written again);
 *  - nothing here writes to the outbox: a record that came from the notebook is never sent back;
 *  - a bill that is open in the editor is never touched (`isOpen` -> `held`; the worker retries it next run);
 *  - when this computer has an UNSENT local change to the same record, the later skew-corrected `edited_at` wins (tie: greater branch
 *    id), exactly the rule the server applies. A losing local version stays in the revision list; a winning one stays queued, and
 *    its `base_version` is moved to the received version so the next push is a plain "accepted" (the server keeps the loser in history).
 *  - the received version is stored with a NEW local revision number (`local revision + 1`), so no local revision is ever deleted.
 */
export type ApplyOutcomeV2 = 'inserted' | 'updated' | 'ignored' | 'kept_local' | 'held' | 'unsupported'

export interface ApplyContext {
  /** The branch that made this version (`sn_pull.from_branch`); null when the server did not say. */
  fromBranch: string | null
  /** Offset to add to this computer's clock to get server time (corrects the local `edited_at` of an unsent change). */
  offsetMs: number | null
  /** The owner chose "Load theirs" for a held bill: the editor guard and an unsent local change do not stop this apply. */
  force?: boolean
  /** The record comes out of the set-aside list after an app update: it is itself the aside row, so the aside guard does not apply. */
  fromAside?: boolean
}

export interface RecordApplierV2 {
  /** Inside the caller's transaction. Throws on an inconsistent or unwritable record (the caller records the failure and goes on). */
  apply(rec: DecodedRecord, ctx: ApplyContext): ApplyOutcomeV2
}

export interface RecordApplierV2Deps {
  repo: RemoteApplyRepo
  /** The full local record (with the legacy-import tags) for the equal-content check. */
  bills: Pick<BillRepo, 'getRecord' | 'getRows'>
  outbox: Pick<OutboxRepo, 'dropUnsent'>
  itemRules?: Pick<ItemRulesRepo, 'get' | 'applyRemote'>
  localBranchId: () => string
  /** Branches known from the server (for a bill from a branch this computer has not seen yet). */
  branches: () => readonly SharedBranch[]
  /** Phase 136: true when this record is kept in `sync_aside` (a newer writer's version): a local copy is never overwritten by an older one. */
  isAside?: (kind: string, recId: string) => boolean
  /** The bill the editor has open (never overwritten; the pull worker holds the record, `heldService` lists it). */
  isOpen?: (billId: string) => boolean
  /** Told when a bill was written (the renderer refreshes lists). */
  onBillChanged?: (billId: string) => void
  /** Moves the remembered server version of a record (used when a local unsent change wins). */
  rememberBase: (kind: string, recId: string, version: number, hash: string, serverSeq: number) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export function createRecordApplierV2(deps: RecordApplierV2Deps, opts: { now?: () => Date; newId: () => string }): RecordApplierV2 {
  const now = opts.now ?? (() => new Date())
  const { repo, log } = deps

  function ensureBranch(id: string): void {
    if (repo.branchExists(id)) return
    const known = deps.branches().find((b) => b.branchId === id)
    if (!known) throw new UnknownBranchError(id)
    repo.insertBranch({ id, name: known.name, poPrefix: known.poPrefix, createdAt: now().toISOString() })
  }

  /** The party a bill's snapshot names, by exact normalised name; created (source 'sync') when none exists. Same rule as v1 (Phase 87). */
  function partyFor(snap: { name: string; phone: string; address: string; transport: string }): string | null {
    const norm = normalizePartyName(snap.name)
    if (norm === '') return null
    const found = repo.findPartyByNorm(norm)
    if (found) return found
    const id = opts.newId()
    const nz = (v: string): string | null => (v.trim() === '' ? null : v.trim())
    repo.insertParty({ id, name: snap.name.trim().replace(/\s+/g, ' '), nameNorm: norm, phone: nz(snap.phone), address: nz(snap.address), transport: nz(snap.transport), at: now().toISOString() })
    return id
  }

  function applyBill(rec: DecodedRecord, ctx: ApplyContext): ApplyOutcomeV2 {
    const incoming = rec.data.bill as BillRecord
    const rows = rec.data.rows as BillRowRecord[]
    if (incoming.id !== rec.recId) throw new Error('The record does not match its bill id.')
    if ((incoming.deletedAt !== null) !== rec.deleted) throw new Error('The record disagrees with itself about being deleted.')
    if (rows.some((x) => x.billId !== incoming.id)) throw new Error('A row of the record belongs to another bill.')
    // The same legacy file already lives here under another bill id (the fingerprint is unique): never a second copy.
    if (incoming.importFingerprint && repo.fingerprintOwner(incoming.importFingerprint, incoming.id) !== undefined) return 'ignored'

    const head = repo.head(incoming.id)
    if (head && !ctx.force && deps.isOpen?.(incoming.id)) return 'held'

    if (head) {
      const local = deps.bills.getRecord(head.id) as BillRecord | undefined
      if (local) {
        // Equal content: nothing to write (also the case of our own record coming back from the notebook).
        const { syncState: _s, ...bare } = local
        void _s
        const localHash = hashPayload('bill', { v: 2, kind: 'bill', bill: bare, rows: deps.bills.getRows(head.id), deleted: local.deletedAt !== null })
        if (localHash === rec.payloadHash) return 'ignored'
        if (!ctx.force && (head.syncState === 'pending' || head.syncState === 'conflict')) {
          const mine = { editedAt: correctedEditedAt(Date.parse(head.updatedAt) || 0, ctx.offsetMs), branchId: deps.localBranchId() }
          const theirs = { editedAt: rec.editedAt, branchId: ctx.fromBranch ?? '' }
          if (resolveConflict(mine, theirs) === 'a') {
            deps.rememberBase('bill', rec.recId, rec.version, rec.payloadHash, rec.serverSeq)
            return 'kept_local'
          }
          // The received version is later: this computer's unsent change loses and stays in the revision list.
          deps.outbox.dropUnsent(head.id)
        } else if (ctx.force) {
          deps.outbox.dropUnsent(head.id) // "Load theirs": the owner chose it; the local version stays in the revision list
        }
      }
    }

    ensureBranch(incoming.branchId)
    if (ctx.fromBranch) ensureBranch(ctx.fromBranch)
    // Phase 137: a bill that names a customer that was merged since links to the customer it became.
    let partyId = incoming.partyId !== null ? repo.resolveParty(incoming.partyId) : null
    if (partyId === null && incoming.deletedAt === null) {
      try {
        const ps = partySnapshotSchema.safeParse(JSON.parse(incoming.partySnapshotJson))
        if (ps.success) partyId = partyFor(ps.data)
      } catch { /* unreadable snapshot: the bill stays unlinked; the relink pass may try again */ }
    }
    const revision = head ? head.revision + 1 : incoming.revision
    const record: BillRecord = { ...incoming, partyId, revision, syncState: 'synced' }
    repo.upsertBill(record)
    repo.replaceRows(record.id, rows)
    repo.putRevision({ id: opts.newId(), billId: record.id, revision, snapshotJson: JSON.stringify({ bill: record, rows }), savedAt: record.updatedAt, savedByBranch: ctx.fromBranch ?? record.branchId })
    repo.pruneRevisions(record.id)
    try { deps.onBillChanged?.(record.id) } catch (e) { log.warn('Could not announce a received bill', { err: e instanceof Error ? e.message : String(e) }) }
    return head ? 'updated' : 'inserted'
  }

  /**
   * A customer record. By id: no local row -> insert; a row -> replaced only when the received `updatedAt` is later (equal or older =
   * ignored, so applying twice changes nothing). A deleted / merged customer keeps its row (bills may still point at it). Nothing is
   * merged here: a different row with the same name stays until Phase 137 unifies them.
   */
  function applyParty(rec: DecodedRecord): ApplyOutcomeV2 {
    const p = rec.data.party as { id: string; name: string; phone: string | null; address: string | null; transport: string | null; createdAt: string; updatedAt: string; deletedAt: string | null; mergedInto?: string | null }
    if (p.id !== rec.recId) throw new Error('The record does not match its customer id.')
    if ((p.deletedAt !== null) !== rec.deleted) throw new Error('The record disagrees with itself about being deleted.')
    const nameNorm = normalizePartyName(p.name)
    if (nameNorm === '' && p.deletedAt === null) throw new Error('A customer needs a name.')
    const cur = repo.getParty(p.id)
    if (cur && !(p.updatedAt > cur.updatedAt)) return 'ignored'
    repo.upsertParty({
      id: p.id, name: p.name.trim().replace(/\s+/g, ' '), nameNorm, phone: p.phone, address: p.address, transport: p.transport,
      createdAt: cur?.createdAt ?? p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt, mergedInto: p.mergedInto ?? null
    })
    if (!cur && p.deletedAt === null) repo.adoptSyncParties(p.id, nameNorm, p.updatedAt)
    return cur ? 'updated' : 'inserted'
  }

  /**
   * Phase 137: a customer merge (`deleted` = the merge was undone). Bills move, the merged customer is marked; the survivor's own
   * customer record (blanks filled) arrives as a normal `party` record. Applying twice changes nothing.
   */
  function applyMerge(rec: DecodedRecord): ApplyOutcomeV2 {
    const m = rec.data.merge as { survivorId: string; mergedId: string; at: string }
    if (m.survivorId === m.mergedId) throw new Error('A customer cannot be merged into itself.')
    const args = { survivorId: m.survivorId, mergedId: m.mergedId, at: m.at }
    const r = rec.deleted ? repo.restorePartyMerge(args) : repo.applyPartyMerge(args)
    return r === 'applied' ? 'updated' : 'ignored'
  }

  function applyRule(rec: DecodedRecord): ApplyOutcomeV2 {
    if (!deps.itemRules) return 'unsupported'
    const rule = rec.data.rule as ItemRuleRow
    if (rule.id !== rec.recId) throw new Error('The record does not match its rule id.')
    return deps.itemRules.applyRemote(rule, { at: now().toISOString(), branchId: deps.localBranchId() })
  }

  return {
    apply(rec, ctx) {
      // A record that is set aside (a newer app wrote it) is never overwritten by anything this app receives.
      if (!ctx.fromAside && deps.isAside?.(rec.kind, rec.recId)) return 'ignored'
      switch (rec.kind) {
        case 'bill': return applyBill(rec, ctx)
        case 'party': return applyParty(rec)
        case 'party_merge': return applyMerge(rec)
        case 'item_rule': return applyRule(rec)
        default: return 'unsupported'
      }
    }
  }
}
