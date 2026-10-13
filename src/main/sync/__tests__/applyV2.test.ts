import { afterEach, describe, expect, it } from 'vitest'
import { createSim, billInput, U, type Sim, type SimBranchV2 } from './sharedSim'
import { encodeRecord } from '../../../shared/sync/codecV2'
import { serializeBill } from '../../../shared/billModel'
import { asideCountsFrom, asideLine, deriveOverview, NO_ASIDE } from '../../../shared/sync/manager'

/** Phase 136: what a received record needs locally - per kind, delete / restore, the open-bill hold, set-aside records, party links. */
const sims: Sim[] = []
const mk = async (o: Parameters<typeof createSim>[0] = {}): Promise<Sim> => { const s = await createSim(o); sims.push(s); return s }
afterEach(() => sims.splice(0).forEach((s) => s.close()))
const two = (s: Sim): [SimBranchV2, SimBranchV2] => [s.bs[0]!, s.bs[1]!]

const partyRec = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, nameNorm: name.toLowerCase(), phone: null, address: null, transport: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null, ...over
})
/** Puts a customer record on the server as branch `from` would (through the real transport, so the version rules apply). */
async function sendParty(from: SimBranchV2, party: ReturnType<typeof partyRec>, editedAt = party.updatedAt): Promise<void> {
  const e = encodeRecord({ kind: 'party', recId: party.id, data: { party }, deleted: party.deletedAt !== null, editedAt, appVer: '1.0.0' })
  const base = from.records.getState('party', party.id)?.baseVersion ?? 0
  const res = await from.transport.push({ license: 'Q3-ABCD-EFGH-JKLM', branchId: from.id, items: [{ ...e, baseVersion: base }] })
  from.records.putState({ kind: 'party', recId: party.id, baseVersion: res[0]!.version, baseHash: e.payloadHash, serverSeq: res[0]!.serverSeq, syncedAt: null })
}
const partyRow = (b: SimBranchV2, id: string) => b.q<{ name: string; updatedAt: string; deletedAt: string | null; mergedInto: string | null; source: string }>(
  'SELECT name, updated_at AS updatedAt, deleted_at AS deletedAt, merged_into AS mergedInto, source FROM parties WHERE id = ?', id)[0]

describe('customers (party records)', () => {
  it('a received customer is inserted; the same record again and an older one change nothing; a later one replaces it', async () => {
    const s = await mk(); const [A, B] = two(s)
    const id = U('party-1')
    await sendParty(A, partyRec(id, 'Ruby Traders'))
    expect(await B.pull.runOnce()).toMatchObject({ applied: 1, failed: 0, unsupported: 0 })
    expect(partyRow(B, id)).toMatchObject({ name: 'Ruby Traders', source: 'sync' })
    B.sync.remove(['shared.cursor'])
    expect(await B.pull.runOnce()).toMatchObject({ applied: 0, skipped: 1 }) // replay
    await sendParty(A, partyRec(id, 'Ruby Traders Ltd', { updatedAt: '2026-10-02T00:00:00.000Z' }))
    expect(await B.pull.runOnce()).toMatchObject({ applied: 1 })
    expect(partyRow(B, id)!.name).toBe('Ruby Traders Ltd')
    // an older copy arriving later never wins (applier, directly)
    const out = B.applier.current.apply({ kind: 'party', recId: id, version: 9, serverSeq: 99, deleted: false, unknownJson: null, schemaVer: 1, minReaderVer: 1, appVer: '', editedAt: '', payloadHash: 'x',
      data: { party: partyRec(id, 'Old Name', { updatedAt: '2026-09-01T00:00:00.000Z' }) } }, { fromBranch: A.id, offsetMs: null })
    expect(out).toBe('ignored')
    expect(partyRow(B, id)!.name).toBe('Ruby Traders Ltd')
  })

  it('a deleted / merged customer keeps its row with the pointer', async () => {
    const s = await mk(); const [A, B] = two(s)
    await sendParty(A, partyRec(U('p-keep'), 'Keep Co'))
    await sendParty(A, partyRec(U('p-gone'), 'Gone Co', { deletedAt: '2026-10-03T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z', mergedInto: U('p-keep') }))
    await B.pull.runOnce()
    expect(partyRow(B, U('p-gone'))).toMatchObject({ deletedAt: '2026-10-03T00:00:00.000Z', mergedInto: U('p-keep') })
  })

  it('a bill links to the customer by id when that customer is already here, so no second customer is made; the name fallback creates one once', async () => {
    const s = await mk(); const [A, B] = two(s)
    // A's bill carries A's customer id
    A.bills.save(billInput(U('bill-p1'), '1', { name: 'Ruby Traders' }))
    const aParty = A.q<{ id: string }>('SELECT id FROM parties')[0]!.id
    const aPartyRow = A.repo.getParty(aParty)!
    await sendParty(A, partyRec(aParty, aPartyRow.name, { createdAt: aPartyRow.createdAt, updatedAt: aPartyRow.updatedAt }))
    await A.push.runOnce()
    await B.pull.runOnce() // customer first (lower sequence), then the bill
    expect(B.q('SELECT COUNT(*) AS n FROM parties')[0]).toMatchObject({ n: 1 })
    expect(B.q<{ party_id: string }>('SELECT party_id FROM bills')[0]!.party_id).toBe(aParty)
    // replay: still one customer
    B.sync.remove(['shared.cursor']); await B.pull.runOnce()
    expect(B.q('SELECT COUNT(*) AS n FROM parties')[0]).toMatchObject({ n: 1 })

    // no customer record at all: the exact-name fallback creates exactly one, and again on replay
    const s2 = await mk(); const [A2, B2] = two(s2)
    A2.bills.save(billInput(U('bill-p2'), '1', { name: 'Solo Traders' })); A2.bills.save(billInput(U('bill-p3'), '2', { name: 'solo  traders' }))
    await A2.push.runOnce(); await B2.pull.runOnce()
    expect(B2.q('SELECT COUNT(*) AS n FROM parties')[0]).toMatchObject({ n: 1 })
    B2.sync.remove(['shared.cursor']); await B2.pull.runOnce()
    expect(B2.q('SELECT COUNT(*) AS n FROM parties')[0]).toMatchObject({ n: 1 })
  })
})

