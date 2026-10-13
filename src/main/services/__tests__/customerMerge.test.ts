import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createCustomerRepo } from '../../db/customerRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { createCustomerService } from '../customerService'
import { customerHandlers } from '../../ipc/customers'
import { getLocalBranch } from '../../db/seed'
import { mergeRecordId } from '../../../shared/customers/duplicates'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
let clock = Date.UTC(2026, 9, 12, 10, 0, 0)
function mk() {
  const t = openTestDb(); open.push(t)
  const sqlite = t.handle.sqlite
  const parties = createPartyRepo(sqlite)
  const emitted: string[][] = []
  const now = (): Date => new Date((clock += 1000))
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties }, { now, newId: () => `gen-${++n}` })
  const customers = createCustomerService({ parties, customers: createCustomerRepo(sqlite), branchId: () => getLocalBranch(sqlite).id, emit: (ids) => { emitted.push([...ids]) } }, { now, newId: () => `cust-${++n}` })
  /** Inserts a customer straight into the table (a copy with an equal / similar name, as an old database would hold). */
  const raw = (id: string, name: string, f: { phone?: string | null; address?: string | null; at?: string } = {}): void => {
    sqlite.prepare('INSERT INTO parties (id, name, name_norm, phone, address, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, name, name.replace(/\s+/g, ' ').trim().toLowerCase(), f.phone ?? null, f.address ?? null, 'manual', f.at ?? '2026-01-01T00:00:00.000Z', f.at ?? '2026-01-01T00:00:00.000Z')
  }
  const link = (billId: string, partyId: string): void => { sqlite.prepare('UPDATE bills SET party_id = ? WHERE id = ?').run(partyId, billId) }
  const partyOf = (billId: string): string | null => (sqlite.prepare('SELECT party_id AS p FROM bills WHERE id = ?').get(billId) as { p: string | null }).p
  return { t, sqlite, bills, customers, parties, emitted, raw, link, partyOf }
}
const bill = (id: string, party: string): SaveBillInput => ({
  bill: { id, party: { name: party, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-05', rows: [row('Pen', '1', '10'), blankRow(), blankRow(), blankRow()] }
})

describe('customer merge, undo, unify (service on a real database)', () => {
  it('merge: bills move, blanks are filled from the merged one, the survivor keeps its own fields, the merged one leaves the list; records are emitted', () => {
    const { bills, customers, parties, emitted, raw, link, partyOf } = mk()
    bills.save(bill('b1', 'Ruby Traders')); bills.save(bill('b2', 'Ruby Traders'))
    bills.save(bill('b3', 'Ruby Trader'))
    const keep = parties.findByNorm('ruby traders')!.id
    const gone = parties.findByNorm('ruby trader')!.id
    expect(gone).not.toBe(keep)
    raw('x', 'Spare', { phone: '999' })
    link('b3', gone)
    parties.update({ id: keep, name: 'Ruby Traders', nameNorm: 'ruby traders', phone: null, address: '1 Main Rd', transport: null, at: '2026-10-01T00:00:00.000Z' })
    parties.update({ id: gone, name: 'Ruby Trader', nameNorm: 'ruby trader', phone: '98450', address: 'Other Rd', transport: 'VRL', at: '2026-10-01T00:00:00.000Z' })
    const r = customers.merge({ survivorId: keep, mergedId: gone })
    expect(r.billsMoved).toBe(1)
    expect(partyOf('b3')).toBe(keep)
    const k = parties.get(keep)!
    expect(k).toMatchObject({ phone: '98450', address: '1 Main Rd', transport: 'VRL' })
    expect(parties.get(gone)).toBeUndefined()
    expect(parties.getAny(gone)).toMatchObject({ mergedInto: keep })
    expect(customers.list().map((c) => c.name)).not.toContain('Ruby Trader')
    expect(customers.list().find((c) => c.id === keep)!.billCount).toBe(3)
    expect(emitted.at(-1)).toEqual([keep, gone, mergeRecordId(keep, gone)]) // both customers first, the merge that names them last
  })

  it('undo puts the customer, its bills and the survivor fields back, and marks the merge record undone for sync', () => {
    const { bills, customers, parties, emitted, link, partyOf } = mk()
    bills.save(bill('b1', 'Ruby Traders')); bills.save(bill('b3', 'Ruby Trader'))
    const keep = parties.findByNorm('ruby traders')!.id
    const gone = parties.findByNorm('ruby trader')!.id
    parties.update({ id: gone, name: 'Ruby Trader', nameNorm: 'ruby trader', phone: '98450', address: null, transport: null, at: '2026-10-01T00:00:00.000Z' })
    link('b3', gone)
    customers.merge({ survivorId: keep, mergedId: gone })
    expect(parties.get(keep)!.phone).toBe('98450')
    expect(customers.undoLastMerge()).toEqual({ undone: 1, billsMoved: 1 })
    expect(partyOf('b3')).toBe(gone)
    expect(parties.get(gone)).toMatchObject({ name: 'Ruby Trader' })
    expect(parties.get(keep)!.phone).toBe('')
    expect(parties.getMerge(mergeRecordId(keep, gone))!.undoneAt).not.toBeNull()
    expect(emitted.at(-1)).toEqual([keep, gone, mergeRecordId(keep, gone)])
    expect(customers.undoLastMerge()).toEqual({ undone: 0, billsMoved: 0 }) // nothing left to undo
  })

  it('unify on a generated duplicate corpus: one survivor per group (most bills, tie oldest), bills re-pointed, idempotent, one undo for the whole batch', () => {
    const { customers, parties, raw, link, bills, partyOf, sqlite } = mk()
    for (let i = 0; i < 40; i++) { raw(`a${i}`, `Gen Co ${i}`, { at: '2026-01-01T00:00:00.000Z' }); if (i % 2 === 0) raw(`b${i}`, `GEN  CO ${i}`, { at: '2025-06-01T00:00:00.000Z' }) }
    raw('s1', 'Gen Co Spare'); raw('s2', 'Gen Co Spare Ltd')
    // a bill on the younger copy of group 0 makes it the survivor over the older copy (most bills wins)
    bills.save(bill('bx', 'Seed Name'))
    link('bx', 'a0')
    const before = (sqlite.prepare('SELECT count(*) AS c FROM parties WHERE deleted_at IS NULL').get() as { c: number }).c
    const r = customers.unify()
    expect(r).toEqual({ groups: 20, merged: 20, billsMoved: 0 })
    expect(partyOf('bx')).toBe('a0')
    expect(parties.getAny('b0')).toMatchObject({ mergedInto: 'a0' })
    expect(parties.getAny('a2')).toMatchObject({ mergedInto: 'b2' }) // tie on bills: the older copy survives
    expect((sqlite.prepare('SELECT count(*) AS c FROM parties WHERE deleted_at IS NULL').get() as { c: number }).c).toBe(before - 20)
    expect(customers.unify()).toEqual({ groups: 0, merged: 0, billsMoved: 0 })
    // similar names are untouched by the unify
    expect(parties.get('s1')).toBeDefined(); expect(parties.get('s2')).toBeDefined()
    expect(customers.undoLastMerge().undone).toBe(20)
    expect((sqlite.prepare('SELECT count(*) AS c FROM parties WHERE deleted_at IS NULL').get() as { c: number }).c).toBe(before)
  })

  it('possible duplicates lists similar names only; Not the same removes the pair for good; refuses bad merges', () => {
    const { customers, raw } = mk()
    raw('p1', 'Space Garment'); raw('p2', 'Space Garments Ltd'); raw('p3', 'Other Name')
    const d = customers.duplicates()
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ rule: 'same-core', survivor: { billCount: 0 } })
    customers.notSame({ aId: 'p2', bId: 'p1' })
    expect(customers.duplicates()).toEqual([])
    expect(() => customers.merge({ survivorId: 'p1', mergedId: 'p1' })).toThrow(/itself/)
    expect(() => customers.merge({ survivorId: 'p1', mergedId: 'nope' })).toThrow(/not found/i)
  })

  it('create / update / remove tell the sync outbox which record changed; the IPC handlers validate and answer', async () => {
    const { customers, emitted } = mk()
    const { id } = customers.create({ name: 'New Co' })
    customers.update(id, { name: 'New Co', phone: '1' })
    customers.remove(id)
    expect(emitted.map((e) => e[0])).toEqual([id, id, id])
    const h = customerHandlers(customers)
    expect(((await h['customers:duplicates']!({})) as { ok: boolean }).ok).toBe(true)
    expect(((await h['customers:merge']!({ survivorId: '' , mergedId: 'x' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['customers:undoLastMerge']!({})) as { data: { undone: number } }).data.undone).toBe(0)
    expect(((await h['customers:unify']!({})) as { ok: boolean }).ok).toBe(true)
  })
})
