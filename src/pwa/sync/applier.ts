import '../../shared/format'
import { partySnapshotSchema, type BillRecord, type BillRowRecord } from '../../shared/billModel'
import { partyRecordId } from '../../shared/customers/duplicates'
import { resolveFormat } from '../../shared/format/registry'
import { normalizePartyName } from '../../shared/party/partyLite'
import { type DecodedRecord } from '../../shared/sync/codecV2'
import { correctedEditedAt, resolveConflict } from '../../shared/sync/diff'
import { reqToPromise } from '../data/db'
import { REVISION_CAP_PER_BILL, rowRange, toStoredBill, toStoredRow, type StoredBill, type StoredRevision, type StoredRow } from '../data/billsRepo'
import type { PartyRecord } from '../data/partiesRepo'
import { isAsideTx } from './aside'
import { billRecordOf, billRowRecordOf, encodeLocalInTx } from './encode'
import { dropUnsentTx, hasUnsentTx } from './outbox'
import { putStateTx } from './recordState'

/**
 * Phase 179 - applies ONE decoded record from the shared notebook to the phone's IndexedDB (port of the desktop `RecordApplierV2`; same rules,
 * not the same SQL). The caller runs it INSIDE one transaction together with the `sync_record_state` write, so a record is applied and remembered
 * together. The transaction must include: `meta`, `parties`, `bills`, `bill_rows`, `bill_revisions`, `sync_outbox`, `sync_record_state`, `sync_aside`.
 *  - applying the same version twice changes nothing (equal content is never written again);
 *  - nothing here writes to the outbox: a record that came from the notebook is never sent back;
 *  - a bill open in the editor is never touched (`held`; the pull worker retries it on its next run);
 *  - an UNSENT local change to the same record (an outbox row exists): the later skew-corrected `edited_at` wins, a tie goes to the greater branch
 *    id (the server's own rule). A losing local version stays in the revision list; a winning one stays queued and its `base_version` moves to the
 *    received version, so the next push is a plain "accepted" (the server keeps the loser in its history);
 *  - the received bill gets a NEW local revision number (`local revision + 1`), so no local revision is ever overwritten;
 *  - a record set aside (a newer app wrote it) is never overwritten by anything this app receives.
 * Customer merges: the survivor's own customer record arrives as a normal `party` record. The phone has no merge log, so an UNDO only clears the
 * pointer on the merged customer; bills the merge moved stay where they are until the PC re-saves them [A].
 */
export type ApplyOutcome = 'inserted' | 'updated' | 'ignored' | 'kept_local' | 'held' | 'unsupported' | 'deferred'

export interface ApplyContext {
  fromBranch: string | null
  /** Offset to add to the phone's clock to get server time (corrects the `edited_at` of an unsent local change). */
  offsetMs: number | null
  /** The record comes out of the aside list after an app update: the aside guard does not apply. */
  fromAside?: boolean
}

export interface ApplierDeps {
  localBranchId: string
  orgId: string | null
  now: () => Date
  newId: () => string
  /** True when the editor has this bill open (never overwritten; the pull worker holds the record). */
  isOpen?: (billId: string) => boolean
  /** "Recent bills + all customers": a bill with `serverSeq` below this and no local copy is not stored (0 = store everything). */
  floorSeq?: number
  revisionCap?: number
}

type StoredParty = PartyRecord & { name_norm: string }
const toStoredParty = (r: PartyRecord): StoredParty => ({ ...r, name_norm: r.nameNorm })
const blank = (v: string | null | undefined): string | null => (v === null || v === undefined || v.trim() === '' ? null : v.trim())

async function readRows(tx: IDBTransaction, billId: string): Promise<StoredRow[]> {
  return (await reqToPromise(tx.objectStore('bill_rows').index('bill_id_idx').getAll(rowRange(billId)))) as StoredRow[]
}

/** Writes the revision snapshot and prunes to the newest `cap` (the same count rule as `billsRepo.saveBill`). */
async function putRevisionTx(tx: IDBTransaction, rec: BillRecord, rows: BillRowRecord[], savedAt: string, byBranch: string, cap: number): Promise<void> {
  const revs = tx.objectStore('bill_revisions')
  revs.put({ bill_id: rec.id, revision: rec.revision, saved_at: savedAt, saved_by_branch: byBranch, snapshot_json: JSON.stringify({ bill: rec, rows }) } satisfies StoredRevision)
  const all = (await reqToPromise(revs.getAll(IDBKeyRange.bound([rec.id, 0], [rec.id, Number.MAX_SAFE_INTEGER])))) as StoredRevision[]
  all.sort((x, y) => y.revision - x.revision)
  for (const old of all.slice(cap)) revs.delete([old.bill_id, old.revision])
}

