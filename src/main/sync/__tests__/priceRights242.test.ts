import { afterEach, describe, expect, it } from 'vitest'
import { createSim, SIM_KEY, type Sim, type SimBranchV2 } from './sharedSim'
import { InMemorySharedTransport, SharedTransportError, SupabaseSharedTransport, type SupabaseLike } from '../sharedTransport'
import { REFUSED_KEEP_MAX, REFUSED_STATE_KEY, readRefused } from '../pushWorkerV2'
import { fromPlain } from '../../../shared/richtext/runs'
import { classifySharedFailure } from '../../../shared/sync/license'

// Phase 242 (M23), items 3 + 4: the in-memory server enforces the same rule as supabase/sql/19_price_perms.sql, the push worker handles
// `refused`, and the Supabase wrapper reads the new wire shapes. Invented names only; nothing touches a real server.
const open: Sim[] = []
afterEach(() => { open.splice(0).forEach((s) => s.close()) })
const mk = async (): Promise<Sim> => { const s = await createSim({ branches: 3, grantPriceRights: false }); open.push(s); return s }
const item = (name: string, cells: Record<string, string> = {}) => ({ kind: 'item' as const, nameRuns: fromPlain(name), cells })

/** Seat 1 pushes first so the shared notebook already knows the seed price levels; then the given branch settles its own seed. */
async function ready(s: Sim): Promise<[SimBranchV2, SimBranchV2, SimBranchV2]> {
  const [a, b, c] = s.bs as [SimBranchV2, SimBranchV2, SimBranchV2]
  await a.push.runOnce()
  await b.push.runOnce()
  return [a, b, c]
}
const seatTransport = async (s: Sim, seat: number): Promise<InMemorySharedTransport> => {
  const t = new InMemorySharedTransport(s.server)
  await t.signIn({ email: `seat${seat}@example.com`, password: `pw${seat}` })
  return t
}

