import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import '../../shared/format'
import { createEmptyBill } from '../../shared/billModel'
import { partyRecordId } from '../../shared/customers/duplicates'
import { normalizePartyName } from '../../shared/party/partyLite'
import { row } from '../../shared/__fixtures__/bills'
import { openPhoneDb, putRecord, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { BillError, deleteBills, listBillHeads, restoreBills, saveBill, type SaveBillInput } from '../data/billsRepo'
import {
  getParty, listCustomers, listPartyLites, listPartyRecords, newPartyIdFor, saveBillWithParty, type PartyChangeInfo, type PartyRecord
} from '../data/partiesRepo'
import { createPartyDirectory, loadPartyDirectory, refreshPartyInDirectory } from '../data/partySearch'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

const ORG = '11111111-2222-4333-8444-555555555555'
const T0 = new Date('2026-10-21T10:00:00.000Z')
let tick = 0
const clock = () => new Date(T0.getTime() + 1000 * tick++)

async function freshDb(o: { branch?: boolean; org?: string | null } = {}): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  if (o.branch !== false) {
    await setMetaValue(db, 'branch_id', 'branch-phone')
    await setMetaValue(db, 'po_prefix', 'PH-')
  }
  if (o.org !== null) await setMetaValue(db, 'org_id', o.org ?? ORG)
  return db
}

let n = 0
function input(over: { name?: string; phone?: string; address?: string; transport?: string; formatId?: string; date?: string; partyId?: string | null } = {}): SaveBillInput {
  const b = createEmptyBill({ branchId: 'x', formatId: over.formatId ?? 'non_gst', billDate: over.date ?? '2026-10-21', newId: () => `id-${++n}` })
  return {
    bill: {
      id: `bill-${++n}`,
      party: { name: over.name ?? 'Test Party', phone: over.phone ?? '', address: over.address ?? '', transport: over.transport ?? '' },
      formatId: b.formatId, extraCols: [], paperOverride: null, billDate: b.billDate, rows: [row('widget', '2', '50')]
    },
    ...(over.partyId !== undefined ? { partyId: over.partyId } : {})
  }
}
const save = (db: PhoneDb, inp: SaveBillInput, extra: Parameters<typeof saveBillWithParty>[2] = {}) => saveBillWithParty(db, inp, { now: clock, ...extra })

