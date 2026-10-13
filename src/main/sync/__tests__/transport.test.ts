import { describe, expect, it } from 'vitest'
import { InMemoryTransport, SupabaseTransport, TransportError, classifyHttp, type FetchLike } from '../transport'

const KEY = 'Q3-ABCD-EFGH-JKLM'
const B1 = '11111111-1111-4111-8111-111111111111'
const B2 = '22222222-2222-4222-8222-222222222222'
const B3 = '33333333-3333-4333-8333-333333333333'
const ORG = '99999999-9999-4999-8999-999999999999'
const reg = (branchId: string, poPrefix: string, license = KEY) => ({ license, branchId, name: `Branch ${poPrefix}`, poPrefix, device: 'PC' })

interface Sent { url: string; body: Record<string, unknown>; headers: Record<string, string> }
/** A scripted fetch: each entry is a status + body, or an Error to throw. */
function scripted(steps: ({ status: number; body: unknown } | Error | 'hang')[]): { fetch: FetchLike; sent: Sent[] } {
  const sent: Sent[] = []
  let i = 0
  const fetch: FetchLike = (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) as Record<string, unknown>, headers: init.headers })
    const step = steps[Math.min(i++, steps.length - 1)]!
    if (step === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
    if (step instanceof Error) return Promise.reject(step)
    return Promise.resolve({ status: step.status, text: async () => (typeof step.body === 'string' ? step.body : JSON.stringify(step.body)) })
  }
  return { fetch, sent }
}
const mk = (steps: Parameters<typeof scripted>[0], over: { attempts?: number; timeoutMs?: number } = {}) => {
  const s = scripted(steps)
  const sleeps: number[] = []
  const t = new SupabaseTransport({ url: 'https://abcd.supabase.co/', anonKey: 'anon-key', fetch: s.fetch, sleep: async (ms) => { sleeps.push(ms) }, ...over })
  return { t, ...s, sleeps }
}
const kind = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none' } catch (e) { return e instanceof TransportError ? e.kind : 'other' } }
const okRegister = { status: 200, body: { org_id: ORG, kdf_salt: 'c2FsdA==', branches: [{ branch_id: B1, name: 'Main', po_prefix: 'Q3-' }] } }

describe('SupabaseTransport (mocked HTTP)', () => {
  it('calls the RPC with the anon key only and maps the register answer', async () => {
    const { t, sent } = mk([okRegister])
    const r = await t.registerBranch(reg(B1, 'Q3-'))
    expect(r).toEqual({ orgId: ORG, kdfSalt: 'c2FsdA==', branches: [{ branchId: B1, name: 'Main', poPrefix: 'Q3-' }] })
    expect(sent[0]!.url).toBe('https://abcd.supabase.co/rest/v1/rpc/qt_register_branch')
    expect(sent[0]!.body).toEqual({ p_license: KEY, p_branch_id: B1, p_name: 'Branch Q3-', p_po_prefix: 'Q3-', p_device: 'PC' })
    expect(sent[0]!.headers['apikey']).toBe('anon-key')
    expect(sent[0]!.headers['authorization']).toBe('Bearer anon-key')
  })
  it('maps the server SQLSTATE codes to kinds and does not retry them', async () => {
    const cases: [string, string][] = [['Q3L01', 'license'], ['Q3M01', 'unknown_branch'], ['Q3B01', 'branch_limit'], ['Q3B02', 'prefix_taken'], ['Q3B03', 'branch_conflict'], ['Q3I01', 'invalid_input']]
    for (const [code, k] of cases) {
      const { t, sent } = mk([{ status: 400, body: { code, message: 'x' } }])
      expect(await kind(t.registerBranch(reg(B1, 'Q3-')))).toBe(k)
      expect(sent).toHaveLength(1)
    }
  })
  it('a bad anon key (401) and a missing function (404) are their own kinds, not offline', async () => {
    expect(await kind(mk([{ status: 401, body: { message: 'Invalid API key' } }]).t.touch({ license: KEY, branchId: B1 }))).toBe('anon_key')
    expect(await kind(mk([{ status: 404, body: { code: 'PGRST202', message: 'no function' } }]).t.touch({ license: KEY, branchId: B1 }))).toBe('not_installed')
  })
  it('retries a network error with growing delays, then succeeds', async () => {
    const { t, sent, sleeps } = mk([new Error('ECONNRESET'), { status: 503, body: 'down' }, okRegister])
    await t.registerBranch(reg(B1, 'Q3-'))
    expect(sent).toHaveLength(3)
    expect(sleeps).toEqual([400, 800])
  })
  it('gives up after the attempt budget: offline for network errors, server for 5xx', async () => {
    const a = mk([new Error('down')], { attempts: 2 })
    expect(await kind(a.t.touch({ license: KEY, branchId: B1 }))).toBe('offline')
    expect(a.sent).toHaveLength(2)
    expect(await kind(mk([{ status: 500, body: 'oops' }], { attempts: 2 }).t.touch({ license: KEY, branchId: B1 }))).toBe('server')
  })
  it('does not retry a 400 that is not one of ours', async () => {
    const { t, sent } = mk([{ status: 400, body: { code: '22P02', message: 'bad uuid' } }])
    expect(await kind(t.touch({ license: KEY, branchId: 'x' }))).toBe('server')
    expect(sent).toHaveLength(1)
  })
  it('times out a hanging call and reports timeout', async () => {
    const { t } = mk(['hang'], { attempts: 1, timeoutMs: 20 })
    expect(await kind(t.touch({ license: KEY, branchId: B1 }))).toBe('timeout')
  })
  it('a malformed answer is a server problem', async () => {
    expect(await kind(mk([{ status: 200, body: { nope: true } }]).t.registerBranch(reg(B1, 'Q3-')))).toBe('server')
    expect(await kind(mk([{ status: 200, body: 'not json' }]).t.registerBranch(reg(B1, 'Q3-')))).toBe('server')
  })
  it('maps list and touch answers', async () => {
    const l = await mk([{ status: 200, body: [{ branch_id: B1, name: 'A', po_prefix: 'A-', last_seen_at: '2026-10-09T00:00:00Z' }, { branch_id: B2, name: 'B', po_prefix: 'B-' }] }]).t.listBranches({ license: KEY, branchId: B1 })
    expect(l).toEqual([{ branchId: B1, name: 'A', poPrefix: 'A-', lastSeenAt: '2026-10-09T00:00:00Z' }, { branchId: B2, name: 'B', poPrefix: 'B-', lastSeenAt: null }])
    expect(await mk([{ status: 200, body: { ok: true, server_time: 'T' } }]).t.touch({ license: KEY, branchId: B1 })).toEqual({ serverTime: 'T' })
  })
  it('classifyHttp tolerates non-JSON bodies', () => {
    expect(classifyHttp(502, '<html>').kind).toBe('server')
  })
})

