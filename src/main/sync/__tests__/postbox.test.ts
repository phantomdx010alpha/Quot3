import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { partsToSealed, SyncCryptoError, open, seal, sealedToParts } from '../crypto'
import { InMemoryTransport, SupabaseTransport, TransportError, type FetchLike, type PushItem } from '../transport'

const KEY = 'Q3-ABCD-EFGH-JKLM'
const B = { a: randomUUID(), b: randomUUID(), c: randomUUID() }

async function world() {
  const t = new InMemoryTransport()
  t.addLicense(KEY)
  for (const [id, p] of [[B.a, 'AAA-'], [B.b, 'BBB-'], [B.c, 'CCC-']] as const) await t.registerBranch({ license: KEY, branchId: id, name: p, poPrefix: p, device: 'PC' })
  return t
}
const item = (to: string, over: Partial<PushItem> = {}): PushItem => ({
  toBranch: to, billId: randomUUID(), op: 'upsert', revision: 1, updatedAt: '2026-10-10T10:00:00.000Z',
  nonce: Buffer.alloc(12, 1).toString('base64'), ciphertext: Buffer.alloc(40, 2).toString('base64'), ...over
})
const kind = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none' } catch (e) { return e instanceof TransportError ? e.kind : 'other' } }
const auth = (branchId: string) => ({ license: KEY, branchId })

describe('InMemoryTransport postbox (two virtual branches)', () => {
  it('push -> pull -> ack: A sends to B, B receives once, ack empties the box', async () => {
    const t = await world()
    const i = item(B.b)
    const { ids } = await t.push({ ...auth(B.a), items: [i] })
    expect(ids).toEqual([1])
    const got = await t.pull({ ...auth(B.b), afterId: 0 })
    expect(got.hasMore).toBe(false)
    expect(got.items).toEqual([{ id: 1, fromBranch: B.a, billId: i.billId, op: 'upsert', revision: 1, updatedAt: i.updatedAt, nonce: i.nonce, ciphertext: i.ciphertext }])
    expect((await t.pull({ ...auth(B.a), afterId: 0 })).items).toEqual([]) // the sender gets nothing
    expect((await t.pull({ ...auth(B.b), afterId: 1 })).items).toEqual([]) // cursor
    expect((await t.pull({ ...auth(B.b), afterId: 0 })).items.length).toBe(1) // pulling deletes nothing
    expect(await t.ack({ ...auth(B.b), ids: [1] })).toEqual({ deleted: 1 })
    expect(t.postboxSize).toBe(0)
  })

  it('fan-out is one row per recipient and ack only deletes rows addressed to the caller', async () => {
    const t = await world()
    const { ids } = await t.push({ ...auth(B.a), items: [item(B.b), item(B.c)] })
    expect(ids).toEqual([1, 2])
    expect(await t.ack({ ...auth(B.c), ids: [1, 2] })).toEqual({ deleted: 1 })
    expect(t.postboxFor(B.b).length).toBe(1)
    expect(await t.ack({ ...auth(B.c), ids: [] })).toEqual({ deleted: 0 })
  })

  it('paging: limit, has_more, oldest first', async () => {
    const t = await world()
    await t.push({ ...auth(B.a), items: [item(B.b), item(B.b), item(B.b)] })
    const p1 = await t.pull({ ...auth(B.b), afterId: 0, limit: 2 })
    expect(p1.items.map((x) => x.id)).toEqual([1, 2])
    expect(p1.hasMore).toBe(true)
    const p2 = await t.pull({ ...auth(B.b), afterId: 2, limit: 2 })
    expect(p2.items.map((x) => x.id)).toEqual([3])
    expect(p2.hasMore).toBe(false)
  })

  it('the server rules: all-or-nothing, bad items, limits, unknown recipient, license', async () => {
    const t = await world()
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b), item(B.a)] }))).toBe('unknown_branch') // to self
    expect(t.postboxSize).toBe(0) // the good item was NOT kept
    expect(await kind(t.push({ ...auth(B.a), items: [item(randomUUID())] }))).toBe('unknown_branch')
    expect(await kind(t.push({ ...auth(B.a), items: [] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: Array.from({ length: 201 }, () => item(B.b)) }))).toBe('too_many')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { nonce: Buffer.alloc(11).toString('base64') })] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { ciphertext: Buffer.alloc(8).toString('base64') })] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { op: 'merge' as never })] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { revision: -1 })] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { updatedAt: 'not a date' })] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b, { ciphertext: Buffer.alloc(1_048_577).toString('base64') })] }))).toBe('too_large')
    expect(await kind(t.push({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: B.a, items: [item(B.b)] }))).toBe('license')
    expect(await kind(t.ack({ ...auth(B.a), ids: Array.from({ length: 1001 }, (_, i) => i) }))).toBe('too_many')
    t.offline = true
    expect(await kind(t.pull({ ...auth(B.b), afterId: 0 }))).toBe('offline')
  })

  it('a branch of another organisation cannot receive or read', async () => {
    const t = await world()
    t.addLicense('Q3-OTHR-ORGA-NISA')
    const other = randomUUID()
    await t.registerBranch({ license: 'Q3-OTHR-ORGA-NISA', branchId: other, name: 'X', poPrefix: 'XXX-', device: 'PC' })
    expect(await kind(t.push({ ...auth(B.a), items: [item(other)] }))).toBe('unknown_branch')
    await t.push({ ...auth(B.a), items: [item(B.b)] })
    expect((await t.pull({ license: 'Q3-OTHR-ORGA-NISA', branchId: other, afterId: 0 })).items).toEqual([])
  })

  it('a real sealed bill travels A -> B through the postbox and opens with the same key', async () => {
    const t = await world()
    const key = Buffer.alloc(32, 7)
    const bill = randomUUID()
    const sealed = seal(key, { po: 'AAA-0001', total: '181.00' }, bill, 3)
    const { nonce, ciphertext } = sealedToParts(sealed)
    await t.push({ ...auth(B.a), items: [item(B.b, { billId: bill, revision: 3, nonce, ciphertext })] })
    const got = (await t.pull({ ...auth(B.b), afterId: 0 })).items[0]!
    expect(open(key, partsToSealed(got.nonce, got.ciphertext), got.billId, got.revision)).toEqual({ po: 'AAA-0001', total: '181.00' })
    expect(() => open(key, partsToSealed(got.nonce, got.ciphertext), got.billId, got.revision + 1)).toThrow(SyncCryptoError)
  })
})