describe('Phase 177: customer ids', () => {
  it('the same normalised name always gives the same id (case, spacing, NFC)', () => {
    const a = newPartyIdFor(normalizePartyName('Space  Garments'), ORG)
    const b = newPartyIdFor(normalizePartyName('  space garments '), ORG)
    const c = newPartyIdFor(normalizePartyName('SPACE GARMENTS'), ORG)
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(a).toBe(partyRecordId(ORG, 'space garments'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(normalizePartyName('Caf\u0065\u0301')).toBe(normalizePartyName('Caf\u00e9'))
  })
  it('different names or different organisations give different ids', () => {
    expect(newPartyIdFor('space garments', ORG)).not.toBe(newPartyIdFor('space garment', ORG))
    expect(newPartyIdFor('space garments', ORG)).not.toBe(newPartyIdFor('space garments', 'aaaaaaaa-2222-4333-8444-555555555555'))
  })
  it('before the organisation is known the id is random (the injected generator)', () => {
    let i = 0
    expect(newPartyIdFor('x', null, () => `rand-${++i}`)).toBe('rand-1')
    expect(newPartyIdFor('x', '', () => `rand-${++i}`)).toBe('rand-2')
  })
})

describe('Phase 177: auto-create on save', () => {
  it('a new name creates ONE customer with the deterministic id and links the bill to it', async () => {
    const db = await freshDb()
    const r1 = await save(db, input({ name: 'Space  Garments', phone: '98450 11111', address: 'Mill Road', transport: 'VRL' }))
    const r2 = await save(db, input({ name: 'SPACE GARMENTS' }))
    expect(r1.partyId).toBe(partyRecordId(ORG, 'space garments'))
    expect(r2.partyId).toBe(r1.partyId)
    const all = await listPartyRecords(db)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: r1.partyId, name: 'Space  Garments', nameNorm: 'space garments', phone: '98450 11111', address: 'Mill Road', transport: 'VRL',
      deletedAt: null, mergedInto: null
    })
    const heads = await listBillHeads(db)
    expect(heads.map((h) => h.partyId)).toEqual([r1.partyId, r1.partyId])
  })

  it('blank typed values become null on a new customer', async () => {
    const db = await freshDb()
    const r = await save(db, input({ name: 'Plain Co' }))
    expect(await getParty(db, r.partyId!)).toMatchObject({ phone: null, address: null, transport: null })
  })

  it('a known name only links: name unchanged, typed values update, a blank never wipes', async () => {
    const db = await freshDb()
    const r1 = await save(db, input({ name: 'Acme Traders', phone: '111', address: 'A1', transport: 'T1' }))
    await save(db, input({ name: 'acme  traders', phone: '', address: '', transport: '' }))
    expect(await getParty(db, r1.partyId!)).toMatchObject({ name: 'Acme Traders', phone: '111', address: 'A1', transport: 'T1' })
    await save(db, input({ name: 'ACME TRADERS', phone: '222', transport: 'T2' }))
    expect(await getParty(db, r1.partyId!)).toMatchObject({ name: 'Acme Traders', phone: '222', address: 'A1', transport: 'T2' })
    expect(await listPartyRecords(db)).toHaveLength(1)
  })

  it('similar (not equal) names are two customers: never merged', async () => {
    const db = await freshDb()
    await save(db, input({ name: 'Space Garment' }))
    await save(db, input({ name: 'Space Garments Ltd' }))
    await save(db, input({ name: 'Space Garments' }))
    expect(await listPartyRecords(db)).toHaveLength(3)
  })

  it('before the organisation is known a new customer gets a random id and is still found by name', async () => {
    const db = await freshDb({ org: null })
    let i = 0
    const parties = { newId: () => `rand-${++i}` }
    const r1 = await save(db, input({ name: 'No Org Co' }), { parties })
    const r2 = await save(db, input({ name: 'no org co' }), { parties })
    expect(r1.partyId).toBe('rand-1')
    expect(r2.partyId).toBe('rand-1')
    expect(await listPartyRecords(db)).toHaveLength(1)
  })

  it('an explicit partyId (even null) is respected and creates nothing', async () => {
    const db = await freshDb()
    const a = await save(db, input({ name: 'Linked Co', partyId: 'party-x' }))
    const b = await save(db, input({ name: 'Unlinked Co', partyId: null }))
    expect(a.partyId).toBe('party-x')
    expect(b.partyId).toBeNull()
    expect(await listPartyRecords(db)).toHaveLength(0)
  })

  it('a stock transfer (the party is a branch name) never creates or links a customer', async () => {
    const db = await freshDb()
    const r = await save(db, input({ name: 'Main Branch', formatId: 'stock_transfer' }))
    expect(r.partyId).toBeNull()
    expect(await listPartyRecords(db)).toHaveLength(0)
  })

  it('a refused save (no branch yet) leaves no customer behind; a plain saveBill never makes one', async () => {
    const db = await freshDb({ branch: false })
    await expect(save(db, input({ name: 'Ghost Co' }))).rejects.toMatchObject({ code: 'NO_BRANCH' })
    expect(await listPartyRecords(db)).toHaveLength(0)
    await expect(save(db, input({ name: '   ' }))).rejects.toBeInstanceOf(BillError)
    expect(await listPartyRecords(db)).toHaveLength(0)

    const db2 = await freshDb()
    const r = await saveBill(db2, input({ name: 'Plain Save Co' }), { now: clock })
    expect(r.partyId).toBeNull()
    expect(await listPartyRecords(db2)).toHaveLength(0)
  })

  it('editing a saved bill with a changed party name links the other customer (the old one stays)', async () => {
    const db = await freshDb()
    const first = input({ name: 'Old Name Co' })
    await save(db, first)
    const edit: SaveBillInput = { ...first, bill: { ...first.bill, party: { ...first.bill.party, name: 'New Name Co' } } }
    const r = await save(db, edit)
    expect(r.partyId).toBe(partyRecordId(ORG, 'new name co'))
    expect((await listPartyRecords(db)).map((p) => p.nameNorm)).toEqual(['new name co', 'old name co'])
  })

  it('tells the change hook what happened, inside the transaction (create / update / nothing)', async () => {
    const db = await freshDb()
    const seen: PartyChangeInfo[] = []
    const parties = { inTx: (_tx: IDBTransaction, info: PartyChangeInfo) => { seen.push(info) } }
    const r = await save(db, input({ name: 'Hook Co', phone: '1' }), { parties })
    await save(db, input({ name: 'Hook Co', phone: '1' }), { parties }) // same values: no change
    await save(db, input({ name: 'Hook Co', phone: '2' }), { parties })
    expect(seen).toEqual([{ partyId: r.partyId, op: 'create' }, { partyId: r.partyId, op: 'update' }])
  })

  it('a hook that throws aborts the bill too (all-or-nothing)', async () => {
    const db = await freshDb()
    const inp = input({ name: 'Atomic Co' })
    await expect(save(db, inp, { parties: { inTx: () => { throw new Error('boom') } } })).rejects.toThrow('boom')
    expect(await listPartyRecords(db)).toHaveLength(0)
    expect(await listBillHeads(db)).toHaveLength(0)
    const ok = await save(db, inp) // the PO counter was not consumed by the failed save
    expect(ok.poNumber).toBe('PH-0001')
  })
})

