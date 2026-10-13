import { randomUUID } from 'node:crypto'
import type { PartyRepo } from '../db/partyRepo'
import type { CustomerRepo } from '../db/customerRepo'
import { aggregateCustomerStats, validateCustomerInput, type CustomerInput, type CustomerRow } from '../../shared/customers/customerList'
import { decodeCursor, encodeCursor, HISTORY_PAGE_MAX, HISTORY_PAGE_SIZE, type BillListItem } from '../../shared/history/historyList'
import { normalizePartyName } from '../../shared/party/partyLite'
import {
  fillBlanks, findPossibleDuplicates, mergeRecordId, planUnify,
  type DupParty, type DuplicateParty, type DuplicateSuggestion, type MergeResult, type UndoMergeResult, type UnifyResult
} from '../../shared/customers/duplicates'
import { AppError } from '../ipc/envelope'

export interface CustomerBillsInput { partyId: string; cursor?: string; limit?: number }
export interface CustomerBillsResult { items: BillListItem[]; next?: string }

export interface CustomerService {
  /** Every live customer, name A-Z, with bill count / last bill date / total billed (live bills only). */
  list(): CustomerRow[]
  create(input: CustomerInput): { id: string }
  /** Replaces the four fields (blank optional field = cleared). Existing bills keep their party snapshot. */
  update(id: string, input: CustomerInput): { id: string }
  /** Soft delete; bills keep `party_id` and their snapshot. */
  remove(id: string): { id: string }
  bills(input: CustomerBillsInput): CustomerBillsResult
  /** Phase 137: customers with SIMILAR (never equal) names, each with the rule that suggests it. Pairs the owner marked "Not the same" are left out. */
  duplicates(): DuplicateSuggestion[]
  /** Phase 137: merge `mergedId` into `survivorId` (bills re-pointed, blanks filled, the merged one soft-deleted). One undo step. */
  merge(input: { survivorId: string; mergedId: string }): MergeResult
  /** Phase 137: "Not the same" - this pair is never suggested again (a local list). */
  notSame(input: { aId: string; bId: string }): { ok: true }
  /** Phase 137: undo the newest merge (or the whole newest unify). `undone: 0` when there is nothing to undo. */
  undoLastMerge(): UndoMergeResult
  /** Phase 137: the one-time, idempotent unify of customers whose normalised names are EQUAL. Counts only. */
  unify(): UnifyResult
}

export interface CustomerDeps {
  parties: PartyRepo
  customers: CustomerRepo
  branchId?: () => string | null
  /**
   * Phase 137: the id of a NEW customer called `nameNorm`. Wired to `partyRecordId(orgId, nameNorm)` once the shared notebook is on
   * (Phase 140), so two branches that add the same name produce the same record; random until then.
   */
  newPartyId?: (nameNorm: string) => string
  /** Phase 137: told (inside the transaction) which customer / merge records changed, so the sync outbox can queue them. */
  emit?: (recordIds: readonly string[]) => void
}

const nullIfBlank = (s: string | undefined): string | null => (s === undefined || s.trim() === '' ? null : s.trim())

