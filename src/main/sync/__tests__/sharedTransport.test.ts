import { describe, expect, it } from 'vitest'
import { PUSH_CASES } from './pushTruthTable.cases'
import {
  InMemorySharedServer, InMemorySharedTransport, SharedTransportError, SupabaseSharedTransport, SHARED_HISTORY_CAP,
  type PushItem, type SharedKind, type SupabaseLike
} from '../sharedTransport'

const KEY = 'Q3-ABCD-EFGH-JKLM'
const A = '11111111-1111-4111-8111-111111111111'
const B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const R = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const T0 = 1_700_000_000_000

function mk(seats = 2, now = { t: T0 }) {
  const server = new InMemorySharedServer({ now: () => now.t })
  const { orgId } = server.addOrg({ licenseKey: KEY, seats: Array.from({ length: seats }, (_, i) => ({ email: `seat${i + 1}@example.com`, password: `pw-${i + 1}` })) })
  const tx = (_seat: number): InMemorySharedTransport => new InMemorySharedTransport(server)
  return { server, orgId, now, tx }
}
async function branch(t: InMemorySharedTransport, i: number, id: string, prefix: string, name = `Branch ${prefix}`) {
  await t.signIn({ email: `seat${i}@example.com`, password: `pw-${i}` })
  await t.activate({ license: KEY, branchId: id, name, poPrefix: prefix, device: 'PC', takeover: false })
}
const item = (over: Partial<PushItem> = {}): PushItem => ({
  kind: 'bill', recId: R(1), baseVersion: 0, payload: { n: 1 }, payloadHash: 'hash-aaaa', schemaVer: 1, minReaderVer: 1, appVer: '1', editedAt: new Date(T0).toISOString(), deleted: false, ...over
})
const pad = (h: string): string => (h.length >= 8 ? h : `${h}-padded`) // the server wants 8-128 characters; padding keeps equality
const kind = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none' } catch (e) { return e instanceof SharedTransportError ? e.kind : 'other' } }

describe('InMemorySharedTransport passes the Phase 130 truth table', () => {
  for (const c of PUSH_CASES) {
    it(c.name, async () => {
      const { server, orgId, tx } = mk(1)
      const t = tx(1)
      await branch(t, 1, c.branch, 'P1')
      const rec = c.stored && server.seedRecord(orgId, { kind: 'bill', recId: R(7), version: c.stored.version, payloadHash: pad(c.stored.payloadHash), editedAt: new Date(c.stored.editedAt).toISOString(), fromBranch: c.stored.fromBranch, payload: { who: 'stored' } })
      const seqBefore = rec?.serverSeq ?? 0
      const [res] = await t.push({
        license: KEY, branchId: c.branch,
        items: [item({ recId: R(7), baseVersion: c.incoming.baseVersion, payloadHash: pad(c.incoming.payloadHash), editedAt: new Date(c.incoming.editedAt).toISOString(), payload: { who: 'incoming' } })]
      })
      const after = server.record(orgId, 'bill', R(7))!
      expect(res!.outcome).toBe(c.outcome)
      expect(after.version).toBe(c.versionAfter)
      expect(after.serverSeq !== seqBefore).toBe(c.seqBumps)
      expect((after.payload as { who: string }).who).toBe(c.storedAfter === 'incoming' ? 'incoming' : 'stored')
      const h = server.historyOf(orgId, 'bill', R(7))
      if (c.history === null) expect(h).toHaveLength(0)
      else {
        expect(h).toHaveLength(1)
        expect(h[0]!.reason).toBe(c.history.reason)
        expect((h[0]!.payload as { who: string }).who).toBe(c.history.side)
      }
    })
  }
})

