import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBillRepo } from '../../db/billRepo'
import { createCustomerRepo } from '../../db/customerRepo'
import { createPartyRepo } from '../../db/partyRepo'
import { createBillService, type SaveBillInput } from '../billService'
import { createCustomerService } from '../customerService'
import { customerHandlers } from '../../ipc/customers'
import { getLocalBranch } from '../../db/seed'
import { blankRow, row } from '../../../shared/__fixtures__/bills'

const open: TestDb[] = []
afterEach(() => open.splice(0).forEach((t) => t.cleanup()))

let n = 0
function mk(opts: { writable?: boolean } = {}) {
  const t = openTestDb()
  open.push(t)
  const sqlite = t.handle.sqlite
  const parties = createPartyRepo(sqlite)
  const bills = createBillService({ sqlite, bills: createBillRepo(sqlite), parties }, { newId: () => `gen-${++n}` })
  const customers = createCustomerService(
    { parties, customers: createCustomerRepo(sqlite), branchId: () => getLocalBranch(sqlite).id },
    { ...opts, newId: () => `cust-${++n}` }
  )
  return { t, sqlite, bills, customers, parties }
}

const bill = (id: string, party: string, date: string, qty: string, rate: string): SaveBillInput => ({
  bill: {
    id, party: { name: party, phone: '98450 11001', address: '1 Main Rd', transport: 'VRL' }, formatId: 'non_gst', extraCols: [],
    paperOverride: null, billDate: date, rows: [row('Pen', qty, rate), blankRow(), blankRow(), blankRow()]
  }
})

describe('customerService - list / stats', () => {
  it('counts bills, last bill date and total billed per customer; deleted (trashed) bills are excluded', () => {
    const { bills, customers } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))      // 90
    bills.save(bill('b2', 'Ruby Traders', '2026-10-05', '2', '45.50'))   // 91
    bills.save(bill('b3', 'Ruby Traders', '2026-10-07', '1', '1000'))    // 1000, will be trashed
    bills.save(bill('b4', 'Zakers Clothing', '2026-10-02', '3', '10'))   // 30
    bills.delete(['b3'])
    const rows = customers.list()
    expect(rows.map((r) => r.name)).toEqual(['Ruby Traders', 'Zakers Clothing'])
    expect(rows[0]).toMatchObject({ billCount: 2, lastBillDate: '2026-10-05', totalBilled: '181.00' })
    expect(rows[1]).toMatchObject({ billCount: 1, lastBillDate: '2026-10-02', totalBilled: '30.00' })
  })

  it('a customer with no bills lists with zero count, blank date, 0.00', () => {
    const { customers } = mk()
    const { id } = customers.create({ name: 'New Co' })
    expect(customers.list().find((r) => r.id === id)).toMatchObject({ billCount: 0, lastBillDate: '', totalBilled: '0.00' })
  })

  it('restoring a trashed bill brings the count back (live bills only)', () => {
    const { bills, customers, sqlite } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    bills.delete(['b1'])
    expect(customers.list()[0]?.billCount).toBe(0)
    sqlite.prepare('UPDATE bills SET deleted_at = NULL WHERE id = ?').run('b1')
    expect(customers.list()[0]).toMatchObject({ billCount: 1, totalBilled: '90.00' })
  })
})

