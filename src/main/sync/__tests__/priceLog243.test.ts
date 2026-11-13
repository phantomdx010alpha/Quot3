import { afterEach, describe, expect, it } from 'vitest'
import { createSim, SIM_KEY, type Sim, type SimBranchV2 } from './sharedSim'
import { InMemorySharedTransport, SupabaseSharedTransport, logChangesOf, type SupabaseLike } from '../sharedTransport'
import { createPriceActivityService } from '../../services/priceActivityService'
import { fromPlain } from '../../../shared/richtext/runs'

// Phase 243 (M23): the in-memory server writes the activity log the way supabase/sql/20_price_log.sql does (author = the caller's seat, one entry per
// accepted change, seat 1 reads it, nobody else), and the service gates the view. Invented names only; nothing touches a real server.
const open: Sim[] = []
afterEach(() => { open.splice(0).forEach((s) => s.close()) })
const mk = async (grant = true): Promise<Sim> => { const s = await createSim({ branches: 2, grantPriceRights: grant }); open.push(s); return s }
const item = (name: string, cells: Record<string, string> = {}) => ({ kind: 'item' as const, nameRuns: fromPlain(name), cells })
const seatT = async (s: Sim, seat: number): Promise<InMemorySharedTransport> => { const t = new InMemorySharedTransport(s.server); await t.signIn({ email: `seat${seat}@example.com`, password: `pw${seat}` }); return t }
async function ready(s: Sim): Promise<[SimBranchV2, SimBranchV2]> { const [a, b] = s.bs as [SimBranchV2, SimBranchV2]; await a.push.runOnce(); await b.push.runOnce(); return [a, b] }

describe('Phase 243 - the server writes the log', () => {
  it('seat 1 edits: add, fill (edit), change (overwrite) are logged with the path and the author seat', async () => {
    const s = await mk()
    const [a] = await ready(s)
    const cat = a.price.structure({ op: 'addCategory', name: 'Panna' }).id!
    const tab = a.price.structure({ op: 'addTab', categoryId: cat, name: 'Small' }).id!
    a.price.saveRows({ tabId: tab, rows: [item('Assam')] })
    await a.push.runOnce()
    const row = a.price.rows(tab).find((r) => r.nameRuns.map((n) => n.t).join('') === 'Assam')!
    a.price.saveRows({ tabId: tab, rows: [{ id: row.id, kind: 'item', nameRuns: row.nameRuns, cells: { cash_wo: '110' } }] })
    await a.push.runOnce()
    a.price.saveRows({ tabId: tab, rows: [{ id: row.id, kind: 'item', nameRuns: row.nameRuns, cells: { cash_wo: '120' } }] })
    await a.push.runOnce()
    const log = await (await seatT(s, 1)).priceLogList({ license: SIM_KEY })
    const mine = log.filter((l) => l.recId === row.id)
    expect(mine.map((l) => l.op)).toEqual(['overwrite', 'edit', 'add']) // newest first
    expect(mine[0]).toMatchObject({ seatNo: 1, entity: 'row', path: 'Panna \u203A Small \u203A Assam', device: 'pc' })
    expect(logChangesOf(mine[0]!)).toEqual([expect.objectContaining({ before: '110', after: '120' })])
    expect(log.some((l) => l.entity === 'category' && l.path === 'Panna')).toBe(true)
    expect(log.some((l) => l.entity === 'tab' && l.op === 'add' && l.path === 'Panna \u203A Small')).toBe(true)
    expect(log.every((l, i) => i === 0 || l.id < log[i - 1]!.id)).toBe(true)
  })

  it('the author is the seat that pushed, with its branch name; a refused change and a resend leave no entry', async () => {
    const s = await mk(false)
    const [a, b] = await ready(s)
    const cat = a.price.structure({ op: 'addCategory', name: 'Taps' }).id!
    const tab = a.price.structure({ op: 'addTab', categoryId: cat, name: 'Brass' }).id!
    await a.push.runOnce()
    await s.settle()
    s.server.setPricePerms(s.orgId, 2, { add: true })
    b.price.saveRows({ tabId: tab, rows: [item('Brass elbow')] })
    b.price.structure({ op: 'renameCategory', id: cat, name: 'Taps renamed' }) // refused: needs structure
    await b.push.runOnce()
    await b.push.runOnce() // nothing left to resend
    const log = await (await seatT(s, 1)).priceLogList({ license: SIM_KEY })
    const elbow = log.filter((l) => l.path.endsWith('Brass elbow'))
    expect(elbow).toHaveLength(1)
    expect(elbow[0]).toMatchObject({ seatNo: 2, op: 'add', path: 'Taps \u203A Brass \u203A Brass elbow' })
    expect(elbow[0]!.branchName).not.toBe('')
    expect(log.some((l) => l.path.includes('Taps renamed'))).toBe(false)
  })

  it('only seat 1 reads or trims the log; any other seat gets seat1_only', async () => {
    const s = await mk()
    await ready(s)
    const t2 = await seatT(s, 2)
    await expect(t2.priceLogList({ license: SIM_KEY })).rejects.toMatchObject({ kind: 'seat1_only' })
    await expect(t2.priceLogTrim({ license: SIM_KEY, days: 365 })).rejects.toMatchObject({ kind: 'seat1_only' })
    await expect(seatT(s, 1).then((t) => t.priceLogList({ license: SIM_KEY }))).resolves.toBeDefined()
  })

  it('a permission change is logged (before / after flags); paging by beforeId; trim removes only old entries', async () => {
    const s = await mk(false)
    const [a] = await ready(s)
    const t1 = await seatT(s, 1)
    await t1.pricePermsSet({ license: SIM_KEY, seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: false } })
    await t1.pricePermsSet({ license: SIM_KEY, seatNo: 2, flags: { add: true, edit: false, overwrite: false, delete: false, structure: false } }) // same again: no entry
    a.price.structure({ op: 'addCategory', name: 'One' })
    a.price.structure({ op: 'addCategory', name: 'Two' })
    await a.push.runOnce()
    const all = await t1.priceLogList({ license: SIM_KEY })
    const perm = all.filter((l) => l.op === 'permission')
    expect(perm).toHaveLength(1)
    expect(perm[0]).toMatchObject({ seatNo: 1, entity: 'perms', path: 'Seat 2', before: expect.objectContaining({ add: 'false' }), after: expect.objectContaining({ add: 'true' }) })
    const p1 = await t1.priceLogList({ license: SIM_KEY, limit: 1 })
    const p2 = await t1.priceLogList({ license: SIM_KEY, limit: 1, beforeId: p1[0]!.id })
    expect(p2[0]!.id).toBeLessThan(p1[0]!.id)
    expect(await t1.priceLogTrim({ license: SIM_KEY, days: 365 })).toBe(0) // everything is fresh (days clamp to 30..3650)
  })
})