describe('InMemorySharedServer rules', () => {
  it('sign-in: wrong password, unknown e-mail, banned (suspended) seat -> auth_failed; right login works', async () => {
    const { server, orgId, tx } = mk()
    expect(await kind(tx(1).signIn({ email: 'seat1@example.com', password: 'bad' }))).toBe('auth_failed')
    expect(await kind(tx(1).signIn({ email: 'who@example.com', password: 'x' }))).toBe('auth_failed')
    expect((await tx(1).signIn({ email: ' SEAT1@example.com ', password: 'pw-1' })).userId).toBeTruthy()
    server.setLicenseStatus(orgId, 'suspended')
    expect(await kind(tx(1).signIn({ email: 'seat1@example.com', password: 'pw-1' }))).toBe('auth_failed')
  })

  it('every RPC needs a signed-in seat, the right key, and (when given) this seat\'s own branch', async () => {
    const { tx } = mk()
    const t = tx(1)
    expect(await kind(t.touch({ license: KEY, branchId: A }))).toBe('not_member') // not signed in: auth.uid() is null
    await branch(t, 1, A, 'P1')
    expect(await kind(t.listBranches({ license: 'Q3-AAAA-AAAA-AAAA', branchId: A }))).toBe('license')
    expect(await kind(t.listBranches({ license: KEY, branchId: B }))).toBe('unknown_branch')
    expect((await t.listBranches({ license: ' q3-abcd-efgh-jklm ', branchId: A })).map((b) => b.poPrefix)).toEqual(['P1'])
  })

  it('suspended license: the ban stops sign-in and every call (RPC path) is refused', async () => {
    const { server, orgId, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'P1')
    server.setLicenseStatus(orgId, 'suspended')
    expect(await kind(t.push({ license: KEY, branchId: A, items: [item()] }))).toBe('license')
    expect(await kind(t.pull({ license: KEY, branchId: A, afterSeq: 0 }))).toBe('license')
    server.setLicenseStatus(orgId, 'active')
    expect((await t.pull({ license: KEY, branchId: A, afterSeq: 0 })).items).toEqual([])
  })

  it('activation: name and prefix are unique per organisation (case and space insensitive), prefix alphabet checked', async () => {
    const { tx } = mk(3)
    const t1 = tx(1), t2 = tx(2), t3 = tx(3)
    await branch(t1, 1, A, 'AA', 'Main  Shop')
    await t2.signIn({ email: 'seat2@example.com', password: 'pw-2' })
    const a2 = { license: KEY, branchId: B, device: '', takeover: false }
    expect(await kind(t2.activate({ ...a2, name: ' main shop', poPrefix: 'BB' }))).toBe('name_taken')
    expect(await kind(t2.activate({ ...a2, name: 'Second', poPrefix: 'aa' }))).toBe('prefix_taken')
    expect(await kind(t2.activate({ ...a2, name: '', poPrefix: 'BB' }))).toBe('invalid_input')
    expect(await kind(t2.activate({ ...a2, name: 'Second', poPrefix: 'TOO-LONG-X' }))).toBe('invalid_input')
    expect(await kind(t2.activate({ ...a2, branchId: 'nope', name: 'Second', poPrefix: 'BB' }))).toBe('invalid_input')
    const ok = await t2.activate({ ...a2, name: 'Second', poPrefix: 'bb' })
    expect(ok.seatNo).toBe(2)
    expect(ok.branches.map((b) => b.poPrefix)).toEqual(['AA', 'BB'])
    expect(await t2.branchNameFree({ license: KEY, name: 'MAIN SHOP' })).toBe(false)
    expect(await t2.branchNameFree({ license: KEY, name: 'Second', branchId: B })).toBe(true) // my own name does not count against me
    // the third seat tries the first seat's branch id
    await t3.signIn({ email: 'seat3@example.com', password: 'pw-3' })
    expect(await kind(t3.activate({ ...a2, branchId: A, name: 'Third', poPrefix: 'CC' }))).toBe('branch_conflict')
  })

  it('a seat bound to one branch is refused another without takeover; takeover frees the old name and prefix; re-activating the same branch is fine', async () => {
    const { server, orgId, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA', 'Old PC')
    await t.activate({ license: KEY, branchId: A, name: 'Old PC renamed', poPrefix: 'AA', device: '', takeover: false })
    expect(await kind(t.activate({ license: KEY, branchId: B, name: 'New PC', poPrefix: 'BB', device: '', takeover: false }))).toBe('seat_in_use')
    await t.activate({ license: KEY, branchId: B, name: 'Old PC', poPrefix: 'AA', device: '', takeover: true })
    expect(server.branches(orgId).map((b) => b.branchId)).toEqual([B])
    expect(server.seatOf('seat1@example.com')!.branchId).toBe(B)
    expect(await kind(t.listBranches({ license: KEY, branchId: A }))).toBe('unknown_branch')
  })

  it('rename keeps names unique; a second organisation may reuse a name and prefix', async () => {
    const { server, tx } = mk()
    const o2 = server.addOrg({ licenseKey: 'Q3-ZZZZ-ZZZZ-ZZZZ', seats: [{ email: 'other@example.com', password: 'pw' }] })
    const t1 = tx(1), t2 = tx(2)
    await branch(t1, 1, A, 'AA', 'Main')
    await branch(t2, 2, B, 'BB', 'Second')
    expect(await kind(t2.renameBranch({ license: KEY, branchId: B, name: ' main ' }))).toBe('name_taken')
    expect((await t2.renameBranch({ license: KEY, branchId: B, name: ' Third  one ' })).name).toBe('Third  one') // the server only trims; the app collapses spaces first (validateBranchName)
    const t3 = new InMemorySharedTransport(server)
    await t3.signIn({ email: 'other@example.com', password: 'pw' })
    const r = await t3.activate({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: R(99), name: 'Main', poPrefix: 'AA', device: '', takeover: false })
    expect(r.orgId).toBe(o2.orgId)
    expect(r.branches).toHaveLength(1)
  })

  it('push is all or nothing and refuses bad input, too many items, too-large payloads', async () => {
    const { server, orgId, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    const base = { license: KEY, branchId: A }
    expect(await kind(t.push({ ...base, items: [] }))).toBe('invalid_input')
    expect(await kind(t.push({ ...base, items: Array.from({ length: 201 }, (_, i) => item({ recId: R(i + 1), payloadHash: `hash-${String(i).padStart(6, '0')}` })) }))).toBe('too_many')
    expect(await kind(t.push({ ...base, items: [item({ payload: { big: 'x'.repeat(1_100_000) } })] }))).toBe('too_large')
    for (const bad of [item({ kind: 'nope' as SharedKind }), item({ recId: 'x' }), item({ baseVersion: -1 }), item({ payloadHash: 'short' }), item({ editedAt: 'yesterday' }), item({ payload: [] as unknown as Record<string, unknown> })]) {
      expect(await kind(t.push({ ...base, items: [item({ recId: R(5) }), bad] }))).toBe('invalid_input')
    }
    expect(server.records(orgId)).toHaveLength(0) // the good first item was rolled back every time
    expect(await kind(t.push({ branchId: B, license: KEY, items: [item()] }))).toBe('unknown_branch')
  })

  it('accepted pushes ring the doorbell once per call; a noop resend does not', async () => {
    const { server, orgId, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    let rings = 0
    const off = t.subscribeDoorbell({ orgId }, () => rings++)
    const items = [item({ recId: R(1), payloadHash: 'hash-1111' }), item({ recId: R(2), payloadHash: 'hash-2222' })]
    await t.push({ license: KEY, branchId: A, items })
    expect(rings).toBe(1)
    expect(server.pingSeq(orgId)).toBe(1)
    await t.push({ license: KEY, branchId: A, items })
    expect(rings).toBe(1)
    off()
    await t.push({ license: KEY, branchId: A, items: [item({ recId: R(3), payloadHash: 'hash-3333' })] })
    expect(rings).toBe(1)
  })

  it('history keeps the newest 20 per record, also when 25 updates arrive in one call', async () => {
    const { server, orgId, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    const items = Array.from({ length: 26 }, (_, i) => item({ baseVersion: i === 0 ? 0 : i, payloadHash: `hash-${String(i).padStart(6, '0')}`, payload: { i } }))
    const res = await t.push({ license: KEY, branchId: A, items })
    expect(res.map((r) => r.version)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1))
    const h = server.historyOf(orgId, 'bill', R(1))
    expect(h).toHaveLength(SHARED_HISTORY_CAP)
    expect((h[0]!.payload as { i: number }).i).toBe(5) // the oldest five were dropped
    expect((h.at(-1)!.payload as { i: number }).i).toBe(24)
  })

  it('pull pages by server_seq, returns each record once, includes tombstones, refuses bad limits and cursors', async () => {
    const { tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    await t.push({ license: KEY, branchId: A, items: [1, 2, 3, 4, 5].map((n) => item({ recId: R(n), payloadHash: `hash-${n}${n}${n}${n}`, deleted: n === 3 })) })
    const seen: string[] = []
    let after = 0, more = true, deleted = 0
    while (more) {
      const p = await t.pull({ license: KEY, branchId: A, afterSeq: after, limit: 2 })
      p.items.forEach((r) => { seen.push(r.recId); if (r.deleted) deleted++ })
      after = p.items.at(-1)?.serverSeq ?? after
      more = p.hasMore
    }
    expect(seen).toEqual([1, 2, 3, 4, 5].map(R))
    expect(deleted).toBe(1)
    expect((await t.pull({ license: KEY, branchId: A, afterSeq: after })).items).toEqual([])
    for (const bad of [{ afterSeq: -1 }, { afterSeq: 0, limit: 0 }, { afterSeq: 0, limit: 201 }]) expect(await kind(t.pull({ license: KEY, branchId: A, ...bad }))).toBe('invalid_input')
  })

  it('pull stops at about 4 MB but always returns at least one row', async () => {
    const { tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    const big = (n: number) => item({ recId: R(n), payloadHash: `hash-${n}${n}${n}${n}`, payload: { s: 'x'.repeat(900_000) } })
    await t.push({ license: KEY, branchId: A, items: [big(1), big(2), big(3), big(4), big(5), big(6)] })
    const p = await t.pull({ license: KEY, branchId: A, afterSeq: 0 })
    expect(p.items.length).toBe(4)
    expect(p.hasMore).toBe(true)
  })

  it('manifest has no payloads, pages by rec_id and refuses a bad kind or limit', async () => {
    const { tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    await t.push({ license: KEY, branchId: A, items: [3, 1, 2].map((n) => item({ recId: R(n), payloadHash: `hash-${n}${n}${n}${n}` })) })
    const p1 = await t.manifest({ license: KEY, branchId: A, kind: 'bill', limit: 2 })
    expect(p1.map((r) => r.recId)).toEqual([R(1), R(2)])
    expect(Object.keys(p1[0]!).sort()).toEqual(['deleted', 'payloadHash', 'recId', 'serverSeq', 'version'])
    expect((await t.manifest({ license: KEY, branchId: A, kind: 'bill', afterRecId: R(2) })).map((r) => r.recId)).toEqual([R(3)])
    expect(await t.manifest({ license: KEY, branchId: A, kind: 'party' })).toEqual([])
    expect(await kind(t.manifest({ license: KEY, branchId: A, kind: 'x' as SharedKind }))).toBe('invalid_input')
    expect(await kind(t.manifest({ license: KEY, branchId: A, kind: 'bill', limit: 1001 }))).toBe('invalid_input')
  })

  it('two organisations never see each other\'s records, and the same record id stays separate', async () => {
    const { server, tx } = mk()
    server.addOrg({ licenseKey: 'Q3-ZZZZ-ZZZZ-ZZZZ', seats: [{ email: 'other@example.com', password: 'pw' }] })
    const t1 = tx(1), t2 = new InMemorySharedTransport(server)
    await branch(t1, 1, A, 'AA')
    await t2.signIn({ email: 'other@example.com', password: 'pw' })
    await t2.activate({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: B, name: 'X', poPrefix: 'AA', device: '', takeover: false })
    await t1.push({ license: KEY, branchId: A, items: [item({ payload: { org: 1 } })] })
    await t2.push({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: B, items: [item({ payload: { org: 2 }, payloadHash: 'hash-other' })] })
    expect((await t1.pull({ license: KEY, branchId: A, afterSeq: 0 })).items.map((r) => r.payload)).toEqual([{ org: 1 }])
    expect((await t2.pull({ license: 'Q3-ZZZZ-ZZZZ-ZZZZ', branchId: B, afterSeq: 0 })).items.map((r) => r.payload)).toEqual([{ org: 2 }])
  })

  it('sessions: refreshed before expiry (listener told), expired token without refresh -> auth_failed, restore of a stale session refreshes it', async () => {
    const now = { t: T0 }
    const { server, tx } = mk(1, now)
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    const stored: string[] = []
    t.onSessionChange((s) => stored.push(s.accessToken))
    const first = t.currentSession()!
    now.t += 3600 * 1000 - 30_000 // 30 s left: inside the 60 s refresh margin
    await t.touch({ license: KEY, branchId: A })
    expect(t.currentSession()!.accessToken).not.toBe(first.accessToken)
    expect(stored).toEqual([t.currentSession()!.accessToken])
    // a stored session that is already expired is refreshed by restoreSession
    const t2 = new InMemorySharedTransport(server)
    now.t += 2 * 3600 * 1000
    const restored = await t2.restoreSession(t.currentSession()!)
    expect(restored.accessToken).not.toBe(t.currentSession()!.accessToken)
    // refresh token already used -> auth_failed
    expect(await kind(new InMemorySharedTransport(server).restoreSession(t.currentSession()!))).toBe('auth_failed')
    server.dropRefreshTokens()
    expect(await kind(t2.restoreSession({ ...restored, expiresAt: 0 }))).toBe('auth_failed')
  })

  it('a paused server and an offline network are different errors', async () => {
    const { server, tx } = mk()
    const t = tx(1)
    await branch(t, 1, A, 'AA')
    server.setPaused(true)
    expect(await kind(t.touch({ license: KEY, branchId: A }))).toBe('server_paused')
    expect(await kind(tx(1).signIn({ email: 'seat1@example.com', password: 'pw-1' }))).toBe('server_paused')
    server.setPaused(false)
    server.setOffline(true)
    expect(await kind(t.touch({ license: KEY, branchId: A }))).toBe('offline')
    server.setOffline(false)
    expect((await t.touch({ license: KEY, branchId: A })).serverTime).toBe(new Date(T0).toISOString())
  })

  it('two branches converge: both edit the same record, the later edited_at wins, the loser is kept in history', async () => {
    const { server, orgId, tx } = mk()
    const t1 = tx(1), t2 = tx(2)
    await branch(t1, 1, A, 'AA')
    await branch(t2, 2, B, 'BB')
    await t1.push({ license: KEY, branchId: A, items: [item({ payloadHash: 'hash-v1v1', payload: { v: 1 } })] })
    const base = (await t2.pull({ license: KEY, branchId: B, afterSeq: 0 })).items[0]!.version
    const r1 = await t1.push({ license: KEY, branchId: A, items: [item({ baseVersion: base, payloadHash: 'hash-fromA', payload: { v: 'A' }, editedAt: new Date(T0 + 1000).toISOString() })] })
    const r2 = await t2.push({ license: KEY, branchId: B, items: [item({ baseVersion: base, payloadHash: 'hash-fromB', payload: { v: 'B' }, editedAt: new Date(T0 + 2000).toISOString() })] })
    expect([r1[0]!.outcome, r2[0]!.outcome]).toEqual(['accepted', 'won'])
    expect(server.record(orgId, 'bill', R(1))!.payload).toEqual({ v: 'B' })
    expect(server.historyOf(orgId, 'bill', R(1)).map((h) => h.reason)).toEqual(['superseded', 'conflict_loser'])
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// SupabaseSharedTransport against a fake client (no network): wire shape, error mapping, retries, secrets
// ---------------------------------------------------------------------------------------------------------------------

type Reply = { data?: unknown; error?: { message?: string; code?: string; status?: number } | null; status?: number } | Error | 'hang'
function fake(replies: Reply[], opts: { auth?: Partial<SupabaseLike['auth']> } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const channels: string[] = []
  const client: SupabaseLike = {
    rpc(fn, args) {
      calls.push({ fn, args })
      const r = replies.shift() ?? { data: null, error: null }
      let signal: AbortSignal | undefined
      type Res = { data: unknown; error: null | { message?: string; code?: string; status?: number }; status?: number }
      const p: PromiseLike<Res> & { abortSignal(s: AbortSignal): unknown } = {
        abortSignal(s) { signal = s; return p },
        then(res, rej) {
          const run = new Promise<Res>((ok, bad) => {
            if (r === 'hang') signal?.addEventListener('abort', () => bad(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })))
            else if (r instanceof Error) bad(r)
            else ok({ data: r.data ?? null, error: r.error ?? null, ...(r.status !== undefined ? { status: r.status } : {}) })
          })
          return run.then(res, rej)
        }
      }
      return p as never
    },
    auth: {
      signInWithPassword: async () => ({ data: { session: { access_token: 'AT', refresh_token: 'RT', expires_at: 4_000_000_000, user: { id: 'u1' } } }, error: null }),
      setSession: async () => ({ data: { session: { access_token: 'AT2', refresh_token: 'RT2', expires_at: 4_000_000_000, user: { id: 'u1' } } }, error: null }),
      refreshSession: async () => ({ data: { session: { access_token: 'AT3', refresh_token: 'RT3', expires_at: 4_000_000_000, user: { id: 'u1' } } }, error: null }),
      signOut: async () => ({ error: null }),
      ...opts.auth
    },
    channel(name) { channels.push(name); const ch = { on: () => ch, subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return ch } }; return ch },
    removeChannel: async () => 'ok',
    realtime: { setAuth: () => undefined }
  }
  return { client, calls, channels }
}
const sb = (f: ReturnType<typeof fake>, over: { attempts?: number; timeoutMs?: number } = {}) =>
  new SupabaseSharedTransport({ url: 'https://abcd.supabase.co', anonKey: 'anon', factory: () => f.client, sleep: async () => undefined, attempts: 2, ...over })
const SCOPE = { license: KEY, branchId: A }

describe('SupabaseSharedTransport (fake client)', () => {
  it('sign-in returns the session; a wrong login is auth_failed; the stored seat password never reaches an error message', async () => {
    const f = fake([], { auth: { signInWithPassword: async () => ({ data: { session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }) } })
    let msg = ''
    try { await sb(f).signIn({ email: 'a@b.co', password: 'SEKRET-PW' }) } catch (e) { msg = (e as Error).message; expect((e as SharedTransportError).kind).toBe('auth_failed') }
    expect(msg).not.toContain('SEKRET-PW')
    const ok = await sb(fake([])).signIn({ email: 'a@b.co', password: 'x' })
    expect(ok).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 4_000_000_000, userId: 'u1' })
  })

  it('sends snake_case RPC arguments and maps the replies back', async () => {
    const f = fake([
      { data: { org_id: R(50), seat_no: 2, server_time: '2026-10-12T10:00:00Z', max_server_seq: 7, branches: [{ branch_id: A, name: 'Main', po_prefix: 'AA' }] } },
      { data: [{ kind: 'bill', rec_id: R(1), outcome: 'won', version: 4, server_seq: 9 }] },
      { data: { items: [{ kind: 'bill', rec_id: R(1), version: 4, server_seq: 9, deleted: false, payload: { a: 1 }, payload_hash: 'h', schema_ver: 1, min_reader_ver: 1, app_ver: '1', edited_at: '2026-10-12T10:00:00Z', from_branch: A }], has_more: true, server_time: '2026-10-12T10:00:01Z' } },
      { data: [{ rec_id: R(1), version: 4, payload_hash: 'h', server_seq: 9, deleted: true }] },
      { data: [{ branch_id: A, name: 'Main', po_prefix: 'AA', device_name: null, last_seen_at: null }] },
      { data: true }, { data: '2026-10-12T10:00:00Z' }
    ])
    const t = sb(f)
    expect(await t.activate({ ...SCOPE, name: 'Main', poPrefix: 'AA', device: 'PC', takeover: true })).toEqual({ orgId: R(50), seatNo: 2, serverTime: '2026-10-12T10:00:00Z', maxServerSeq: 7, branches: [{ branchId: A, name: 'Main', poPrefix: 'AA' }] })
    expect(f.calls[0]).toEqual({ fn: 'sn_activate', args: { p_license: KEY, p_branch_id: A, p_name: 'Main', p_po_prefix: 'AA', p_device: 'PC', p_takeover: true } })
    expect(await t.push({ ...SCOPE, items: [item({ baseVersion: 3 })] })).toEqual([{ kind: 'bill', recId: R(1), outcome: 'won', version: 4, serverSeq: 9 }])
    expect(f.calls[1]!.args.p_items).toEqual([{ kind: 'bill', rec_id: R(1), base_version: 3, payload: { n: 1 }, payload_hash: 'hash-aaaa', schema_ver: 1, min_reader_ver: 1, app_ver: '1', edited_at: new Date(T0).toISOString(), deleted: false }])
    const p = await t.pull({ ...SCOPE, afterSeq: 5 })
    expect(f.calls[2]).toEqual({ fn: 'sn_pull', args: { p_license: KEY, p_branch_id: A, p_after_seq: 5, p_limit: 200 } })
    expect(p.hasMore).toBe(true)
    expect(p.items[0]).toMatchObject({ recId: R(1), payloadHash: 'h', fromBranch: A, appVer: '1' })
    expect(await t.manifest({ ...SCOPE, kind: 'bill' })).toEqual([{ recId: R(1), version: 4, payloadHash: 'h', serverSeq: 9, deleted: true }])
    expect(f.calls[3]!.args).toEqual({ p_license: KEY, p_branch_id: A, p_kind: 'bill', p_after_rec_id: null, p_limit: 1000 })
    expect(await t.listBranches(SCOPE)).toEqual([{ branchId: A, name: 'Main', poPrefix: 'AA', deviceName: '', lastSeenAt: null }])
    expect(await t.branchNameFree({ license: KEY, name: 'X' })).toBe(true)
    expect(f.calls[5]!.args).toEqual({ p_license: KEY, p_name: 'X', p_branch_id: null })
    expect((await t.now()).serverTime).toBe('2026-10-12T10:00:00Z')
  })

  it('maps SQLSTATE answers and never retries them', async () => {
    for (const [code, expected] of [['Q3L01', 'license'], ['Q3A01', 'not_member'], ['Q3B04', 'name_taken'], ['Q3B05', 'seat_in_use'], ['Q3B02', 'prefix_taken'], ['Q3R01', 'too_large']] as const) {
      const f = fake([{ error: { code, message: 'whatever', status: 400 }, status: 400 }, { data: [] }])
      expect(await kind(sb(f).touch(SCOPE))).toBe(expected)
      expect(f.calls).toHaveLength(1)
    }
  })

  it('maps HTTP failures: paused (540), 5xx, expired JWT, wrong anon key, function missing', async () => {
    const run = async (r: Reply) => kind(sb(fake([r, r]), { attempts: 1 }).touch(SCOPE))
    expect(await run({ error: { message: 'x' }, status: 540 })).toBe('server_paused')
    expect(await run({ error: { message: 'Internal' }, status: 500 })).toBe('server')
    expect(await run({ error: { message: 'JWT expired' }, status: 401 })).toBe('auth_failed')
    expect(await run({ error: { message: 'Invalid API key' }, status: 401 })).toBe('anon_key')
    expect(await run({ error: { message: 'no function', code: 'PGRST202' }, status: 404 })).toBe('not_installed')
    expect(await run({ error: { message: 'TypeError: fetch failed' }, status: 0 })).toBe('offline')
    expect(await run(new Error('getaddrinfo ENOTFOUND abcd.supabase.co'))).toBe('offline')
  })

  it('retries transient failures only, then succeeds', async () => {
    const f = fake([{ error: { message: 'Bad gateway' }, status: 502 }, { data: { server_time: '2026-10-12T10:00:00Z' } }])
    expect((await sb(f).touch(SCOPE)).serverTime).toBe('2026-10-12T10:00:00Z')
    expect(f.calls).toHaveLength(2)
    const g = fake([new Error('fetch failed'), new Error('fetch failed'), { data: { server_time: 'x' } }])
    expect(await kind(sb(g, { attempts: 2 }).touch(SCOPE))).toBe('offline')
    expect(g.calls).toHaveLength(2)
  })

  it('a call that never answers ends as timeout', async () => {
    const f = fake(['hang'])
    expect(await kind(sb(f, { attempts: 1, timeoutMs: 20 }).touch(SCOPE))).toBe('timeout')
  })

  it('a reply of the wrong shape is a server error, not trusted data', async () => {
    expect(await kind(sb(fake([{ data: { items: 'nope' } }])).pull({ ...SCOPE, afterSeq: 0 }))).toBe('server')
    expect(await kind(sb(fake([{ data: [] }])).push({ ...SCOPE, items: [item()] }))).toBe('server') // count mismatch
  })

  it('refreshes an expiring session before the call and tells the listener', async () => {
    const f = fake([{ data: { server_time: 'x' } }], {
      auth: { signInWithPassword: async () => ({ data: { session: { access_token: 'OLD', refresh_token: 'RT', expires_at: Math.floor(Date.now() / 1000) + 10, user: { id: 'u1' } } }, error: null }) }
    })
    const t = sb(f)
    const seen: string[] = []
    t.onSessionChange((s) => seen.push(s.accessToken))
    await t.signIn({ email: 'a@b.co', password: 'x' })
    await t.touch(SCOPE)
    expect(seen).toEqual(['AT3'])
  })

  it('restoreSession reports a refresh through the listener only when the token changed; a revoked refresh token is auth_failed', async () => {
    const t = sb(fake([]))
    const seen: string[] = []
    t.onSessionChange((s) => seen.push(s.accessToken))
    const s = await t.restoreSession({ accessToken: 'AT2', refreshToken: 'x', expiresAt: 1, userId: 'u1' })
    expect(s.accessToken).toBe('AT2')
    expect(seen).toEqual([])
    const bad = sb(fake([], { auth: { setSession: async () => ({ data: { session: null }, error: { message: 'Invalid Refresh Token: Refresh Token Not Found', code: 'refresh_token_not_found', status: 400 } }) } }))
    expect(await kind(bad.restoreSession({ accessToken: 'a', refreshToken: 'b', expiresAt: 1, userId: 'u' }))).toBe('auth_failed')
  })

  it('the doorbell subscribes to sn_ping of the organisation and reports live / not live', async () => {
    const f = fake([])
    const live: boolean[] = []
    const off = sb(f).subscribeDoorbell({ orgId: R(50) }, () => undefined, (l) => live.push(l))
    await new Promise((r) => setTimeout(r, 5))
    expect(f.channels).toEqual([`sn_ping:${R(50)}`])
    off()
    expect(live).toEqual([true, false])
  })
})

describe('import boundaries (Phase 132)', () => {
  it('only sharedTransport.ts imports @supabase/supabase-js; the renderer and shared code never do', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join, resolve } = await import('node:path')
    const root = resolve(__dirname, '..', '..', '..')
    const hits: string[] = []
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== '__tests__') walk(p) } else if (/\.tsx?$/.test(n) && /from '@supabase\/supabase-js'|import\('@supabase\/supabase-js'\)/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length + 1).replace(/\\/g, '/'))
      }
    }
    walk(root)
    expect(hits).toEqual(['main/sync/sharedTransport.ts'])
  })
})
