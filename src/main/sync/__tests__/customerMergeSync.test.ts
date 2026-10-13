import { afterEach, describe, expect, it } from 'vitest'
import { createSim, billInput, U, type Sim, type SimBranchV2 } from './sharedSim'
import { partyRecordId } from '../../../shared/customers/duplicates'

/** Phase 137: customers across branches - same name = one customer, unify converges, merges and their undo travel. Counts and ids only. */
const sims: Sim[] = []
const mk = async (): Promise<Sim> => { const s = await createSim({ parties: true }); sims.push(s); return s }
afterEach(() => sims.splice(0).forEach((s) => s.close()))
const two = (s: Sim): [SimBranchV2, SimBranchV2] => [s.bs[0]!, s.bs[1]!]
const live = (b: SimBranchV2): { id: string; name: string }[] => b.q('SELECT id, name FROM parties WHERE deleted_at IS NULL ORDER BY name_norm, id')
const rawParty = (b: SimBranchV2, id: string, name: string): void => {
  b.sqlite.prepare('INSERT INTO parties (id, name, name_norm, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, name.toLowerCase(), 'manual', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
}
const partyOfBill = (b: SimBranchV2, billId: string): string | null => (b.q<{ p: string | null }>('SELECT party_id AS p FROM bills WHERE id = ?', billId)[0])?.p ?? null

describe('same name = one customer (deterministic record id)', () => {
  it('two branches that both save a bill for the same name end with ONE customer with the same id', async () => {
    const s = await mk(); const [A, B] = two(s)
    A.bills.save(billInput(U('bill-a'), '1', { name: 'Ruby Traders' }))
    B.bills.save(billInput(U('bill-b'), '2', { name: 'RUBY  traders' }))
    const id = partyRecordId(s.orgId, 'ruby traders')
    expect(live(A)).toEqual([{ id, name: 'Ruby Traders' }])
    expect(live(B).map((p) => p.id)).toEqual([id])
    await s.settle()
    expect(live(A)).toHaveLength(1); expect(live(B)).toHaveLength(1)
    expect(live(A)[0]!.id).toBe(id); expect(live(B)[0]!.id).toBe(id)
    expect(partyOfBill(A, U('bill-b'))).toBe(id) // the bill that came from B links to the one customer
    expect(partyOfBill(B, U('bill-a'))).toBe(id)
  })
})

describe('unify and merges across branches', () => {
  it('A unifies a duplicate corpus; B receives the merges and converges to the same survivor; B unify then plans nothing', async () => {
    const s = await mk(); const [A, B] = two(s)
    const ids = new Set<string>()
    for (let i = 0; i < 6; i++) { rawParty(A, U(`a-${i}`), `Gen Co ${i}`); ids.add(U(`a-${i}`)); if (i % 2 === 0) { rawParty(A, U(`b-${i}`), `gen co ${i}`); ids.add(U(`b-${i}`)) } }
    A.bills.save(billInput(U('bill-1'), '1', { name: 'Seed' }))
    A.sqlite.prepare('UPDATE bills SET party_id = ? WHERE id = ?').run(U('b-0'), U('bill-1')) // the younger copy has a bill: it survives
    expect(A.customers.unify()).toEqual({ groups: 3, merged: 3, billsMoved: 0 })
    await A.compare.run() // first sync: every existing customer and merge is listed and uploaded
    await s.settle()
    const liveA = live(A).map((p) => p.id).sort()
    expect(live(B).map((p) => p.id).sort()).toEqual(liveA)
    expect(liveA.filter((id) => ids.has(id))).toHaveLength(6) // 9 copies -> 6 customers, same on both
    expect(B.q<{ mergedInto: string | null }>('SELECT merged_into AS mergedInto FROM parties WHERE id = ?', U('a-0'))[0]!.mergedInto).toBe(U('b-0'))
    expect(B.customers.unify()).toEqual({ groups: 0, merged: 0, billsMoved: 0 })
  })

  it('a manual merge moves the bills on both branches; undo brings the customer and its bills back on both', async () => {
    const s = await mk(); const [A, B] = two(s)
    A.bills.save(billInput(U('bill-k'), '1', { name: 'Ruby Traders' }))
    A.bills.save(billInput(U('bill-g'), '1', { name: 'Ruby Trader' }))
    const keep = partyRecordId(s.orgId, 'ruby traders'); const gone = partyRecordId(s.orgId, 'ruby trader')
    await s.settle()
    expect(partyOfBill(B, U('bill-g'))).toBe(gone)
    A.customers.merge({ survivorId: keep, mergedId: gone })
    await s.settle()
    expect(partyOfBill(B, U('bill-g'))).toBe(keep)
    expect(live(B).map((p) => p.id)).toEqual([keep])
    s.tick(5000)
    A.customers.undoLastMerge()
    await s.settle()
    expect(live(B).map((p) => p.id).sort()).toEqual([keep, gone].sort())
    expect(partyOfBill(B, U('bill-g'))).toBe(gone)
    expect(partyOfBill(B, U('bill-k'))).toBe(keep)
    // replaying everything again changes nothing
    B.sync.remove(['shared.cursor'])
    await B.pull.runOnce()
    expect(live(B).map((p) => p.id).sort()).toEqual([keep, gone].sort())
  })

  it('a bill that arrives naming a customer that was merged meanwhile links to the survivor', async () => {
    const s = await mk(); const [A, B] = two(s)
    A.bills.save(billInput(U('bill-1'), '1', { name: 'Ruby Traders' }))
    A.bills.save(billInput(U('bill-2'), '1', { name: 'Ruby Trader' }))
    const keep = partyRecordId(s.orgId, 'ruby traders'); const gone = partyRecordId(s.orgId, 'ruby trader')
    await s.settle()
    A.customers.merge({ survivorId: keep, mergedId: gone })
    B.bills.save(billInput(U('bill-3'), '1', { name: 'Ruby Trader' })) // B still names the old customer
    await s.settle()
    expect(partyOfBill(A, U('bill-3'))).toBe(keep)
    expect(partyOfBill(B, U('bill-3'))).toBe(keep)
  })
})