/** A live customer for the bill's snapshot name (exact normalised name); created with the deterministic id when none exists (source: sync, never queued). */
async function partyForSnapshot(tx: IDBTransaction, snap: { name: string; phone: string; address: string; transport: string }, at: string, d: ApplierDeps): Promise<string | null> {
  const norm = normalizePartyName(snap.name)
  if (norm === '') return null
  const store = tx.objectStore('parties')
  const same = ((await reqToPromise(store.index('name_norm').getAll(norm))) as StoredParty[]).filter((p) => p.deletedAt === null && (p.mergedInto ?? null) === null)
  same.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
  if (same[0]) return same[0].id
  if (d.orgId === null) return null // the phone does not know its organisation yet: no deterministic id to make
  const id = partyRecordId(d.orgId, norm)
  const old = (await reqToPromise(store.get(id))) as StoredParty | undefined
  if (old) return old.deletedAt === null && (old.mergedInto ?? null) === null ? old.id : null // deleted / merged: that record decides, not a bill
  store.put(toStoredParty({ id, name: snap.name.trim().replace(/\s+/g, ' '), nameNorm: norm, phone: blank(snap.phone), address: blank(snap.address), transport: blank(snap.transport), createdAt: at, updatedAt: at, deletedAt: null, mergedInto: null }))
  return id
}

/** Follows `mergedInto` (a customer merged on the PC) to the customer it became. */
async function followMerge(tx: IDBTransaction, id: string): Promise<string> {
  let cur = id
  for (let hop = 0; hop < 8; hop++) {
    const p = (await reqToPromise(tx.objectStore('parties').get(cur))) as StoredParty | undefined
    if (!p || (p.mergedInto ?? null) === null) return cur
    cur = p.mergedInto as string
  }
  return cur
}

async function applyBill(tx: IDBTransaction, rec: DecodedRecord, ctx: ApplyContext, d: ApplierDeps): Promise<ApplyOutcome> {
  const incoming = rec.data.bill as BillRecord
  const rows = rec.data.rows as BillRowRecord[]
  if (incoming.id !== rec.recId) throw new Error('The record does not match its bill id.')
  if ((incoming.deletedAt !== null) !== rec.deleted) throw new Error('The record disagrees with itself about being deleted.')
  if (rows.some((x) => x.billId !== incoming.id)) throw new Error('A row of the record belongs to another bill.')

  const head = (await reqToPromise(tx.objectStore('bills').get(incoming.id))) as StoredBill | undefined
  if (!head && (d.floorSeq ?? 0) > 0 && rec.serverSeq < (d.floorSeq as number)) return 'deferred'
  if (head && d.isOpen?.(incoming.id)) return 'held'
  const cap = Math.max(1, d.revisionCap ?? REVISION_CAP_PER_BILL)
  const at = d.now().toISOString()

  if (head) {
    const localRows = await readRows(tx, head.id)
    const local = await encodeLocalInTx(tx, 'bill', head.id, { offsetMs: null, appVer: '' })
    // Equal content: nothing to write (also the case of our own record coming back from the notebook).
    if (local && local.payloadHash === rec.payloadHash) return 'ignored'
    if (await hasUnsentTx(tx, 'bill', head.id)) {
      const mine = { editedAt: correctedEditedAt(Date.parse(head.updatedAt) || 0, ctx.offsetMs), branchId: d.localBranchId }
      const theirs = { editedAt: rec.editedAt, branchId: ctx.fromBranch ?? '' }
      if (resolveConflict(mine, theirs) === 'a') {
        putStateTx(tx, { kind: 'bill', recId: rec.recId, baseVersion: rec.version, baseHash: rec.payloadHash, serverSeq: rec.serverSeq, syncedAt: at })
        return 'kept_local'
      }
      // The received version is later: the unsent local change loses. It stays in the revision list (a delete / restore flip has no snapshot yet: make one).
      const lost = billRecordOf(head) as unknown as BillRecord
      const revs = tx.objectStore('bill_revisions')
      if ((await reqToPromise(revs.get([head.id, head.revision]))) === undefined) {
        await putRevisionTx(tx, { ...lost, syncState: head.syncState }, localRows.map(billRowRecordOf) as unknown as BillRowRecord[], head.updatedAt, head.branchId, cap + 1)
      }
      dropUnsentTx(tx, 'bill', head.id)
    }
  }

  // The customer: follow a merge, else link by the snapshot's exact name (a stock transfer names a branch, not a customer).
  let partyId: string | null = incoming.partyId
  if (partyId !== null) partyId = await followMerge(tx, partyId)
  if (incoming.deletedAt === null && resolveFormat(incoming.formatId).partyMode !== 'branch') {
    const known = partyId !== null ? ((await reqToPromise(tx.objectStore('parties').get(partyId))) as StoredParty | undefined) : undefined
    if (!known) {
      try {
        const ps = partySnapshotSchema.safeParse(JSON.parse(incoming.partySnapshotJson))
        if (ps.success) partyId = (await partyForSnapshot(tx, ps.data, incoming.updatedAt, d)) ?? partyId
      } catch { /* an unreadable snapshot: the bill keeps the id it came with */ }
    }
  }

  const revision = head ? head.revision + 1 : incoming.revision
  const record: BillRecord = { ...incoming, partyId, revision, syncState: 'synced' }
  const rowStore = tx.objectStore('bill_rows')
  if (head) for (const old of await readRows(tx, head.id)) rowStore.delete(old.id)
  for (const r of rows) rowStore.put(toStoredRow(r))
  tx.objectStore('bills').put(toStoredBill(record))
  await putRevisionTx(tx, record, rows, record.updatedAt, ctx.fromBranch ?? record.branchId, cap)
  return head ? 'updated' : 'inserted'
}