describe('Phase 243 - the Supabase wrapper reads and sends the new RPCs', () => {
  it('qt_price_log_list / qt_price_log_trim use snake_case arguments and the rows are mapped', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
    const replies: unknown[] = [[{ id: 7, at: '2026-11-13T10:00:00Z', seat_no: 2, branch_id: null, branch_name: 'A', device: 'phone', entity: 'row', rec_id: null, op: 'overwrite', path: 'X', before: { Rate: '1' }, after: { Rate: '2' }, count: 1 }], 3]
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
    const t = new SupabaseSharedTransport({ url: 'https://abcd.supabase.co', anonKey: 'anon', factory: () => client, sleep: async () => undefined, attempts: 1 })
    const rows = await t.priceLogList({ license: SIM_KEY, limit: 5, beforeId: 9 })
    expect(calls[0]).toEqual({ fn: 'qt_price_log_list', args: { p_license: SIM_KEY, p_limit: 5, p_before_id: 9 } })
    expect(rows[0]).toMatchObject({ id: 7, seatNo: 2, device: 'phone', branchName: 'A', op: 'overwrite' })
    expect(logChangesOf(rows[0]!)).toEqual([{ column: 'Rate', before: '1', after: '2' }])
    expect(await t.priceLogTrim({ license: SIM_KEY, days: 90 })).toBe(3)
    expect(calls[1]).toEqual({ fn: 'qt_price_log_trim', args: { p_license: SIM_KEY, p_days: 90 } })
  })
})

describe('Phase 243 - the activity service gates the view', () => {
  const quiet = { info: () => undefined, warn: () => undefined }
  const localPage = { rows: [{ id: 1, at: '2026-11-13T10:00:00.000Z', seatNo: null, branchId: 'x', deviceKind: 'pc' as const, entity: 'row' as const, entityId: 'r', op: 'add' as const, path: 'A', changes: null, count: 1 }] }

  it('no sync: this PC reads its own log, but only while the switch is on', async () => {
    let visible = false
    const svc = createPriceActivityService({ local: { log: () => localPage }, syncActive: () => false, seatNo: () => null, connect: async () => { throw new Error('no network expected') }, settings: () => ({ logVisible: visible, logRetentionDays: 365 }), log: quiet })
    expect(svc.access()).toEqual({ canView: true, visible: false, source: 'local', retentionDays: 365 })
    await expect(svc.list()).rejects.toThrow(/switched off/)
    visible = true
    expect((await svc.list()).rows).toHaveLength(1)
    const csv = await svc.csv()
    expect(csv).toMatchObject({ count: 1, truncated: false })
    expect(csv.csv.startsWith('\uFEFF')).toBe(true)
    expect(await svc.trimServer()).toBe(0)
  })

  it('shared sync: seat 1 reads the server log (paged); seat 2 sees nothing and is refused in plain words', async () => {
    const s = await mk()
    const [a] = await ready(s)
    for (let i = 0; i < 4; i++) a.price.structure({ op: 'addCategory', name: `Cat ${i}` })
    await a.push.runOnce()
    const mkSvc = (seat: number, tr: InMemorySharedTransport) => createPriceActivityService({
      local: { log: () => ({ rows: [] }) }, syncActive: () => true, seatNo: () => seat, connect: async () => ({ transport: tr, creds: { license: SIM_KEY } }),
      settings: () => ({ logVisible: true, logRetentionDays: 365 }), log: quiet
    })
    const s1 = mkSvc(1, await seatT(s, 1))
    expect(s1.access()).toMatchObject({ canView: true, visible: true, source: 'server' })
    const p1 = await s1.list({ limit: 2 })
    expect(p1.rows).toHaveLength(2)
    expect(p1.next).toBe(p1.rows[1]!.id)
    expect(p1.source).toBe('server')
    const p2 = await s1.list({ limit: 2, beforeId: p1.next })
    expect(p2.rows[0]!.id).toBeLessThan(p1.rows[1]!.id)
    expect((await s1.csv()).count).toBeGreaterThanOrEqual(4)
    expect(await s1.trimServer()).toBe(0)
    const s2 = mkSvc(2, await seatT(s, 2))
    expect(s2.access()).toEqual({ canView: false, visible: false, source: null, retentionDays: 365 })
    await expect(s2.list()).rejects.toThrow()
    await expect(s2.csv()).rejects.toThrow()
  })
})