describe('Phase 177: deleted and merged customers', () => {
  const rec = (over: Partial<PartyRecord> & { id: string; name: string }): PartyRecord & { name_norm: string } => {
    const nameNorm = normalizePartyName(over.name)
    return { nameNorm, phone: null, address: null, transport: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, mergedInto: null, ...over, name_norm: nameNorm }
  }

  it('a deleted or merged-away customer is not listed or offered', async () => {
    const db = await freshDb()
    await putRecord(db, 'parties', rec({ id: 'p-live', name: 'Live Co' }))
    await putRecord(db, 'parties', rec({ id: 'p-del', name: 'Deleted Co', deletedAt: '2026-02-01T00:00:00.000Z' }))
    await putRecord(db, 'parties', rec({ id: 'p-mrg', name: 'Merged Co', mergedInto: 'p-live', deletedAt: '2026-02-01T00:00:00.000Z' }))
    expect((await listPartyLites(db)).map((p) => p.id)).toEqual(['p-live'])
    expect((await loadPartyDirectory(db)).size()).toBe(1)
  })

  it('typing the exact name of a deleted customer brings the SAME record back (no second record)', async () => {
    const db = await freshDb()
    const id = partyRecordId(ORG, 'old customer')
    await putRecord(db, 'parties', rec({ id, name: 'Old Customer', phone: '555', deletedAt: '2026-02-01T00:00:00.000Z' }))
    const seen: PartyChangeInfo[] = []
    const r = await save(db, input({ name: 'old customer', address: 'New Road' }), { parties: { inTx: (_t, i) => { seen.push(i) } } })
    expect(r.partyId).toBe(id)
    const all = await listPartyRecords(db)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id, name: 'old customer', phone: '555', address: 'New Road', deletedAt: null, mergedInto: null, createdAt: '2026-01-01T00:00:00.000Z' })
    expect(seen).toEqual([{ partyId: id, op: 'revive' }])
  })

  it('with two live customers of the same normalised name (from sync) the OLDEST wins, so every save links the same one', async () => {
    const db = await freshDb()
    await putRecord(db, 'parties', rec({ id: 'p-b', name: 'Twin Co', createdAt: '2026-03-01T00:00:00.000Z' }))
    await putRecord(db, 'parties', rec({ id: 'p-a', name: 'Twin Co', createdAt: '2026-02-01T00:00:00.000Z' }))
    expect((await save(db, input({ name: 'Twin Co' }))).partyId).toBe('p-a')
  })
})

