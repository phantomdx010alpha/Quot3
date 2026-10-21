/** Phone customers: add and edit (Phase 185). Rules ported from the desktop party rules, not its SQL:
 *  - one customer per EXACT normalised name; adding a name that is already used is refused (`DUPLICATE`), never merged or overwritten;
 *  - the name is NOT editable (a changed name would change the deterministic record id, docs/SYNC_SHARED_STORE_SPEC.md section 9);
 *    phone, address and transport are, and an explicit edit CAN clear a value (unlike a bill save, which never wipes);
 *  - every change is queued for sync INSIDE its own transaction (callers spread `withOutbox().parties` into `opts.parties`);
 *  - a customer that was deleted or merged on the PC comes back under the same id when its exact name is added again (shared `resolvePartyInTx`). */
import { normalizePartyName } from '../../shared/party/partyLite'
import { listBillHeads, type BillHead } from './billsRepo'
import { reqToPromise, txDone, type PhoneDb } from './db'
import { getMetaValue } from './metaRepo'
import { resolvePartyInTx, type PartiesOptions, type PartyRecord } from './partiesRepo'

export type CustomerErrorCode = 'VALIDATION' | 'DUPLICATE' | 'NOT_FOUND'
export class CustomerError extends Error {
  constructor(readonly code: CustomerErrorCode, message: string) {
    super(message)
    this.name = 'CustomerError'
  }
}

export const CUSTOMER_LIMITS = { name: 120, phone: 40, address: 400, transport: 120 } as const

export interface CustomerInput {
  name: string
  phone: string
  address: string
  transport: string
}
export type CustomerEdit = Omit<CustomerInput, 'name'>

export interface CustomerWriteOptions {
  now?: () => Date
  parties?: PartiesOptions
}

type StoredParty = PartyRecord & { name_norm: string }
const blank = (s: string): string | null => (s.trim() === '' ? null : s.trim())
const isLive = (r: PartyRecord): boolean => r.deletedAt === null && (r.mergedInto ?? null) === null

function tooLong(i: Partial<CustomerInput>): string | null {
  for (const k of ['name', 'phone', 'address', 'transport'] as const) {
    const v = i[k]
    if (typeof v === 'string' && v.trim().length > CUSTOMER_LIMITS[k]) return `${k[0]!.toUpperCase()}${k.slice(1)} is too long (up to ${CUSTOMER_LIMITS[k]} characters).`
  }
  return null
}

/** Adds one customer. Throws `CustomerError`. Returns the stored record. */
export async function addCustomer(db: PhoneDb, input: CustomerInput, opts: CustomerWriteOptions = {}): Promise<PartyRecord> {
  db.assertWritable()
  const norm = normalizePartyName(input.name)
  if (norm === '') throw new CustomerError('VALIDATION', 'Enter the customer’s name.')
  const long = tooLong(input)
  if (long) throw new CustomerError('VALIDATION', long)
  const at = (opts.now ?? (() => new Date()))().toISOString()
  const p = opts.parties ?? {}
  const orgId = p.orgId !== undefined ? p.orgId : await getMetaValue(db, 'org_id')

  const tx = db.idb.transaction(['parties', 'sync_outbox'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  let id: string | null
  try {
    const same = (await reqToPromise(tx.objectStore('parties').index('name_norm').getAll(norm))) as StoredParty[]
    if (same.some(isLive)) throw new CustomerError('DUPLICATE', 'A customer with this name already exists.')
    id = await resolvePartyInTx(tx, { name: input.name, phone: input.phone, address: input.address, transport: input.transport }, at, { orgId, newId: p.newId, inTx: p.inTx })
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
  await done
  const got = id === null ? undefined : await getOne(db, id)
  if (!got) throw new CustomerError('NOT_FOUND', 'The customer could not be saved.')
  return got
}

async function getOne(db: PhoneDb, id: string): Promise<PartyRecord | undefined> {
  const tx = db.idb.transaction('parties', 'readonly')
  const r = (await reqToPromise(tx.objectStore('parties').get(id))) as StoredParty | undefined
  if (!r) return undefined
  const { name_norm: _n, ...rec } = r
  void _n
  return rec
}

/** Changes phone / address / transport of a live customer (blank clears). Nothing is written, queued or re-dated when nothing changed. */
export async function editCustomer(db: PhoneDb, id: string, edit: CustomerEdit, opts: CustomerWriteOptions = {}): Promise<PartyRecord> {
  db.assertWritable()
  const long = tooLong(edit)
  if (long) throw new CustomerError('VALIDATION', long)
  const at = (opts.now ?? (() => new Date()))().toISOString()
  const tx = db.idb.transaction(['parties', 'sync_outbox'], 'readwrite')
  const done = txDone(tx)
  done.catch(() => undefined)
  try {
    const store = tx.objectStore('parties')
    const cur = (await reqToPromise(store.get(id))) as StoredParty | undefined
    if (!cur || !isLive(cur)) throw new CustomerError('NOT_FOUND', 'This customer no longer exists.')
    const next = { phone: blank(edit.phone), address: blank(edit.address), transport: blank(edit.transport) }
    if (next.phone !== cur.phone || next.address !== cur.address || next.transport !== cur.transport) {
      store.put({ ...cur, ...next, updatedAt: at })
      opts.parties?.inTx?.(tx, { partyId: id, op: 'update' })
    }
  } catch (e) {
    try { tx.abort() } catch { /* already finished */ }
    await done.catch(() => undefined)
    throw e
  }
  await done
  const got = await getOne(db, id)
  if (!got) throw new CustomerError('NOT_FOUND', 'This customer no longer exists.')
  return got
}

/** Live (not trashed) bills of one customer, newest first. */
export async function listCustomerBills(db: PhoneDb, partyId: string): Promise<BillHead[]> {
  return (await listBillHeads(db)).filter((h) => h.partyId === partyId)
}
