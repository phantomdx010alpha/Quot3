/** Phone bills repo (Phase 176). Ports the DESKTOP RULES of `billService` / `billRepo` / `trashService` / `poCounter`, not their SQL:
 *  - the PO number is taken from the phone's own counter INSIDE the save transaction (all-or-nothing, no gaps, no repeats);
 *  - `po_number` / `po_seq` / `created_at` never change after the first save; every save is revision + 1;
 *  - a small revision history is kept (cap `REVISION_CAP_PER_BILL`, [A] unconfirmed);
 *  - the party snapshot is stored on the bill; the optional `partyId` link is passed in (Phase 177 resolves / creates parties);
 *  - soft delete and restore bump `revision` (a tombstone must supersede the live copy for sync);
 *  - the totals cache and the item row count are rewritten on every save by `serializeBill` (shared calc, decimal strings);
 *  - the round-off flag is stamped from the `calc.roundOff` setting on every save, and totals always read it through `getBillOptions`.
 *  Everything goes through ONE readwrite transaction: no non-IndexedDB `await` happens inside it. Stored rows keep the shared
 *  record shape (`BillRecord` / `BillRowRecord`, camelCase) plus the snake_case index fields of the Phase 175 store. */
import '../../shared/format'
import { deserializeBill, serializeBill, type BillRecord, type BillRowRecord } from '../../shared/billModel'
import { prepareBillForSave, validateBillForSave } from '../../shared/billSave'
import { ROUND_OFF_SETTING_KEY } from '../../shared/calc/billOptions'
import { resolveFormat } from '../../shared/format/registry'
import { formatPoNumber } from '../../shared/po'
import type { Bill, IsoDateTime, PartySnapshot, SyncState } from '../../shared/types'
import { getRecord, reqToPromise, txDone, type PhoneDb, type StoreName } from './db'
import { getSetting } from './settingsRepo'

/** [A] unconfirmed: a small number of revisions per bill on the phone (desktop keeps 50). */
export const REVISION_CAP_PER_BILL = 5

export type BillErrorCode = 'VALIDATION' | 'NO_BRANCH' | 'NOT_FOUND' | 'TRASHED' | 'CONFLICT_REVISION' | 'DAMAGED'
export class BillError extends Error {
  readonly code: BillErrorCode
  constructor(code: BillErrorCode, message: string) {
    super(message)
    this.name = 'BillError'
    this.code = code
  }
}

/** What the editor may send. Everything the phone owns (branch, PO, revision, timestamps, sync state) is absent on purpose. */
export interface SaveBillInput {
  bill: Pick<Bill, 'id' | 'party' | 'formatId' | 'extraCols' | 'paperOverride' | 'billDate' | 'rows'> &
    Partial<Pick<Bill, 'footerExtras' | 'tailRows' | 'hybrid' | 'roundOff'>>
  /** The customer link (Phase 177 resolves it). Ignored (null) for a format whose party is a branch name. */
  partyId?: string | null
  /** When set and different from the stored revision the save is refused (`CONFLICT_REVISION`), as on desktop. */
  expectedRevision?: number
}

export interface SaveBillResult {
  id: string
  poNumber: string
  poSeq: number
  revision: number
  partyId: string | null
  createdAt: string
  updatedAt: string
  roundOff: 0 | 1
  created: boolean
}

/** What a change hook (Phase 179 outbox) is told, synchronously, INSIDE the transaction. */
export interface BillChangeInfo {
  billId: string
  revision: number
  branchId: string
  op: 'save' | 'delete' | 'restore'
  created: boolean
}

export interface BillsOptions {
  now?: () => Date
  newId?: () => string
  /** Newest revisions kept per bill. */
  revisionCap?: number
  /** Called synchronously inside the transaction (it may `put` into other stores of `tx`). A throw aborts the whole change. */
  inTx?: (tx: IDBTransaction, info: BillChangeInfo) => void
  /** Phase 177: finds or creates the customer for the bill's party snapshot INSIDE the save transaction (see `partiesRepo.saveBillWithParty`).
   *  Used only when the input carries no explicit `partyId` and the format has a customer (not a branch name). May `await` IndexedDB requests of `tx` only. */
  resolveParty?: (tx: IDBTransaction, party: PartySnapshot, at: IsoDateTime) => Promise<string | null>
}