describe('Phase 177: customers list data', () => {
  it('bill counts and last bill date match the bills; trashed bills do not count and come back on restore', async () => {
    const db = await freshDb()
    const a1 = await save(db, input({ name: 'Alpha Co', date: '2026-10-01' }))
    await save(db, input({ name: 'Alpha Co', date: '2026-10-15' }))
    const a3 = await save(db, input({ name: 'Alpha Co', date: '2026-10-20' }))
    await save(db, input({ name: 'Beta Co', date: '2026-09-05' }))
    await save(db, input({ name: 'Gamma Co (no bills yet)', partyId: null }))
    await save(db, input({ name: 'Stock', formatId: 'stock_transfer' }))

    let rows = await listCustomers(db)
    expect(rows.map((r) => [r.name, r.billCount, r.lastBillDate])).toEqual([
      ['Alpha Co', 3, '2026-10-20'],
      ['Beta Co', 1, '2026-09-05']
    ])
    const heads = await listBillHeads(db)
    expect(rows.reduce((s, r) => s + r.billCount, 0)).toBe(heads.filter((h) => h.partyId !== null).length)

    await deleteBills(db, [a3.id])
    rows = await listCustomers(db)
    expect(rows[0]).toMatchObject({ name: 'Alpha Co', billCount: 2, lastBillDate: '2026-10-15' })
    await restoreBills(db, [a3.id])
    expect((await listCustomers(db))[0]).toMatchObject({ billCount: 3, lastBillDate: '2026-10-20' })
    void a1
  })

  it('a customer with no bills is listed with count 0 and no date; blank fields come back as empty strings', async () => {
    const db = await freshDb()
    const r = await save(db, input({ name: 'Solo Co', phone: '9', date: '2026-10-02' }))
    await deleteBills(db, [r.id])
    expect(await listCustomers(db)).toEqual([{ id: r.partyId, name: 'Solo Co', phone: '9', address: '', transport: '', billCount: 0, lastBillDate: null }])
  })
})