describe('delete and restore', () => {
  it('a delete arrives as a tombstone; a restore is a new version that brings the bill back', async () => {
    const s = await mk(); const [A, B] = two(s)
    const id = U('dr-1')
    A.bills.save(billInput(id, '5')); await s.settle()
    s.tick(1000); A.bills.delete([id]); await s.settle()
    expect(B.bill(id)!.deletedAt).not.toBeNull()
    s.tick(1000); expect(A.trash.restore([id]).restored).toEqual([id]); await s.settle()
    expect(B.bill(id)!.deletedAt).toBeNull()
    expect(B.rows(id)).toEqual(['Pen:5'])
    expect(s.server.record(s.orgId, 'bill', id)!.version).toBe(3)
    expect(B.pendingCount()).toBe(0)
  })

  it('a bill deleted on the other branch while this one never saw it arrives as a tombstone row (so a later restore has a base)', async () => {
    const s = await mk(); const [A, B] = two(s)
    const id = U('dr-2')
    A.bills.save(billInput(id, '5')); await A.push.runOnce()
    s.tick(1000); A.bills.delete([id]); await A.push.runOnce()
    await B.pull.runOnce()
    expect(B.bill(id)!.deletedAt).not.toBeNull()
  })
})

describe('open-bill hold (banner)', () => {
  async function setup() {
    const s = await mk(); const [A, B] = two(s)
    const id = U('hold-1')
    A.bills.save(billInput(id, '1')); await s.settle()
    B.held.current.setOpenBill(id)
    s.tick(60_000); A.bills.save(billInput(id, '2')); await A.push.runOnce()
    return { s, A, B, id }
  }

  it('a received version of the open bill is held, listed, and applied by itself once the editor moves on', async () => {
    const { B, id } = await setup()
    expect(await B.pull.runOnce()).toMatchObject({ held: 1, applied: 0 })
    expect(B.rows(id)).toEqual(['Pen:1'])
    expect(B.held.current.list()).toEqual([expect.objectContaining({ billId: id, deleted: false })])
    expect(B.held.current.list()[0]!.poNumber).not.toBe('')
    B.held.current.setOpenBill(null)
    expect(await B.pull.runOnce()).toMatchObject({ applied: 1 })
    expect(B.rows(id)).toEqual(['Pen:2'])
    expect(B.held.current.list()).toEqual([])
  })

  it('Load theirs applies it now and tells the editor; Keep mine forgets it and the next save builds on it', async () => {
    const a = await setup()
    let loaded = ''
    const svc = (await import('../heldService')).createHeldService({
      records: a.B.records, sync: a.B.sync, applier: a.B.applier.current, offsetMs: () => null, onLoaded: (b) => { loaded = b }
    })
    await a.B.pull.runOnce()
    expect(svc.resolve(a.id, 'load')).toEqual({ done: true })
    expect(loaded).toBe(a.id)
    expect(a.B.rows(a.id)).toEqual(['Pen:2'])
    expect(a.B.held.current.list()).toEqual([])
    expect(svc.resolve(a.id, 'load')).toEqual({ done: false })

    const k = await setup()
    await k.B.pull.runOnce()
    expect(k.B.held.current.resolve(k.id, 'keep')).toEqual({ done: true })
    expect(k.B.rows(k.id)).toEqual(['Pen:1'])
    expect(k.B.held.current.list()).toEqual([])
    k.B.held.current.setOpenBill(null)
    expect(await k.B.pull.runOnce()).toMatchObject({ applied: 0 }) // not re-applied
    k.s.tick(60_000); k.B.bills.save(billInput(k.id, '7'))
    expect(await k.B.push.runOnce()).toMatchObject({ accepted: 1, lost: 0 }) // built on the version it saw: a plain accept
    await k.s.settle()
    expect(k.A.rows(k.id)).toEqual(['Pen:7'])
  })
})