/** The sync stores are in the transaction so the `inTx` hook (Phase 179 outbox / record state) commits or rolls back WITH the bill. */
const TX_STORES: StoreName[] = ['meta', 'parties', 'bills', 'bill_rows', 'bill_revisions', 'drafts', 'sync_outbox', 'sync_record_state']

/** Stored shapes: the shared record + the snake_case fields the Phase 175 indexes read. `deleted_at` null is simply not indexed. */
export type StoredBill = BillRecord & { bill_date: string; party_id: string | null; po_number: string; deleted_at: string | null }
export type StoredRow = BillRowRecord & { bill_id: string }

export const toStoredBill = (r: BillRecord): StoredBill => ({ ...r, bill_date: r.billDate, party_id: r.partyId, po_number: r.poNumber, deleted_at: r.deletedAt })
export const toStoredRow = (r: BillRowRecord): StoredRow => ({ ...r, bill_id: r.billId })

interface MetaRow { key: string; value: unknown }

export interface StoredRevision { bill_id: string; revision: number; saved_at: string; saved_by_branch: string; snapshot_json: string }

const defaultNewId = (): string => globalThis.crypto.randomUUID()
export const rowRange = (billId: string): IDBKeyRange => IDBKeyRange.bound([billId, 0], [billId, Number.MAX_SAFE_INTEGER])