describe('InMemoryTransport (the server rules)', () => {
  it('registers branches, returns the org salt and the branch list, and re-registering consumes no seat', async () => {
    const t = new InMemoryTransport(); t.addLicense(KEY, { maxBranches: 2 })
    const a = await t.registerBranch(reg(B1, 'A-'))
    const b = await t.registerBranch(reg(B2, 'b-'))
    expect(b.branches.map((x) => x.poPrefix)).toEqual(['A-', 'B-'])
    expect(b.kdfSalt).toBe(a.kdfSalt)
    expect(b.orgId).toBe(a.orgId)
    await t.registerBranch({ ...reg(B1, 'A-'), name: 'Renamed' })
    expect((await t.listBranches({ license: KEY, branchId: B1 })).find((x) => x.branchId === B1)!.name).toBe('Renamed')
  })
  it('enforces the seat limit and unique prefixes', async () => {
    const t = new InMemoryTransport(); t.addLicense(KEY, { maxBranches: 2 })
    await t.registerBranch(reg(B1, 'A-')); await t.registerBranch(reg(B2, 'B-'))
    expect(await kind(t.registerBranch(reg(B3, 'C-')))).toBe('branch_limit')
    expect(await kind(t.registerBranch(reg(B2, 'A-')))).toBe('prefix_taken')
  })
  it('gives the same generic error for malformed, unknown and suspended keys', async () => {
    const t = new InMemoryTransport(); t.addLicense(KEY)
    expect(await kind(t.registerBranch(reg(B1, 'A-', 'garbage')))).toBe('license')
    expect(await kind(t.registerBranch(reg(B1, 'A-', 'Q3-AAAA-BBBB-CCCC')))).toBe('license')
    await t.registerBranch(reg(B1, 'A-'))
    t.suspend(KEY)
    expect(await kind(t.registerBranch(reg(B1, 'A-')))).toBe('license')
    expect(await kind(t.touch({ license: KEY, branchId: B1 }))).toBe('license')
  })
  it('a branch of another organisation conflicts; an unregistered branch cannot list', async () => {
    const t = new InMemoryTransport(); t.addLicense(KEY); t.addLicense('Q3-ZZZZ-YYYY-XXXX')
    await t.registerBranch(reg(B1, 'A-'))
    expect(await kind(t.registerBranch(reg(B1, 'Z-', 'Q3-ZZZZ-YYYY-XXXX')))).toBe('branch_conflict')
    expect(await kind(t.listBranches({ license: KEY, branchId: B2 }))).toBe('unknown_branch')
  })
  it('rejects bad input like the SQL does and simulates being offline', async () => {
    const t = new InMemoryTransport(); t.addLicense(KEY)
    expect(await kind(t.registerBranch({ ...reg(B1, 'A-'), name: '' }))).toBe('invalid_input')
    expect(await kind(t.registerBranch(reg(B1, 'WAYTOOLONGPREFIX')))).toBe('invalid_input')
    t.offline = true
    expect(await kind(t.registerBranch(reg(B1, 'A-')))).toBe('offline')
  })
})

describe('pendingCount (Phase 89)', () => {
  it('Supabase: calls qt_pending_count with the license and branch and reads { pending }', async () => {
    const { t, sent } = mk([{ status: 200, body: { pending: 768 } }])
    expect(await t.pendingCount({ license: KEY, branchId: B1 })).toEqual({ pending: 768 })
    expect(sent[0]!.url).toBe('https://abcd.supabase.co/rest/v1/rpc/qt_pending_count')
    expect(sent[0]!.body).toEqual({ p_license: KEY, p_branch_id: B1 })
  })
  it('Supabase: a server that has not got the function yet is "not_installed"; a bad answer is "server"', async () => {
    expect(await kind(mk([{ status: 404, body: { code: 'PGRST202', message: 'no function' } }]).t.pendingCount({ license: KEY, branchId: B1 }))).toBe('not_installed')
    expect(await kind(mk([{ status: 200, body: { pending: 'x' } }]).t.pendingCount({ license: KEY, branchId: B1 }))).toBe('server')
  })
  it('in memory: counts only rows addressed to the caller and checks the license', async () => {
    const m = new InMemoryTransport()
    m.addLicense(KEY)
    await m.registerBranch(reg(B1, 'AAA-')); await m.registerBranch(reg(B2, 'BBB-'))
    expect(await m.pendingCount({ license: KEY, branchId: B2 })).toEqual({ pending: 0 })
    expect(await kind(m.pendingCount({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: B2 }))).toBe('license')
  })
})
