/** Phone parties repo (Phase 177). Ports the DESKTOP RULES of `partyRepo` / `billService`, not their SQL:
 *  - one customer per EXACT normalised name (`normalizePartyName`, the one shared definition); the record id is deterministic
 *    (`partyRecordId(orgId, nameNorm)`, docs/SYNC_SHARED_STORE_SPEC.md section 9), so two branches that both create the same name
 *    make the SAME record. Until the phone knows its organisation (sync login, Phase 178) a new customer gets a random id, as on desktop;
 *  - a bill save with a new name creates the customer exactly once, INSIDE the bill's own transaction (all-or-nothing);
 *  - a bill save with a known name only links it. Phone / address / transport typed on the bill update the customer, never the name,
 *    and a blank never wipes a saved value (the 0.1.11 desktop rule);
 *  - similar names are NEVER merged (no duplicate / merge tools on the phone; a merge made on the PC arrives through sync, `mergedInto`);
 *  - a deleted or merged customer is not offered; typing its exact name again brings the SAME record back (same deterministic id).
 *  Stored rows keep the shared record shape (`PartyRecord`, camelCase, `null` for blank) plus the snake_case `name_norm` index field. */
import { partyRecordId } from '../../shared/customers/duplicates'
import { normalizePartyName, type PartyLite } from '../../shared/party/partyLite'
import type { PartySnapshot } from '../../shared/types'
import { reqToPromise, type PhoneDb } from './db'
import { listBillHeads, saveBill, type BillsOptions, type SaveBillInput, type SaveBillResult } from './billsRepo'
import { getMetaValue } from './metaRepo'

/** The synced customer record (matches `partyData.party` in `shared/sync/codecV2.ts`; blank text is `null`). */
export interface PartyRecord {
  id: string
  name: string
  nameNorm: string
  phone: string | null
  address: string | null
  transport: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  mergedInto: string | null
}
type StoredParty = PartyRecord & { name_norm: string }

const toStored = (r: PartyRecord): StoredParty => ({ ...r, name_norm: r.nameNorm })
const fromStored = (s: StoredParty): PartyRecord => {
  const { name_norm: _unused, ...rec } = s
  void _unused
  return rec
}
const blank = (s: string): string | null => (s.trim() === '' ? null : s.trim())
const isLive = (r: PartyRecord): boolean => r.deletedAt === null && (r.mergedInto ?? null) === null

/** What a change hook (Phase 179 outbox) is told, synchronously, INSIDE the transaction. */
export interface PartyChangeInfo {
  partyId: string
  op: 'create' | 'update' | 'revive'
}

export interface PartiesOptions {
  now?: () => Date
  /** Random id for a customer made before the organisation is known. */
  newId?: () => string
  /** Overrides the organisation id read from meta (tests / callers that already have it). */
  orgId?: string | null
  /** Called synchronously inside the transaction (it may `put` into other stores of `tx`). A throw aborts the whole change. */
  inTx?: (tx: IDBTransaction, info: PartyChangeInfo) => void
}

const defaultNewId = (): string => globalThis.crypto.randomUUID()