describe('Phase 242 - the server refuses a change the seat has no right to', () => {
  it('seat 2 without rights: nothing is written, the row is settled, the kept-list holds ids and rights only', async () => {
    const s = await mk()
    const [, b] = await ready(s)
    const cat = b.price.structure({ op: 'addCategory', name: 'Pipes (secret name)' }).id!
    const r = await b.push.runOnce()
    expect(r.refused).toBeGreaterThanOrEqual(1)
    expect(s.server.record(s.orgId, 'price_category', cat)).toBeUndefined()
    expect(b.records.getState('price_category', cat)).toBeUndefined() // version 0 must never become a base
    expect(b.pendingCount()).toBe(0) // settled: it stops retrying
    const kept = readRefused(b.sync).find((x) => x.recId === cat)
    expect(kept).toMatchObject({ kind: 'price_category', code: 'Q3P01', missing: ['structure'] })
    expect(b.sync.get(REFUSED_STATE_KEY)).not.toContain('secret name') // never content
    expect((await b.push.runOnce()).refused).toBe(0) // nothing is sent again
  })

  it('the rest of the batch still goes through (a refused tab does not stop a bill-less price row from a granted seat)', async () => {
    const s = await mk()
    const [a, b] = await ready(s)
    const cat = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tab = a.price.structure({ op: 'addTab', categoryId: cat, name: 'Brass' }).id!
    await s.settle()
    s.server.setPricePerms(s.orgId, 2, { add: true })
    b.price.saveRows({ tabId: tab, rows: [item('Brass elbow')] }) // needs add -> granted
    b.price.structure({ op: 'renameCategory', id: cat, name: 'Taps renamed' }) // needs structure -> refused
    const r = await b.push.runOnce()
    expect(r.refused).toBeGreaterThanOrEqual(1)
    expect(r.accepted).toBeGreaterThanOrEqual(1)
    const kept = readRefused(b.sync).find((x) => x.recId === cat)
    expect(kept?.missing).toEqual(['structure'])
  })

  it('a granted right lets the same kind of change through; rows follow add / edit / overwrite', async () => {
    const s = await mk()
    const [a, b] = await ready(s)
    const cat = a.price.structure({ op: 'addCategory', name: 'Valves' }).id!
    const tab = a.price.structure({ op: 'addTab', categoryId: cat, name: 'Ball' }).id!
    a.price.saveRows({ tabId: tab, rows: [item('Ball valve', { cash_wo: '100' }), item('Gate valve')] })
    await s.settle()
    s.server.setPricePerms(s.orgId, 2, { add: true, edit: true }) // no overwrite
    const rows = b.price.rows(tab)
    const ball = rows.find((x) => x.nameRuns.map((n) => n.t).join('') === 'Ball valve')!
    const gate = rows.find((x) => x.nameRuns.map((n) => n.t).join('') === 'Gate valve')!
    // filling an empty cell = edit (allowed); changing an existing price = overwrite (refused)
    b.price.saveRows({ tabId: tab, rows: [{ id: gate.id, kind: 'item', nameRuns: gate.nameRuns, cells: { cash_wo: '55' } }, { id: ball.id, kind: 'item', nameRuns: ball.nameRuns, cells: { cash_wo: '120' } }] })
    const r1 = await b.push.runOnce()
    expect(readRefused(b.sync).find((x) => x.recId === ball.id)?.missing).toEqual(['overwrite'])
    expect(readRefused(b.sync).find((x) => x.recId === gate.id)).toBeUndefined()
    expect(r1.refused).toBe(1)
    s.server.setPricePerms(s.orgId, 2, { add: true, edit: true, overwrite: true })
    b.price.saveRows({ tabId: tab, rows: [{ id: ball.id, kind: 'item', nameRuns: ball.nameRuns, cells: { cash_wo: '121' } }] })
    const r2 = await b.push.runOnce()
    expect(r2.refused).toBe(0)
    expect(r2.accepted + r2.won).toBeGreaterThanOrEqual(1)
  })

  it('revoking a right stops the next push; seat 1 is never refused and cannot be given less', async () => {
    const s = await mk()
    const [a, b] = await ready(s)
    s.server.setPricePerms(s.orgId, 2, { structure: true })
    const c1 = b.price.structure({ op: 'addCategory', name: 'One' }).id!
    expect((await b.push.runOnce()).refused).toBe(0)
    expect(s.server.record(s.orgId, 'price_category', c1)).toBeDefined()
    s.server.setPricePerms(s.orgId, 2, {}) // revoked
    const c2 = b.price.structure({ op: 'addCategory', name: 'Two' }).id!
    expect((await b.push.runOnce()).refused).toBe(1)
    expect(s.server.record(s.orgId, 'price_category', c2)).toBeUndefined()
    s.server.setPricePerms(s.orgId, 1, {}) // seat 1 is forced to all rights
    const c3 = a.price.structure({ op: 'addCategory', name: 'Three' }).id!
    expect((await a.push.runOnce()).refused).toBe(0)
    expect(s.server.record(s.orgId, 'price_category', c3)).toBeDefined()
  })

  it('deleting needs the delete right; an idempotent resend of what the server already holds is not checked', async () => {
    const s = await mk()
    const [a, b] = await ready(s)
    const cat = a.price.structure({ op: 'addCategory', name: 'Fittings' }).id!
    await s.settle()
    s.server.setPricePerms(s.orgId, 2, { structure: true })
    b.price.structure({ op: 'deleteCategory', id: cat })
    expect((await b.push.runOnce()).refused).toBe(1)
    expect(readRefused(b.sync).find((x) => x.recId === cat)?.missing).toEqual(['delete'])
    // the same payload from the server's own copy hashes equal: seat 3 with no rights sends nothing new, so nothing is refused
    const c = s.bs[2]!
    await c.push.runOnce(); await c.pull.runOnce()
    expect((await c.push.runOnce()).refused).toBe(0)
  })

  it('the kept-list is newest-first capped and replaces an older entry for the same record', async () => {
    const s = await mk()
    const [, b] = await ready(s)
    const id = b.price.structure({ op: 'addCategory', name: 'Same' }).id!
    await b.push.runOnce()
    b.price.structure({ op: 'renameCategory', id, name: 'Same 2' })
    await b.push.runOnce()
    expect(readRefused(b.sync).filter((x) => x.recId === id)).toHaveLength(1)
    expect(REFUSED_KEEP_MAX).toBe(200)
    b.sync.set(REFUSED_STATE_KEY, 'not json')
    expect(readRefused(b.sync)).toEqual([])
  })
})