describe('Phase 177: autocomplete (shared Fuse ranking)', () => {
  const fixtures = [
    { id: 'p1', name: 'Space Garments', phone: '9845011111', address: '', transport: '' },
    { id: 'p2', name: 'Space Garments Ltd', phone: '', address: '', transport: '' },
    { id: 'p3', name: 'Outer Space Traders', phone: '', address: '', transport: '' },
    { id: 'p4', name: 'Spacer Fabrics', phone: '9845022222', address: '', transport: '' },
    { id: 'p5', name: 'Rainbow Textiles', phone: '', address: '', transport: '' },
    { id: 'p6', name: 'Rainbow Textile House', phone: '', address: '', transport: '' }
  ]

  it('ranks exact, then name prefix, then a word prefix', () => {
    const d = createPartyDirectory(fixtures)
    expect(d.search('space garments').map((p) => p.id)).toEqual(['p1', 'p2'])
    const ids = d.search('space').map((p) => p.id)
    expect(ids[0]).toBe('p1') // shortest prefix match (best Fuse score) first
    expect(ids.slice(0, 3).sort()).toEqual(['p1', 'p2', 'p4']) // all three name-prefix matches come first (tier 1) ...
    expect(ids).toContain('p3') // ... then "Outer Space Traders": a word starts with the query (tier 2)
    expect(ids.indexOf('p3')).toBe(3)
    expect(d.search('RAINBOW  textile').map((p) => p.id).sort()).toEqual(['p5', 'p6'])
    expect(d.search('rainbow textiles')[0]?.id).toBe('p5')
  })

  it('matches a small typo, honours the limit, ignores blanks', () => {
    const d = createPartyDirectory(fixtures)
    expect(d.search('rainbw textiles')[0]?.id).toBe('p5')
    expect(d.search('space', 2)).toHaveLength(2)
    expect(d.search('   ')).toEqual([])
    expect(d.search('zzzzqq')).toEqual([])
  })

  it('a phone query matches by digits (3 or more), best prefix first', () => {
    const d = createPartyDirectory(fixtures)
    expect(d.search('98450').map((p) => p.id)).toEqual(['p1', 'p4'])
    expect(d.search('+91 98450 22222')).toEqual([])
    expect(d.search('9845 022').map((p) => p.id)).toEqual(['p4'])
    expect(d.search('98')).toEqual([])
  })

  it('find / isNew use the normalised name; upsert and remove change the next search; all() is stable until a change', () => {
    const d = createPartyDirectory(fixtures)
    expect(d.find('  SPACE   garments ')?.id).toBe('p1')
    expect(d.isNew('space garments')).toBe(false)
    expect(d.isNew('Space Garment')).toBe(true)
    expect(d.isNew('   ')).toBe(false)
    const l1 = d.all()
    expect(d.all()).toBe(l1)
    d.upsert({ id: 'p7', name: 'Space Garment', phone: '', address: '', transport: '' })
    expect(d.all()).not.toBe(l1)
    expect(d.size()).toBe(7)
    expect(d.search('space garment')[0]?.id).toBe('p7')
    d.remove('p7')
    d.remove('nope')
    expect(d.size()).toBe(6)
    expect(d.isNew('Space Garment')).toBe(true)
  })

  it('loads from the database and refreshes one customer after a save', async () => {
    const db = await freshDb()
    const dir = await loadPartyDirectory(db)
    expect(dir.size()).toBe(0)
    const r = await save(db, input({ name: 'Fresh Co', phone: '777' }))
    expect(dir.isNew('Fresh Co')).toBe(true) // not refreshed yet
    await refreshPartyInDirectory(db, dir, r.partyId!)
    expect(dir.find('fresh co')).toMatchObject({ id: r.partyId, phone: '777' })
    expect(dir.search('fre')[0]?.id).toBe(r.partyId)
    await putRecord(db, 'parties', { ...(await getParty(db, r.partyId!))!, name_norm: 'fresh co', deletedAt: '2026-10-22T00:00:00.000Z' })
    await refreshPartyInDirectory(db, dir, r.partyId!)
    expect(dir.size()).toBe(0)
  })
})

describe('Phase 177: speed at the owner\'s customer count (synthetic names; counts only)', () => {
  it('builds and searches a 12,900-customer directory (timings are logged for the phase log)', () => {
    const words = ['space', 'rainbow', 'royal', 'star', 'modern', 'new', 'shree', 'sri', 'sai', 'global', 'metro', 'delta', 'omega', 'prime', 'urban']
    const kinds = ['garments', 'textiles', 'traders', 'fabrics', 'exports', 'stores', 'agencies', 'mills']
    const parties = Array.from({ length: 12_900 }, (_, i) => ({
      id: `p-${i}`, name: `${words[i % words.length]} ${words[(i * 7) % words.length]} ${kinds[(i * 3) % kinds.length]} ${i}`,
      phone: String(9_000_000_000 + i * 7919), address: '', transport: ''
    }))
    const t0 = performance.now()
    const d = createPartyDirectory(parties)
    d.search('warm') // builds the Fuse index
    const build = performance.now() - t0
    const times: number[] = []
    for (const q of ['royal', 'shree gar', 'rainbw textiles', 'metro 1234', '90000']) {
      const s = performance.now()
      d.search(q)
      times.push(performance.now() - s)
    }
    console.log(`[phase177] 12900 customers: build+first search ${build.toFixed(0)} ms; searches ${times.map((t) => t.toFixed(1)).join(' / ')} ms (sandbox Node, NOT a phone)`)
    expect(d.size()).toBe(12_900)
    expect(Math.max(...times)).toBeLessThan(1500) // generous on purpose: only catches an accidental per-search index rebuild or a hang
  })
})