const toLite = (r: PartyRecord): PartyLite => ({ id: r.id, name: r.name, phone: r.phone ?? '', address: r.address ?? '', transport: r.transport ?? '' })
const byNormThenId = (a: PartyRecord, b: PartyRecord): number => (a.nameNorm < b.nameNorm ? -1 : a.nameNorm > b.nameNorm ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The id a NEW customer called `nameNorm` gets: deterministic once the organisation is known, random before. */
export function newPartyIdFor(nameNorm: string, orgId: string | null | undefined, newId: () => string = defaultNewId): string {
  return typeof orgId === 'string' && orgId !== '' ? partyRecordId(orgId, nameNorm) : newId()
}

/**
 * Finds or creates the customer for a bill's party snapshot, inside `tx` (the transaction must include the `parties` store).
 * Returns the customer id, or `null` when the snapshot has no name (nothing to link; the editor refuses a nameless bill anyway).
 */
export async function resolvePartyInTx(
  tx: IDBTransaction, party: PartySnapshot, at: string, o: { orgId: string | null; newId?: () => string; inTx?: PartiesOptions['inTx'] }
): Promise<string | null> {
  const norm = normalizePartyName(party.name)
  if (norm === '') return null
  const store = tx.objectStore('parties')
  const typed = { phone: blank(party.phone), address: blank(party.address), transport: blank(party.transport) }

  const same = ((await reqToPromise(store.index('name_norm').getAll(norm))) as StoredParty[]).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  )
  const found = same.find(isLive)
  if (found) {
    // Known name: link it. Typed values update it, a blank never wipes a saved value, the name never changes.
    const phone = typed.phone ?? found.phone
    const address = typed.address ?? found.address
    const transport = typed.transport ?? found.transport
    if (phone !== found.phone || address !== found.address || transport !== found.transport) {
      store.put({ ...found, phone, address, transport, updatedAt: at })
      o.inTx?.(tx, { partyId: found.id, op: 'update' })
    }
    return found.id
  }

  const id = newPartyIdFor(norm, o.orgId, o.newId)
  const old = (await reqToPromise(store.get(id))) as StoredParty | undefined
  if (old) {
    // Same deterministic id was deleted / merged earlier: the same customer comes back (never a second record for one name).
    const back: PartyRecord = {
      id, name: party.name.trim() === '' ? old.name : party.name.trim(), nameNorm: norm,
      phone: typed.phone ?? old.phone, address: typed.address ?? old.address, transport: typed.transport ?? old.transport,
      createdAt: old.createdAt, updatedAt: at, deletedAt: null, mergedInto: null
    }
    store.put(toStored(back))
    o.inTx?.(tx, { partyId: id, op: 'revive' })
    return id
  }
  const made: PartyRecord = {
    id, name: party.name.trim(), nameNorm: norm, phone: typed.phone, address: typed.address, transport: typed.transport,
    createdAt: at, updatedAt: at, deletedAt: null, mergedInto: null
  }
  store.put(toStored(made))
  o.inTx?.(tx, { partyId: id, op: 'create' })
  return id
}

/**
 * The save the editor uses: the bill AND its customer in ONE transaction (a refused save leaves no customer behind).
 * An explicit `input.partyId` (even `null`) is respected and no customer is made. Stock transfer bills have no customer.
 */
export async function saveBillWithParty(
  db: PhoneDb, input: SaveBillInput, opts: BillsOptions & { parties?: PartiesOptions } = {}
): Promise<SaveBillResult> {
  const p = opts.parties ?? {}
  const orgId = p.orgId !== undefined ? p.orgId : await getMetaValue(db, 'org_id')
  const { parties: _parties, ...billOpts } = opts
  void _parties
  return saveBill(db, input, {
    ...billOpts,
    resolveParty: (tx, party, at) => resolvePartyInTx(tx, party, at, { orgId, newId: p.newId, inTx: p.inTx })
  })
}

export async function getParty(db: PhoneDb, id: string): Promise<PartyRecord | undefined> {
  const tx = db.idb.transaction('parties', 'readonly')
  const r = (await reqToPromise(tx.objectStore('parties').get(id))) as StoredParty | undefined
  return r ? fromStored(r) : undefined
}

/** Every live customer (not deleted, not merged away), `name_norm` then id. */
export async function listPartyRecords(db: PhoneDb): Promise<PartyRecord[]> {
  const tx = db.idb.transaction('parties', 'readonly')
  const all = (await reqToPromise(tx.objectStore('parties').getAll())) as StoredParty[]
  return all.map(fromStored).filter(isLive).sort(byNormThenId)
}

/** The light list the autocomplete reads (blank string = not given). */
export async function listPartyLites(db: PhoneDb): Promise<PartyLite[]> {
  return (await listPartyRecords(db)).map(toLite)
}

/** A row of the Customers list (Phase 185 draws it). */
export interface CustomerRow extends PartyLite {
  /** Live (not trashed) bills linked to this customer. */
  billCount: number
  /** Newest bill date among them (`YYYY-MM-DD`), or null. */
  lastBillDate: string | null
}

/** Customers with live bill counts and last bill date, `name_norm` order. One pass over the bill heads (no rows are read). */
export async function listCustomers(db: PhoneDb): Promise<CustomerRow[]> {
  const [parties, heads] = await Promise.all([listPartyRecords(db), listBillHeads(db)])
  const stats = new Map<string, { count: number; last: string }>()
  for (const h of heads) {
    if (h.partyId === null) continue
    const s = stats.get(h.partyId)
    if (s) { s.count += 1; if (h.billDate > s.last) s.last = h.billDate } else stats.set(h.partyId, { count: 1, last: h.billDate })
  }
  return parties.map((r) => {
    const s = stats.get(r.id)
    return { ...toLite(r), billCount: s?.count ?? 0, lastBillDate: s?.last ?? null }
  })
}
