import type { OutboxRepo } from '../db/outboxRepo'
import type { CompareSource } from './compareService'
import { ITEM_RULE_REVISION } from '../../shared/sync/itemRule'
import { OUTBOX_KEEP_SYNCED_DAYS } from '../../shared/sync/outbox'
import type { BillRepo } from '../db/billRepo'
import type { BillRecord, BillRowRecord } from '../../shared/billModel'
import type { ItemRulesRepo } from '../db/itemRulesRepo'
import type { PartyRepo } from '../db/partyRepo'
import { encodeRecord, type EncodedRecord, type RecordKind } from '../../shared/sync/codecV2'
import { correctedEditedAt } from '../../shared/sync/diff'

/**
 * Phase 135: builds the v2 record (`codecV2.encodeRecord`) of a local bill or item rule AT SEND TIME, like the v1 push worker built its
 * snapshot at send time (an outbox row never holds a stale copy). Used by the push worker and by the first-sync compare, so both
 * hash exactly the same thing. Never logs content.
 */
export interface LocalRecordSource {
  /** The FULL record (with the legacy-import tags) - `BillRepo`, not `RemoteApplyRepo.record`. */
  bills: Pick<BillRepo, 'getRecord' | 'getRows'>
  itemRules?: Pick<ItemRulesRepo, 'get'>
  /** Phase 137: customers (any state) and merges, by record id. */
  parties?: Pick<PartyRepo, 'getAny' | 'getMerge'>
}

/** An unreadable time becomes the epoch, so it can only LOSE a conflict (`resolveConflict`), never crash a push. */
const ms = (iso: string): number => { const n = Date.parse(iso); return Number.isNaN(n) ? 0 : n }

export interface EncodeLocalOptions { offsetMs: number | null; appVer: string }

/**
 * `null` = the id is neither a bill nor a rule any more (purged): nothing to send.
 * Ids of bills and item rules never collide (different uuid sources), so the id says which it is.
 */
export function encodeLocalRecord(src: LocalRecordSource, id: string, o: EncodeLocalOptions): EncodedRecord | null {
  const rec = src.bills.getRecord(id) as BillRecord | undefined
  if (rec) {
    const { syncState: _local, ...bill } = rec
    void _local
    const rows = src.bills.getRows(id) as BillRowRecord[]
    return encodeRecord({
      kind: 'bill', recId: id, data: { bill, rows }, deleted: rec.deletedAt !== null,
      editedAt: correctedEditedAt(ms(rec.updatedAt), o.offsetMs), appVer: o.appVer
    })
  }
  const rule = src.itemRules?.get(id)
  if (rule) {
    return encodeRecord({
      kind: 'item_rule', recId: id, data: { rule }, deleted: rule.deletedAt !== null,
      editedAt: correctedEditedAt(ms(rule.updatedAt), o.offsetMs), appVer: o.appVer
    })
  }
  const party = src.parties?.getAny(id)
  if (party) {
    return encodeRecord({
      kind: 'party', recId: id,
      data: {
        party: {
          id: party.id, name: party.name, nameNorm: party.nameNorm, phone: party.phone === '' ? null : party.phone, address: party.address === '' ? null : party.address,
          transport: party.transport === '' ? null : party.transport, createdAt: party.createdAt, updatedAt: party.updatedAt, deletedAt: party.deletedAt, mergedInto: party.mergedInto
        }
      },
      deleted: party.deletedAt !== null, editedAt: correctedEditedAt(ms(party.updatedAt), o.offsetMs), appVer: o.appVer
    })
  }
  const merge = src.parties?.getMerge(id)
  if (merge) {
    const undone = merge.undoneAt !== null
    return encodeRecord({
      kind: 'party_merge', recId: id, data: { merge: { survivorId: merge.survivorId, mergedId: merge.mergedId, by: merge.byBranch === '' ? 'unknown' : merge.byBranch, at: merge.at } },
      deleted: undone, editedAt: correctedEditedAt(ms(merge.undoneAt ?? merge.at), o.offsetMs), appVer: o.appVer
    })
  }
  return null
}

export const kindOfEncoded = (e: EncodedRecord): RecordKind => e.kind

// ------------------------------------------------------------------------------------------------ first-sync compare sources