/** Runs `fn` in one readwrite transaction. A thrown error aborts it (nothing is written) and is rethrown unchanged. */
async function runTx<T>(db: PhoneDb, fn: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  db.assertWritable()
  const tx = db.idb.transaction(TX_STORES, 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined) // an abort we caused is reported through `fn`'s error, never as an unhandled rejection
  let out: T
  try {
    out = await fn(tx)
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
  await done
  return out
}

async function readBranch(tx: IDBTransaction): Promise<{ id: string; prefix: string; counter: number }> {
  const meta = tx.objectStore('meta')
  const get = async (k: string): Promise<unknown> => ((await reqToPromise(meta.get(k))) as MetaRow | undefined)?.value
  const id = await get('branch_id')
  const prefix = await get('po_prefix')
  const counter = await get('po_counter')
  if (typeof id !== 'string' || id === '' || typeof prefix !== 'string' || prefix === '') {
    throw new BillError('NO_BRANCH', 'Set up this phone’s branch name and PO prefix before saving a bill.')
  }
  return { id, prefix, counter: typeof counter === 'number' && Number.isInteger(counter) && counter >= 0 ? counter : 0 }
}

async function readRows(tx: IDBTransaction, billId: string): Promise<StoredRow[]> {
  return (await reqToPromise(tx.objectStore('bill_rows').index('bill_id_idx').getAll(rowRange(billId)))) as StoredRow[]
}

/** The PO number the next new bill would get (for the editor header). Read-only; may differ if another save lands first. */
export async function peekNextPoNumber(db: PhoneDb): Promise<string | null> {
  const tx = db.idb.transaction('meta', 'readonly')
  try {
    const b = await readBranch(tx)
    return formatPoNumber(b.prefix, b.counter + 1)
  } catch (e) {
    if (e instanceof BillError && e.code === 'NO_BRANCH') return null
    throw e
  }
}

export async function saveBill(db: PhoneDb, input: SaveBillInput, opts: BillsOptions = {}): Promise<SaveBillResult> {
  const now = opts.now ?? (() => new Date())
  const newId = opts.newId ?? defaultNewId
  const cap = Math.max(1, Math.floor(opts.revisionCap ?? REVISION_CAP_PER_BILL))
  const at: IsoDateTime = now().toISOString()
  const b = input.bill
  // The setting is read BEFORE the transaction (a settings read inside it would be harmless but needless). Default ON, only `false` turns it off.
  // Phase 183: an editor that shows the per-bill round-off switch sends the bill's own flag; callers that send none keep the setting rule.
  const roundOff: 0 | 1 = b.roundOff !== undefined ? (b.roundOff === 1 ? 1 : 0) : (await getSetting<unknown>(db, ROUND_OFF_SETTING_KEY, true)) === false ? 0 : 1

  const draft: Bill = {
    id: b.id, branchId: '', poSeq: 0, poNumber: '', partyId: null,
    party: b.party, formatId: b.formatId, extraCols: b.extraCols, paperOverride: b.paperOverride, billDate: b.billDate,
    rows: b.rows, revision: 1, createdAt: at, updatedAt: at, deletedAt: null, syncState: 'local_only', roundOff,
    ...(b.footerExtras ? { footerExtras: b.footerExtras } : {}),
    ...(b.tailRows ? { tailRows: b.tailRows } : {}),
    ...(b.hybrid ? { hybrid: b.hybrid } : {})
  }
  const prepared = prepareBillForSave(draft)
  const issue = validateBillForSave(prepared)
  if (issue) throw new BillError('VALIDATION', issue.message)
  const branchParty = resolveFormat(prepared.formatId).partyMode === 'branch'

  return runTx(db, async (tx) => {
    const bills = tx.objectStore('bills')
    const head = (await reqToPromise(bills.get(prepared.id))) as StoredBill | undefined
    let poSeq: number
    let poNumber: string
    let revision: number
    let createdAt: string
    let branchId: string
    let syncState: SyncState
    if (head) {
      if (head.deletedAt !== null) throw new BillError('TRASHED', 'This bill is in the trash.')
      if (input.expectedRevision !== undefined && input.expectedRevision !== head.revision) {
        throw new BillError('CONFLICT_REVISION', 'This bill was changed since you opened it.')
      }
      poSeq = head.poSeq
      poNumber = head.poNumber
      revision = head.revision + 1
      createdAt = head.createdAt
      branchId = head.branchId
      syncState = head.syncState
    } else {
      const branch = await readBranch(tx)
      poSeq = branch.counter + 1
      poNumber = formatPoNumber(branch.prefix, poSeq)
      tx.objectStore('meta').put({ key: 'po_counter', value: poSeq } satisfies MetaRow)
      revision = 1
      createdAt = at
      branchId = branch.id
      syncState = 'local_only'
    }

    // Customer: a stock transfer has none; an explicit link wins; otherwise the hook (Phase 177) finds / creates it in this same transaction.
    // It runs after the branch check above, so a refused save never leaves a customer behind.
    const partyId: string | null = branchParty ? null : input.partyId !== undefined ? input.partyId : opts.resolveParty ? await opts.resolveParty(tx, prepared.party, at) : null

    const final: Bill = { ...prepared, branchId, poSeq, poNumber, partyId, revision, createdAt, updatedAt: at, syncState }
    const { bill: record, rows } = serializeBill(final)

    // Rows: replace the whole set (a row removed in the editor must disappear).
    const rowStore = tx.objectStore('bill_rows')
    for (const old of await readRows(tx, record.id)) rowStore.delete(old.id)
    for (const r of rows) rowStore.put(toStoredRow(r))
    bills.put(toStoredBill(record))

    // Revision history, count-based (a delete / restore bumps `revision` without a row, as on desktop).
    const revs = tx.objectStore('bill_revisions')
    revs.put({ bill_id: record.id, revision, saved_at: at, saved_by_branch: branchId, snapshot_json: JSON.stringify({ bill: record, rows }) } satisfies StoredRevision)
    const all = (await reqToPromise(revs.getAll(IDBKeyRange.bound([record.id, 0], [record.id, Number.MAX_SAFE_INTEGER])))) as StoredRevision[]
    all.sort((x, y) => y.revision - x.revision)
    for (const old of all.slice(cap)) revs.delete([old.bill_id, old.revision])

    // The open-bill draft is done once the bill is saved (same transaction: no window where both are wrong).
    tx.objectStore('drafts').delete(record.id)

    opts.inTx?.(tx, { billId: record.id, revision, branchId, op: 'save', created: !head })
    return { id: record.id, poNumber, poSeq, revision, partyId, createdAt, updatedAt: at, roundOff: final.roundOff === 1 ? 1 : 0, created: !head }
  })
}

/** A live (not deleted) bill. `NOT_FOUND` for a missing or trashed id; `DAMAGED` when the stored data fails validation. */
export async function getBill(db: PhoneDb, id: string): Promise<Bill> {
  const tx = db.idb.transaction(['bills', 'bill_rows'], 'readonly')
  const head = (await reqToPromise(tx.objectStore('bills').get(id))) as StoredBill | undefined
  if (!head || head.deletedAt !== null) throw new BillError('NOT_FOUND', 'Bill not found.')
  const rows = await readRows(tx, id)
  const parsed = deserializeBill(head, rows)
  if (!parsed.ok) throw new BillError('DAMAGED', `This bill’s stored data is damaged (${parsed.error}).`)
  return parsed.data
}

/** The light list row History / Recently deleted / Dashboard use (no rows are read). */
export interface BillHead {
  id: string
  branchId: string
  poNumber: string
  poSeq: number
  billDate: string
  partyId: string | null
  partyName: string
  formatId: string
  /** Canonical decimal string from the cache, '' when unreadable. */
  grandTotal: string
  itemRowCount: number
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

function toHead(r: StoredBill): BillHead {
  let partyName = ''
  let grandTotal = ''
  try { partyName = String((JSON.parse(r.partySnapshotJson) as { name?: unknown }).name ?? '') } catch { /* damaged snapshot: blank */ }
  try { grandTotal = String((JSON.parse(r.totalsJson) as { grandTotal?: unknown }).grandTotal ?? '') } catch { /* damaged cache: blank */ }
  return {
    id: r.id, branchId: r.branchId, poNumber: r.poNumber, poSeq: r.poSeq, billDate: r.billDate, partyId: r.partyId, partyName, formatId: r.formatId,
    grandTotal, itemRowCount: r.itemRowCount, revision: r.revision, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt
  }
}

/** All live bills (default) or all trashed bills, newest bill date first, then newest PO. */
export async function listBillHeads(db: PhoneDb, o: { trashed?: boolean } = {}): Promise<BillHead[]> {
  const tx = db.idb.transaction('bills', 'readonly')
  const all = (await reqToPromise(tx.objectStore('bills').getAll())) as StoredBill[]
  const wantTrash = o.trashed === true
  return all
    .filter((r) => (r.deletedAt !== null) === wantTrash)
    .map(toHead)
    .sort((a, c) => (a.billDate === c.billDate ? c.poSeq - a.poSeq : a.billDate < c.billDate ? 1 : -1))
}

async function flip(db: PhoneDb, ids: readonly string[], op: 'delete' | 'restore', opts: BillsOptions): Promise<{ changed: string[]; missing: string[] }> {
  const at = (opts.now ?? (() => new Date()))().toISOString()
  const unique = [...new Set(ids)]
  return runTx(db, async (tx) => {
    const bills = tx.objectStore('bills')
    const changed: string[] = []
    const missing: string[] = []
    for (const id of unique) {
      const head = (await reqToPromise(bills.get(id))) as StoredBill | undefined
      const live = head !== undefined && head.deletedAt === null
      if (!head || (op === 'delete' ? !live : live)) { missing.push(id); continue }
      const next: StoredBill = { ...head, deletedAt: op === 'delete' ? at : null, deleted_at: op === 'delete' ? at : null, updatedAt: at, revision: head.revision + 1 }
      bills.put(next)
      changed.push(id)
      opts.inTx?.(tx, { billId: id, revision: next.revision, branchId: head.branchId, op, created: false })
    }
    return { changed, missing }
  })
}

/** Soft delete (move to the trash). A bill that is missing or already trashed is reported in `missing`. */
export async function deleteBills(db: PhoneDb, ids: readonly string[], opts: BillsOptions = {}): Promise<{ deleted: string[]; missing: string[] }> {
  const r = await flip(db, ids, 'delete', opts)
  return { deleted: r.changed, missing: r.missing }
}

/** Brings trashed bills back: `deleted_at` cleared, revision + 1. PO number and content are untouched. */
export async function restoreBills(db: PhoneDb, ids: readonly string[], opts: BillsOptions = {}): Promise<{ restored: string[]; missing: string[] }> {
  const r = await flip(db, ids, 'restore', opts)
  return { restored: r.changed, missing: r.missing }
}

/** Stored revisions of a bill, newest first (raw snapshots; the compare screen is not built on the phone [A]). */
export async function listRevisions(db: PhoneDb, billId: string): Promise<StoredRevision[]> {
  const tx = db.idb.transaction('bill_revisions', 'readonly')
  const all = (await reqToPromise(tx.objectStore('bill_revisions').getAll(IDBKeyRange.bound([billId, 0], [billId, Number.MAX_SAFE_INTEGER])))) as StoredRevision[]
  return all.sort((a, c) => c.revision - a.revision)
}

/** True when a bill with this id exists at all (live or trashed). */
export async function billExists(db: PhoneDb, id: string): Promise<boolean> {
  return (await getRecord<StoredBill>(db, 'bills', id)) !== undefined
}