describe('Phase 242 - the rights calls', () => {
  it('any seat reads its own flags; seat 1 reads all-true; a seat without a row reads all-false', async () => {
    const s = await mk()
    const t1 = await seatTransport(s, 1)
    const t2 = await seatTransport(s, 2)
    expect(await t1.pricePermsGet({ license: SIM_KEY })).toEqual({ seatNo: 1, flags: { add: true, edit: true, overwrite: true, delete: true, structure: true } })
    expect(await t2.pricePermsGet({ license: SIM_KEY })).toEqual({ seatNo: 2, flags: { add: false, edit: false, overwrite: false, delete: false, structure: false } })
  })

  it('only seat 1 lists and sets; others get seat1_only (Q3P02); set stores normalised flags and forces seat 1 to all-true', async () => {
    const s = await mk()
    const t1 = await seatTransport(s, 1)
    const t2 = await seatTransport(s, 2)
    const set = await t1.pricePermsSet({ license: SIM_KEY, seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: true } })
    expect(set).toEqual({ seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: true } })
    expect((await t2.pricePermsGet({ license: SIM_KEY })).flags.add).toBe(true)
    const list = await t1.pricePermsList({ license: SIM_KEY })
    expect(list.map((r) => r.seatNo)).toEqual([1, 2, 3])
    expect(list[0]!.flags.structure).toBe(true)
    expect(list[2]!.flags.add).toBe(false)
    const own = await t1.pricePermsSet({ license: SIM_KEY, seatNo: 1, flags: { add: false, edit: false, overwrite: false, delete: false, structure: false } })
    expect(own.flags).toEqual({ add: true, edit: true, overwrite: true, delete: true, structure: true })
    for (const call of [() => t2.pricePermsList({ license: SIM_KEY }), () => t2.pricePermsSet({ license: SIM_KEY, seatNo: 3, flags: own.flags })]) {
      const e = await call().then(() => null, (x: unknown) => x as SharedTransportError)
      expect(e).toBeInstanceOf(SharedTransportError)
      expect(e!.kind).toBe('seat1_only')
      expect(e!.sqlstate).toBe('Q3P02')
    }
    await expect(t1.pricePermsSet({ license: SIM_KEY, seatNo: 9, flags: own.flags })).rejects.toMatchObject({ kind: 'invalid_input' })
  })

  it('a wrong license is refused like every other call', async () => {
    const s = await mk()
    const t1 = await seatTransport(s, 1)
    await expect(t1.pricePermsGet({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ' })).rejects.toMatchObject({ kind: 'license' })
  })

  it('Q3P01 / Q3P02 read as plain-words kinds', () => {
    expect(classifySharedFailure({ code: 'Q3P01' })).toBe('not_allowed')
    expect(classifySharedFailure({ code: 'Q3P02' })).toBe('seat1_only')
  })
})

describe('Phase 242 - the Supabase wrapper reads the new wire shapes', () => {
  const REC = '11111111-1111-4111-8111-111111111111'
  const replies: unknown[] = []
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args })
      const data = replies.shift()
      const p = { abortSignal: () => p, then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res, rej) }
      return p
    },
    auth: { signInWithPassword: async () => ({ data: { session: null }, error: null }) },
    channel: () => ({}), removeChannel: async () => 'ok', realtime: { setAuth: () => undefined }
  } as unknown as SupabaseLike
  const sb = () => new SupabaseSharedTransport({ url: 'https://abcd.supabase.co', anonKey: 'anon', factory: () => client, sleep: async () => undefined, attempts: 1 })
  const scope = { license: SIM_KEY, branchId: '22222222-2222-4222-8222-222222222222' }
  const item = { kind: 'price_tab' as const, recId: REC, baseVersion: 0, payload: {}, payloadHash: 'h'.repeat(10), schemaVer: 1, minReaderVer: 1, appVer: '1', editedAt: '2026-11-13T00:00:00.000Z', deleted: false }

  it('a refused push item keeps its code and missing rights, with version 0', async () => {
    replies.push([{ kind: 'price_tab', rec_id: REC, outcome: 'refused', code: 'Q3P01', missing: ['structure'], version: 0, server_seq: 0 }])
    expect(await sb().push({ ...scope, items: [item] })).toEqual([{ kind: 'price_tab', recId: REC, outcome: 'refused', version: 0, serverSeq: 0, code: 'Q3P01', missing: ['structure'] }])
    replies.push([{ kind: 'price_tab', rec_id: REC, outcome: 'accepted', version: 1, server_seq: 7 }])
    expect(await sb().push({ ...scope, items: [item] })).toEqual([{ kind: 'price_tab', recId: REC, outcome: 'accepted', version: 1, serverSeq: 7 }])
  })

  it('get / list / set call the three RPCs with snake_case arguments and normalise flags (only a real true counts)', async () => {
    calls.length = 0
    replies.push({ seat_no: 2, flags: { add: true, edit: 'yes' } })
    expect(await sb().pricePermsGet({ license: SIM_KEY })).toEqual({ seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: false } })
    replies.push([{ seat_no: 1, branch_name: 'Main', flags: { add: true, edit: true, overwrite: true, delete: true, structure: true }, updated_at: null }, { seat_no: 2, flags: {} }])
    const list = await sb().pricePermsList({ license: SIM_KEY })
    expect(list.map((r) => [r.seatNo, r.branchName])).toEqual([[1, 'Main'], [2, null]])
    replies.push({ seat_no: 2, flags: { add: true } })
    await sb().pricePermsSet({ license: SIM_KEY, seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: false } })
    expect(calls.map((c) => c.fn)).toEqual(['qt_price_perms_get', 'qt_price_perms_list', 'qt_price_perms_set'])
    expect(calls[2]!.args).toMatchObject({ p_license: SIM_KEY, p_seat: 2 })
  })
})