export interface CompareSourceDeps {
  bills: Pick<BillRepo, 'getRecord' | 'getRows'>
  /** Every local bill head (`RemoteApplyRepo.heads`). */
  heads: () => { id: string; revision: number; deletedAt: string | null }[]
  outbox: Pick<OutboxRepo, 'enqueueMany' | 'transaction'>
  itemRules?: Pick<ItemRulesRepo, 'get' | 'list'>
  /** Phase 137: customers and merges (listed in the compare so existing customers reach the other branches). */
  parties?: Pick<PartyRepo, 'getAny' | 'getMerge' | 'allIds' | 'mergeIds'>
  appVer: string
  now?: () => Date
}

/**
 * The local side of the first-sync compare: bills (live and trashed) and owner item rules, hashed exactly as the push worker will send
 * them, and (Phase 137) customers in any state and customer merges. 
 * "Upload" queues the record in the outbox with `enqueueMany` (the Phase 88 bulk form), so an imported bill needs no special path.
 */
export function createLocalCompareSources(d: CompareSourceDeps): CompareSource[] {
  const now = d.now ?? (() => new Date())
  const stamp = (): { at: string; keep: string } => { const t = now(); return { at: t.toISOString(), keep: new Date(t.getTime() - OUTBOX_KEEP_SYNCED_DAYS * 86_400_000).toISOString() } }
  const src: CompareSource[] = [{
    kind: 'bill',
    list(offsetMs) {
      const out: { recId: string; hash: string }[] = []
      for (const h of d.heads()) {
        try {
          const e = encodeLocalRecord({ bills: d.bills }, h.id, { offsetMs, appVer: d.appVer })
          if (e) out.push({ recId: h.id, hash: e.payloadHash })
        } catch { /* a bill that cannot be encoded is left out of the compare; the push worker blames it when it is queued */ }
      }
      return out
    },
    enqueue(ids) {
      const byId = new Map(d.heads().map((h) => [h.id, h]))
      const items = ids.flatMap((id) => { const h = byId.get(id); return h ? [{ billId: id, op: (h.deletedAt ? 'delete' : 'upsert') as 'delete' | 'upsert', revision: h.revision }] : [] })
      const s = stamp()
      d.outbox.transaction(() => { d.outbox.enqueueMany(items, s.at, s.keep) })
    }
  }]
  if (d.itemRules) {
    const rules = d.itemRules
    src.push({
      kind: 'item_rule',
      list(offsetMs) {
        return rules.list(true).flatMap((r) => {
          try { const e = encodeLocalRecord({ bills: { getRecord: () => undefined, getRows: () => [] }, itemRules: rules }, r.id, { offsetMs, appVer: d.appVer }); return e ? [{ recId: r.id, hash: e.payloadHash }] : [] } catch { return [] }
        })
      },
      enqueue(ids) {
        const items = ids.flatMap((id) => { const r = rules.get(id); return r ? [{ billId: id, op: (r.deletedAt ? 'delete' : 'upsert') as 'delete' | 'upsert', revision: ITEM_RULE_REVISION }] : [] })
        const s = stamp()
        d.outbox.transaction(() => { d.outbox.enqueueMany(items, s.at, s.keep) })
      }
    })
  }
  if (d.parties) {
    const ps = d.parties
    const encodes = (id: string, offsetMs: number | null): { recId: string; hash: string }[] => {
      try { const e = encodeLocalRecord({ bills: { getRecord: () => undefined, getRows: () => [] }, parties: ps }, id, { offsetMs, appVer: d.appVer }); return e ? [{ recId: id, hash: e.payloadHash }] : [] } catch { return [] }
    }
    const queue = (kind: 'party' | 'party_merge', ids: readonly string[]): void => {
      const items = ids.flatMap((id) => {
        if (kind === 'party') { const p = ps.getAny(id); return p ? [{ billId: id, op: (p.deletedAt ? 'delete' : 'upsert') as 'delete' | 'upsert', revision: 0 }] : [] }
        const m = ps.getMerge(id); return m ? [{ billId: id, op: (m.undoneAt ? 'delete' : 'upsert') as 'delete' | 'upsert', revision: 0 }] : []
      })
      const s = stamp()
      d.outbox.transaction(() => { d.outbox.enqueueMany(items, s.at, s.keep) })
    }
    // Customers and merges go FIRST so a bill never reaches another branch before the customer it names.
    src.unshift({ kind: 'party_merge', list: (offsetMs) => ps.mergeIds().flatMap((id) => encodes(id, offsetMs)), enqueue: (ids) => queue('party_merge', ids) })
    src.unshift({ kind: 'party', list: (offsetMs) => ps.allIds().flatMap((id) => encodes(id, offsetMs)), enqueue: (ids) => queue('party', ids) })
  }
  return src
}