async function applyParty(tx: IDBTransaction, rec: DecodedRecord): Promise<ApplyOutcome> {
  const p = rec.data.party as { id: string; name: string; phone: string | null; address: string | null; transport: string | null; createdAt: string; updatedAt: string; deletedAt: string | null; mergedInto?: string | null }
  if (p.id !== rec.recId) throw new Error('The record does not match its customer id.')
  if ((p.deletedAt !== null) !== rec.deleted) throw new Error('The record disagrees with itself about being deleted.')
  const nameNorm = normalizePartyName(p.name)
  if (nameNorm === '' && p.deletedAt === null) throw new Error('A customer needs a name.')
  const store = tx.objectStore('parties')
  const cur = (await reqToPromise(store.get(p.id))) as StoredParty | undefined
  if (cur && !(p.updatedAt > cur.updatedAt)) return 'ignored'
  store.put(toStoredParty({
    id: p.id, name: p.name.trim().replace(/\s+/g, ' '), nameNorm, phone: p.phone, address: p.address, transport: p.transport,
    createdAt: cur?.createdAt ?? p.createdAt, updatedAt: p.updatedAt, deletedAt: p.deletedAt, mergedInto: p.mergedInto ?? null
  }))
  return cur ? 'updated' : 'inserted'
}

async function applyMerge(tx: IDBTransaction, rec: DecodedRecord): Promise<ApplyOutcome> {
  const m = rec.data.merge as { survivorId: string; mergedId: string; at: string }
  if (m.survivorId === m.mergedId) throw new Error('A customer cannot be merged into itself.')
  const parties = tx.objectStore('parties')
  const merged = (await reqToPromise(parties.get(m.mergedId))) as StoredParty | undefined
  if (rec.deleted) {
    // Undo: only the pointer on the merged customer is cleared (see the file note).
    if (!merged || (merged.mergedInto ?? null) !== m.survivorId) return 'ignored'
    parties.put({ ...merged, mergedInto: null, deletedAt: null })
    return 'updated'
  }
  let changed = false
  const bills = tx.objectStore('bills')
  for (const b of (await reqToPromise(bills.index('party_id').getAll(m.mergedId))) as StoredBill[]) {
    bills.put({ ...b, partyId: m.survivorId, party_id: m.survivorId })
    changed = true
  }
  if (merged && (merged.mergedInto ?? null) !== m.survivorId) {
    parties.put({ ...merged, mergedInto: m.survivorId, deletedAt: merged.deletedAt ?? m.at })
    changed = true
  }
  return changed ? 'updated' : 'ignored'
}

export async function applyRecord(tx: IDBTransaction, rec: DecodedRecord, ctx: ApplyContext, d: ApplierDeps): Promise<ApplyOutcome> {
  if (!ctx.fromAside && (await isAsideTx(tx, rec.kind, rec.recId))) return 'ignored'
  switch (rec.kind) {
    case 'bill': return applyBill(tx, rec, ctx, d)
    case 'party': return applyParty(tx, rec)
    case 'party_merge': return applyMerge(tx, rec)
    default: return 'unsupported' // item rules: the phone has no Items page [A]
  }
}

/** The stores `applyRecord` needs in one transaction. */
export const APPLY_STORES = ['meta', 'parties', 'bills', 'bill_rows', 'bill_revisions', 'sync_outbox', 'sync_record_state', 'sync_aside'] as const