describe('sealed <-> postbox parts', () => {
  it('round trips exactly; the nonce part is 12 bytes; garbage is MALFORMED', () => {
    const key = Buffer.alloc(32, 9)
    const sealed = seal(key, { a: [1, 2, 3] }, 'bill', 1)
    const p = sealedToParts(sealed)
    expect(Buffer.from(p.nonce, 'base64').length).toBe(12)
    expect(partsToSealed(p.nonce, p.ciphertext)).toBe(sealed)
    expect(() => sealedToParts('nope')).toThrow(SyncCryptoError)
    expect(() => partsToSealed('AAAA', p.ciphertext)).toThrow(SyncCryptoError)
    expect(() => partsToSealed(p.nonce, 'AAAA')).toThrow(SyncCryptoError)
  })
})

describe('SupabaseTransport push / pull / ack (mocked HTTP)', () => {
  function http(body: unknown, status = 200) {
    const sent: { url: string; body: Record<string, unknown> }[] = []
    const fetch: FetchLike = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown> }); return { status, text: async () => JSON.stringify(body) } }
    return { t: new SupabaseTransport({ url: 'https://abcd.supabase.co', anonKey: 'anon', fetch, attempts: 1 }), sent }
  }
  it('push sends snake_case items to qt_push and returns the ids', async () => {
    const i = item(B.b)
    const { t, sent } = http({ ids: [41] })
    expect(await t.push({ ...auth(B.a), items: [i] })).toEqual({ ids: [41] })
    expect(sent[0]!.url).toBe('https://abcd.supabase.co/rest/v1/rpc/qt_push')
    expect(sent[0]!.body).toEqual({ p_license: KEY, p_branch_id: B.a, p_items: [{ to_branch: B.b, bill_id: i.billId, op: 'upsert', revision: 1, updated_at: i.updatedAt, nonce: i.nonce, ciphertext: i.ciphertext }] })
  })
  it('push refuses an answer with the wrong number of ids', async () => {
    const { t } = http({ ids: [] })
    expect(await kind(t.push({ ...auth(B.a), items: [item(B.b)] }))).toBe('server')
  })
  it('pull maps rows to camelCase and passes the cursor and limit', async () => {
    const row = { id: 5, from_branch: B.a, bill_id: B.c, op: 'delete', revision: 4, updated_at: '2026-10-10T10:00:00+00:00', nonce: 'AAAA', ciphertext: 'BBBB' }
    const { t, sent } = http({ items: [row], has_more: true })
    expect(await t.pull({ ...auth(B.b), afterId: 4, limit: 50 })).toEqual({ items: [{ id: 5, fromBranch: B.a, billId: B.c, op: 'delete', revision: 4, updatedAt: row.updated_at, nonce: 'AAAA', ciphertext: 'BBBB' }], hasMore: true })
    expect(sent[0]!.body).toEqual({ p_license: KEY, p_branch_id: B.b, p_after_id: 4, p_limit: 50 })
  })
  it('pull rejects a malformed row; ack returns the deleted count', async () => {
    expect(await kind(http({ items: [{ id: 'x' }], has_more: false }).t.pull({ ...auth(B.b), afterId: 0 }))).toBe('server')
    const { t, sent } = http({ deleted: 2 })
    expect(await t.ack({ ...auth(B.b), ids: [1, 2] })).toEqual({ deleted: 2 })
    expect(sent[0]!.body).toEqual({ p_license: KEY, p_branch_id: B.b, p_ids: [1, 2] })
  })
})