/** Phase 45 - the Customers page. Reads work on a read-only database; writes are refused there. */
export function createCustomerService(
  { parties, customers, branchId, newPartyId, emit }: CustomerDeps,
  opts: { writable?: boolean; now?: () => Date; newId?: () => string } = {}
): CustomerService {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? randomUUID
  const guard = (): void => {
    if (opts.writable === false) throw new AppError('DB_ERROR', 'Database is read-only (created by a newer version of Quot3)')
  }
  const prepare = (input: CustomerInput): { name: string; nameNorm: string; phone: string | null; address: string | null; transport: string | null } => {
    const name = input.name.replace(/\s+/g, ' ').trim()
    const problem = validateCustomerInput({ ...input, name })
    if (problem) throw new AppError('VALIDATION', problem)
    return { name, nameNorm: normalizePartyName(name), phone: nullIfBlank(input.phone), address: nullIfBlank(input.address), transport: nullIfBlank(input.transport) }
  }
  const audit = (action: string, id: string, detail: Record<string, unknown>): void => {
    customers.audit({ at: now().toISOString(), branchId: branchId?.() ?? null, entity: 'party', entityId: id, action, detailJson: JSON.stringify(detail) })
  }

  const view = (p: DupParty): DuplicateParty => ({ id: p.id, name: p.name, phone: p.phone, address: p.address, transport: p.transport, billCount: p.billCount })
  const dupParties = (): DupParty[] => {
    const stats = aggregateCustomerStats(customers.billStats())
    return parties.listFull().map((p) => ({ id: p.id, name: p.name, phone: p.phone, address: p.address, transport: p.transport, billCount: stats.get(p.id)?.billCount ?? 0, createdAt: p.createdAt }))
  }
  const nullBlank = (v: string): string | null => (v.trim() === '' ? null : v)

  /** One merge inside the caller's transaction. Returns the record ids to emit and the number of bills moved. */
  function mergeOne(survivorId: string, mergedId: string, kind: 'unify' | 'manual', batchId: string, at: string): { ids: string[]; billsMoved: number } {
    if (survivorId === mergedId) throw new AppError('VALIDATION', 'A customer cannot be merged into itself')
    const s = parties.getAny(survivorId)
    const m = parties.getAny(mergedId)
    if (!s || s.deletedAt !== null || !m || m.deletedAt !== null) throw new AppError('NOT_FOUND', 'Customer not found')
    const billIds = parties.billIdsOf(mergedId)
    const filled = fillBlanks({ phone: s.phone, address: s.address, transport: s.transport }, { phone: m.phone, address: m.address, transport: m.transport })
    const changed = filled.phone !== s.phone || filled.address !== s.address || filled.transport !== s.transport
    const recId = mergeRecordId(survivorId, mergedId)
    parties.repoint(billIds, mergedId, survivorId)
    if (changed) parties.setFields(survivorId, { phone: nullBlank(filled.phone), address: nullBlank(filled.address), transport: nullBlank(filled.transport) }, at)
    parties.markMerged(mergedId, survivorId, at)
    parties.logMerge({
      id: recId, survivorId, mergedId, kind, batchId, byBranch: branchId?.() ?? '', at,
      survivorBeforeJson: JSON.stringify({ phone: s.phone, address: s.address, transport: s.transport }), billIdsJson: JSON.stringify(billIds)
    })
    // Order matters: a receiving branch needs both customers before the merge that names them. The survivor's record is always sent (it may never have been).
    return { ids: [survivorId, mergedId, recId], billsMoved: billIds.length }
  }

  return {
    list() {
      const stats = aggregateCustomerStats(customers.billStats())
      return parties.list().map((p) => {
        const s = stats.get(p.id)
        return { ...p, billCount: s?.billCount ?? 0, lastBillDate: s?.lastBillDate ?? '', totalBilled: s?.totalBilled ?? '0.00' }
      })
    },

    create(input) {
      guard()
      const f = prepare(input)
      return parties.transaction(() => {
        if (parties.findByNorm(f.nameNorm)) throw new AppError('VALIDATION', `A customer named "${f.name}" already exists`)
        const id = newPartyId ? newPartyId(f.nameNorm) : newId()
        parties.insert({ id, ...f, at: now().toISOString() }, 'manual')
        emit?.([id])
        return { id }
      })
    },

    update(id, input) {
      guard()
      const f = prepare(input)
      return parties.transaction(() => {
        if (!parties.get(id)) throw new AppError('NOT_FOUND', 'Customer not found')
        if (parties.findByNormExcept(f.nameNorm, id)) throw new AppError('VALIDATION', `Another customer is already named "${f.name}"`)
        if (!parties.update({ id, ...f, at: now().toISOString() })) throw new AppError('NOT_FOUND', 'Customer not found')
        emit?.([id])
        return { id }
      })
    },

    remove(id) {
      guard()
      return parties.transaction(() => {
        const p = parties.get(id)
        if (!p) throw new AppError('NOT_FOUND', 'Customer not found')
        parties.softDelete(id, now().toISOString())
        audit('delete', id, { name: p.name })
        emit?.([id])
        return { id }
      })
    },

    bills({ partyId, cursor, limit }) {
      const size = Math.min(HISTORY_PAGE_MAX, Math.max(1, Math.floor(limit ?? HISTORY_PAGE_SIZE)))
      const decoded = cursor === undefined ? null : decodeCursor(cursor)
      if (cursor !== undefined && decoded === null) throw new AppError('VALIDATION', 'Invalid page cursor')
      const rows = customers.billsOf({ partyId, cursor: decoded, limit: size + 1 })
      const page = rows.slice(0, size)
      const result: CustomerBillsResult = { items: page.map(({ createdAt: _c, ...item }) => item) }
      if (rows.length > size) {
        const last = page[page.length - 1]!
        result.next = encodeCursor({ date: last.billDate, createdAt: last.createdAt, id: last.id })
      }
      return result
    },

    duplicates() {
      const all = dupParties()
      const byId = new Map(all.map((p) => [p.id, p]))
      return findPossibleDuplicates(all, { notSame: new Set(parties.notSamePairs()) }).map((pair) => ({
        ...pair, survivor: view(byId.get(pair.survivorId)!), merged: view(byId.get(pair.mergedId)!)
      }))
    },

    merge({ survivorId, mergedId }) {
      guard()
      return parties.transaction(() => {
        const at = now().toISOString()
        const r = mergeOne(survivorId, mergedId, 'manual', newId(), at)
        audit('merge', survivorId, { mergedId, billsMoved: r.billsMoved })
        emit?.(r.ids)
        return { survivorId, mergedId, billsMoved: r.billsMoved }
      })
    },

    notSame({ aId, bId }) {
      guard()
      if (aId === bId) throw new AppError('VALIDATION', 'Pick two different customers')
      parties.addNotSame(aId, bId, now().toISOString())
      return { ok: true as const }
    },

    undoLastMerge() {
      guard()
      return parties.transaction(() => {
        const batchId = parties.lastBatchId()
        if (batchId === undefined) return { undone: 0, billsMoved: 0 }
        const at = now().toISOString()
        let moved = 0
        const ids: string[] = []
        const rows = parties.batchRows(batchId) // newest first, so the last merge of a chain is undone first
        for (const row of rows) {
          const before = JSON.parse(row.survivorBeforeJson) as { phone: string; address: string; transport: string }
          const billIds = JSON.parse(row.billIdsJson) as string[]
          moved += parties.repoint(billIds, row.survivorId, row.mergedId)
          parties.unmarkMerged(row.mergedId, at)
          if (parties.getAny(row.survivorId)) parties.setFields(row.survivorId, { phone: nullBlank(before.phone), address: nullBlank(before.address), transport: nullBlank(before.transport) }, at)
          parties.markUndone(row.id, at)
          ids.push(row.survivorId, row.mergedId, row.id)
        }
        audit('undo-merge', rows[0]?.survivorId ?? batchId, { merges: rows.length, billsMoved: moved })
        emit?.([...new Set(ids)])
        return { undone: rows.length, billsMoved: moved }
      })
    },

    unify() {
      guard()
      return parties.transaction(() => {
        const plan = planUnify(dupParties())
        if (plan.merges.length === 0) return { groups: 0, merged: 0, billsMoved: 0 }
        const at = now().toISOString()
        const batchId = newId()
        let moved = 0
        const ids = new Set<string>()
        for (const m of plan.merges) {
          const r = mergeOne(m.survivorId, m.mergedId, 'unify', batchId, at)
          moved += r.billsMoved
          for (const i of r.ids) ids.add(i)
        }
        audit('unify', batchId, { groups: plan.groups, merged: plan.merges.length, billsMoved: moved })
        emit?.([...ids])
        return { groups: plan.groups, merged: plan.merges.length, billsMoved: moved }
      })
    }
  }
}