describe('customerService - create / update / delete', () => {
  it('create tidies the name, stores blanks as cleared and refuses a duplicate name (case / spacing insensitive)', () => {
    const { customers } = mk()
    const { id } = customers.create({ name: '  Ruby   Traders ', phone: ' ', address: ' 1 Main Rd ', transport: 'VRL' })
    expect(customers.list()[0]).toMatchObject({ id, name: 'Ruby Traders', phone: '', address: '1 Main Rd', transport: 'VRL' })
    expect(() => customers.create({ name: 'ruby traders' })).toThrow(/already exists/)
    expect(() => customers.create({ name: '   ' })).toThrow(/needs a name/)
  })

  it('update replaces the fields (blank clears), keeps the id, and refuses another customer\'s name', () => {
    const { customers } = mk()
    const a = customers.create({ name: 'Alpha', phone: '111', address: 'A road' }).id
    customers.create({ name: 'Beta' })
    customers.update(a, { name: 'Alpha Two', phone: '', address: 'New road', transport: 'SRMT' })
    expect(customers.list().find((r) => r.id === a)).toMatchObject({ name: 'Alpha Two', phone: '', address: 'New road', transport: 'SRMT' })
    expect(() => customers.update(a, { name: 'BETA' })).toThrow(/already named/)
    expect(() => customers.update(a, { name: 'Alpha Two' })).not.toThrow() // keeping its own name is fine
    expect(() => customers.update('nope', { name: 'X' })).toThrow(/not found/i)
  })

  it('editing a customer does not touch the snapshot stored in its bills', () => {
    const { bills, customers } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    const id = customers.list()[0]!.id
    customers.update(id, { name: 'Ruby Textiles', phone: '000', address: 'Elsewhere' })
    const b = bills.getForEdit('b1')
    expect(b.party).toMatchObject({ name: 'Ruby Traders', phone: '98450 11001', address: '1 Main Rd' })
    expect(customers.list()[0]).toMatchObject({ name: 'Ruby Textiles', billCount: 1 }) // still linked by id
  })

  it('soft delete hides the customer, keeps its bills (snapshot intact, still in the DB), writes one audit row', () => {
    const { bills, customers, sqlite, parties } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    const id = customers.list()[0]!.id
    customers.remove(id)
    expect(customers.list()).toEqual([])
    expect(parties.list()).toEqual([])
    expect(bills.getForEdit('b1').party.name).toBe('Ruby Traders')
    expect((sqlite.prepare('SELECT count(*) AS c FROM bills WHERE deleted_at IS NULL').get() as { c: number }).c).toBe(1)
    expect((sqlite.prepare("SELECT count(*) AS c FROM audit_log WHERE entity = 'party' AND action = 'delete' AND entity_id = ?").get(id) as { c: number }).c).toBe(1)
    expect(() => customers.remove(id)).toThrow(/not found/i)
  })

  it('a deleted name can be used again (a NEW customer; the old bills stay with the deleted one)', () => {
    const { bills, customers } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    customers.remove(customers.list()[0]!.id)
    const again = customers.create({ name: 'Ruby Traders' }).id
    expect(customers.list().find((r) => r.id === again)).toMatchObject({ billCount: 0 })
  })

  it('a bill saved for a deleted customer\'s name creates a fresh customer', () => {
    const { bills, customers } = mk()
    bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    customers.remove(customers.list()[0]!.id)
    bills.save(bill('b2', 'Ruby Traders', '2026-10-02', '1', '5'))
    expect(customers.list().map((r) => [r.name, r.billCount])).toEqual([['Ruby Traders', 1]])
  })

  it('a read-only database refuses writes but still lists', () => {
    const w = mk()
    w.bills.save(bill('b1', 'Ruby Traders', '2026-10-01', '10', '9'))
    const ro = createCustomerService({ parties: w.parties, customers: createCustomerRepo(w.sqlite) }, { writable: false })
    expect(ro.list()).toHaveLength(1)
    expect(() => ro.create({ name: 'X' })).toThrow(/read-only/)
    expect(() => ro.update('a', { name: 'X' })).toThrow(/read-only/)
    expect(() => ro.remove('a')).toThrow(/read-only/)
  })
})

describe('customerService - bills of a customer', () => {
  it('lists only that customer\'s live bills, newest first, and pages with a cursor', () => {
    const { bills, customers } = mk()
    for (let i = 1; i <= 5; i++) bills.save(bill(`r${i}`, 'Ruby Traders', `2026-10-0${i}`, '1', String(i)))
    bills.save(bill('z1', 'Zakers Clothing', '2026-10-09', '1', '1'))
    bills.delete(['r5'])
    const id = customers.list().find((r) => r.name === 'Ruby Traders')!.id
    const p1 = customers.bills({ partyId: id, limit: 2 })
    expect(p1.items.map((b) => b.id)).toEqual(['r4', 'r3'])
    expect(p1.next).toBeTruthy()
    const p2 = customers.bills({ partyId: id, limit: 2, cursor: p1.next! })
    expect(p2.items.map((b) => b.id)).toEqual(['r2', 'r1'])
    expect(p2.next).toBeUndefined()
    expect(p1.items[0]).toMatchObject({ partyName: 'Ruby Traders', grandTotal: '4.00', poNumber: expect.stringMatching(/^Q3-/) })
    expect(() => customers.bills({ partyId: id, cursor: '!!!' })).toThrow(/cursor/)
    expect(customers.bills({ partyId: 'unknown' }).items).toEqual([])
  })
})

describe('customers IPC handlers', () => {
  it('validate input strictly and return the envelope', async () => {
    const { customers } = mk()
    const h = customerHandlers(customers)
    const made = (await h['customers:create']!({ customer: { name: 'Alpha', phone: '1' } })) as { ok: boolean; data: { id: string } }
    expect(made.ok).toBe(true)
    const list = (await h['customers:list']!({})) as { ok: boolean; data: Array<{ name: string }> }
    expect(list.data.map((r) => r.name)).toEqual(['Alpha'])
    expect(((await h['customers:create']!({ customer: { name: 'Alpha' } })) as { ok: boolean; error: { code: string } }).error.code).toBe('VALIDATION')
    expect(((await h['customers:create']!({ customer: { name: 'B', extra: 1 } })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['customers:list']!({ query: 'x' })) as { ok: boolean }).ok).toBe(false)
    expect(((await h['customers:delete']!({ id: made.data.id })) as { ok: boolean }).ok).toBe(true)
    expect(((await h['customers:delete']!({ id: made.data.id })) as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    expect(((await h['customers:bills']!({ partyId: '' })) as { ok: boolean }).ok).toBe(false)
  })
})