describe('records a newer app wrote (set aside)', () => {
  async function newerCopy(s: Sim, from: SimBranchV2, id: string) {
    const sb = serializeBill(from.bills.getForEdit(id))
    const { syncState: _s, ...rec } = sb.bill; void _s
    const e = encodeRecord({ kind: 'bill', recId: id, data: { bill: { ...rec, formatId: rec.formatId }, rows: sb.rows.map((r) => ({ ...r, qty: '42' })) }, deleted: false, editedAt: '2026-10-13T00:00:00.000Z', appVer: '9.0.0' })
    s.server.seedRecord(s.orgId, { kind: 'bill', recId: id, version: 2, payload: { ...e.payload, futureField: true }, payloadHash: e.payloadHash, editedAt: e.editedAt, fromBranch: from.id, minReaderVer: 2 })
  }

  it('the local copy is never overwritten, it is counted, and after an update it is applied and the count goes to zero', async () => {
    const s = await mk(); const [A, B] = two(s)
    const id = U('aside-1')
    A.bills.save(billInput(id, '1')); await s.settle()
    await newerCopy(s, A, id)
    const r = await B.pull.runOnce()
    expect(r).toMatchObject({ aside: 1, applied: 0 })
    expect(B.rows(id)).toEqual(['Pen:1'])
    expect(B.aside.countsByKind()).toEqual({ bill: 1 })
    expect(asideLine(asideCountsFrom(B.aside.countsByKind()))).toBe('Update the app to see 1 bill.')
    // something readable for the same record cannot overwrite it either
    const out = B.applier.current.apply({ kind: 'bill', recId: id, version: 3, serverSeq: 50, deleted: false, unknownJson: null, schemaVer: 1, minReaderVer: 1, appVer: '', editedAt: '', payloadHash: 'zz',
      data: { bill: { ...(B.billRepo.getRecord(id) as object), updatedAt: '2030-01-01T00:00:00.000Z' }, rows: B.billRepo.getRows(id) } } as never, { fromBranch: A.id, offsetMs: null })
    expect(out).toBe('ignored')
    expect(B.rows(id)).toEqual(['Pen:1'])
    // the app is updated: the reader version rises
    B.setReaderVer(2)
    expect(B.aside.retryAside()).toMatchObject({ applied: 1, stillAside: 0, failed: 0 })
    expect(B.rows(id)).toEqual(['Pen:42'])
    expect(B.aside.count()).toBe(0)
    expect(B.records.getState('bill', id)).toMatchObject({ baseVersion: 2 })
  })

  it('a new bill from a newer app is not created, only counted', async () => {
    const s = await mk(); const [A, B] = two(s)
    const id = U('aside-2'); A.bills.save(billInput(id, '1')); await newerCopy(s, A, id)
    A.sqlite.exec('DELETE FROM sync_outbox')
    expect(await B.pull.runOnce()).toMatchObject({ aside: 1, applied: 0 })
    expect(B.q('SELECT 1 FROM bills WHERE id = ?', id)).toHaveLength(0)
    expect(B.aside.count()).toBe(1)
  })
})

describe('the status overview says what is set aside', () => {
  const base = { activated: true, enabled: true, readOnly: false, push: null, pull: null, counts: { pending: 0, failed: 0, synced: 0 }, oldestPendingAt: null, conflicts: 0 }
  it('counts per kind, the sentence, and nothing when nothing is aside', () => {
    expect(asideCountsFrom({ bill: 12, party: 2, item_rule: 1, weird: 3 })).toEqual({ bills: 12, customers: 2, rules: 1, total: 18 })
    expect(asideCountsFrom({})).toEqual(NO_ASIDE)
    expect(asideLine({ bills: 12, customers: 0, rules: 0, total: 12 })).toBe('Update the app to see 12 bills.')
    expect(asideLine({ bills: 0, customers: 2, rules: 0, total: 2 })).toBe('Update the app to see 2 changes from other branches.')
    expect(asideLine(NO_ASIDE)).toBe('')
    const o = deriveOverview({ ...base, aside: { bills: 3, customers: 0, rules: 0, total: 3 } })
    expect(o.asideLine).toBe('Update the app to see 3 bills.')
    expect(o.aside.bills).toBe(3)
    expect(o.errors).toContain('Update the app to see 3 bills.')
    expect(deriveOverview(base)).toMatchObject({ asideLine: '', aside: NO_ASIDE })
  })
})
