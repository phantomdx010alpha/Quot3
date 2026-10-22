import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { PhoneSyncError, toSyncFailure } from '../sync/errors'
import { createLazyPort, createPhoneSyncRuntime } from '../sync/runtime'
import { PhoneSupabaseTransport, type PhoneSupabaseLike, type RpcCallLike } from '../sync/supabaseTransport'
import { bootstrapServices } from '../ui/bootstrap'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const URL_ = 'https://example-project.supabase.co'
const ANON = 'invented-anon-key-for-tests'
const NOW0 = Date.parse('2026-10-21T10:00:00.000Z')
const UUID1 = '11111111-1111-4111-8111-111111111111'

const form = { supabaseUrl: URL_, anonKey: ANON, licenseKey: LICENSE, email: 'seat1@example.test', password: 'pw-1-secret', branchName: 'Android phone', poPrefix: 'PH' }

function world() {
  const server = new InMemorySharedServer({ now: () => NOW0 })
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats: [{ email: 'seat1@example.test', password: 'pw-1-secret' }] })
  return { server, orgId }
}

async function runtimeFor(server: InMemorySharedServer, db?: Awaited<ReturnType<typeof openPhoneDb>>) {
  const d = db ?? (await openPhoneDb({ factory: new IDBFactory() }))
  const rt = createPhoneSyncRuntime({ db: d, appVer: '0.1.29-test', makeTransport: () => new InMemorySharedTransport(server), engine: { storage: async () => ({ quota: null, usage: null }), pollMs: 3_600_000 } })
  return { db: d, rt }
}

describe('phone sync runtime (in-memory shared notebook; NOT real Supabase)', () => {
  it('the lazy port refuses with "sign in again" until it is configured', async () => {
    const port = createLazyPort(undefined, () => { throw new Error('unused') })
    await expect(port.now()).rejects.toBeInstanceOf(PhoneSyncError)
    expect(port.isConfigured()).toBe(false)
    expect(toSyncFailure(await port.now().catch((e) => e)).kind).toBe('auth_failed')
  })

  it('link -> first sync needed -> first sync -> running; sign-out stops it', async () => {
    const w = world()
    const { db, rt } = await runtimeFor(w.server)
    const r = await rt.link(form)
    expect(r.ok).toBe(true)
    expect(rt.engine.state()).toBe('first_sync_needed')
    const preview = await rt.engine.prepareFirstSync()
    await rt.engine.completeFirstSync(preview, preview.assessment.recommended)
    expect(rt.engine.state()).toBe('running')
    expect((await getMeta(db)).org_id).toBe(w.orgId)
    await rt.signOut()
    expect(rt.engine.state()).toBe('stopped')
    expect((await rt.vault.load())?.session ?? null).toBeNull()
  })

  it('a restart (new runtime on the same database) restores the login and runs by itself', async () => {
    const w = world()
    const first = await runtimeFor(w.server)
    await first.rt.link(form)
    const p = await first.rt.engine.prepareFirstSync()
    await first.rt.engine.completeFirstSync(p, p.assessment.recommended)
    first.rt.engine.stop()
    const second = await runtimeFor(w.server, first.db)
    await second.rt.init()
    expect(second.rt.engine.state()).toBe('running')
    second.rt.engine.stop()
  })

  it('a wrong password is refused with a plain message and leaves the phone unlinked', async () => {
    const w = world()
    const { db, rt } = await runtimeFor(w.server)
    const r = await rt.link({ ...form, password: 'wrong-password-1' })
    expect(r.ok).toBe(false)
    expect((await getMeta(db)).org_id).toBeNull()
  })

  it('a bad field is refused before any network call', async () => {
    const w = world()
    const { rt } = await runtimeFor(w.server)
    const r = await rt.link({ ...form, supabaseUrl: 'not a url' })
    expect(r.ok).toBe(false)
    expect(rt.port.isConfigured()).toBe(false)
  })

  it('bootstrap runs once per page (a second call gets the same result, so the writer lock is asked for once)', () => {
    expect(bootstrapServices()).toBe(bootstrapServices())
  })
})

// ------------------------------------------------------------------------------------------------ the real transport, with a fake client

interface Call { fn: string; args: Record<string, unknown> }
function fakeClient(script: (c: Call, n: number) => { data?: unknown; error?: { message?: string; code?: string; status?: number } | null; status?: number }) {
  const calls: Call[] = []
  const channels: { name: string; filter?: unknown; status?: (s: string) => void; removed: boolean }[] = []
  const client: PhoneSupabaseLike = {
    rpc(fn, args) {
      const c: Call = { fn, args }
      calls.push(c)
      const res = script(c, calls.length)
      const out: RpcCallLike = { abortSignal: () => out, then: (ok, bad) => Promise.resolve({ data: res.data ?? null, error: res.error ?? null, status: res.status }).then(ok, bad) }
      return out
    },
    auth: {
      signInWithPassword: async ({ password }) => password === 'pw' ? { data: { session: { access_token: 'a1', refresh_token: 'r1', expires_at: 4_000_000_000, user: { id: UUID1 } } }, error: null } : { data: { session: null }, error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 } },
      setSession: async (t) => ({ data: { session: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: 4_000_000_000, user: { id: UUID1 } } }, error: null }),
      refreshSession: async () => ({ data: { session: { access_token: 'a2', refresh_token: 'r2', expires_at: 4_000_000_000, user: { id: UUID1 } } }, error: null }),
      signOut: async () => ({ error: null })
    },
    channel(name) {
      const ch = { name, removed: false } as (typeof channels)[number]
      channels.push(ch)
      const api = {
        on: (_t: 'postgres_changes', filter: unknown) => { ch.filter = filter; return api },
        subscribe: (cb?: (s: string) => void) => { ch.status = cb; cb?.('SUBSCRIBED'); return api }
      }
      return api
    },
    removeChannel: async (c) => { const ch = channels.find((x) => x === (c as unknown) || x.name !== ''); if (ch) ch.removed = true },
    realtime: { setAuth: () => undefined }
  }
  return { client, calls, channels }
}

const transportFor = (client: PhoneSupabaseLike, extra: { attempts?: number } = {}) =>
  new PhoneSupabaseTransport({ url: URL_, anonKey: ANON, factory: () => client, sleep: async () => undefined, now: () => NOW0, ...extra })

describe('PhoneSupabaseTransport (fake client; real Supabase not touched)', () => {
  it('signs in and maps a refused password to auth_failed', async () => {
    const f = fakeClient(() => ({}))
    const t = transportFor(f.client)
    expect((await t.signIn({ email: 'a@b.test', password: 'pw' })).userId).toBe(UUID1)
    const e = await t.signIn({ email: 'a@b.test', password: 'bad' }).catch((x) => x)
    expect(toSyncFailure(e).kind).toBe('auth_failed')
  })

  it('sn_push sends the snake_case wire shape and returns outcomes in order', async () => {
    const f = fakeClient((c) => (c.fn === 'sn_push' ? { data: [{ kind: 'bill', rec_id: UUID1, outcome: 'accepted', version: 1, server_seq: 7 }] } : {}))
    const t = transportFor(f.client)
    await t.signIn({ email: 'a@b.test', password: 'pw' })
    const r = await t.push({ license: LICENSE, branchId: UUID1, items: [{ kind: 'bill', recId: UUID1, baseVersion: 0, payload: { a: 1 }, payloadHash: 'h', schemaVer: 1, minReaderVer: 1, appVer: '0.1.29', editedAt: '2026-10-21T10:00:00.000Z', deleted: false }] })
    expect(r).toEqual([{ kind: 'bill', recId: UUID1, outcome: 'accepted', version: 1, serverSeq: 7 }])
    const sent = f.calls.find((c) => c.fn === 'sn_push')!
    expect(sent.args).toMatchObject({ p_license: LICENSE, p_branch_id: UUID1 })
    expect((sent.args.p_items as Record<string, unknown>[])[0]).toMatchObject({ rec_id: UUID1, base_version: 0, payload_hash: 'h', edited_at: '2026-10-21T10:00:00.000Z' })
  })

  it('sn_pull maps rows back to camelCase', async () => {
    const f = fakeClient(() => ({ data: { items: [{ kind: 'party', rec_id: UUID1, version: 2, server_seq: 9, deleted: false, payload: { n: 'x' }, payload_hash: 'h', schema_ver: 1, min_reader_ver: 1, app_ver: null, edited_at: '2026-10-21T10:00:00.000Z', from_branch: null }], has_more: false, server_time: '2026-10-21T10:00:01.000Z' } }))
    const t = transportFor(f.client)
    const r = await t.pull({ license: LICENSE, branchId: UUID1, afterSeq: 0 })
    expect(r.items[0]).toMatchObject({ kind: 'party', recId: UUID1, serverSeq: 9, appVer: '', fromBranch: null })
    expect(r.hasMore).toBe(false)
  })

  it('retries a server hiccup (503) and then succeeds; a license refusal is not retried', async () => {
    let n = 0
    const f = fakeClient(() => (++n < 3 ? { error: { message: 'bad gateway', status: 503 }, status: 503 } : { data: '2026-10-21T10:00:00.000Z' }))
    const t = transportFor(f.client)
    expect((await t.now()).serverTime).toBe('2026-10-21T10:00:00.000Z')
    expect(f.calls).toHaveLength(3)

    const g = fakeClient(() => ({ error: { message: 'license', code: 'Q3L01', status: 400 }, status: 400 }))
    const t2 = transportFor(g.client)
    const e = await t2.now().catch((x) => x)
    expect(e).toBeInstanceOf(PhoneSyncError)
    expect(g.calls).toHaveLength(1)
  })

  it('a paused project is "server paused", not "offline"', async () => {
    const f = fakeClient(() => ({ error: { message: 'Project is paused', status: 540 }, status: 540 }))
    const e = await transportFor(f.client, { attempts: 1 }).now().catch((x) => x)
    expect(toSyncFailure(e).kind).toBe('server_paused')
  })

  it('a rejected fetch (no network) is "offline"', async () => {
    const f = fakeClient(() => { throw new TypeError('Failed to fetch') })
    const e = await transportFor(f.client, { attempts: 1 }).now().catch((x) => x)
    expect(toSyncFailure(e).kind).toBe('offline')
  })

  it('the doorbell listens to sn_ping for this organisation only and reports live / not live', async () => {
    const f = fakeClient(() => ({}))
    const t = transportFor(f.client)
    const live: boolean[] = []
    let rings = 0
    const off = t.subscribeDoorbell({ orgId: UUID1 }, () => { rings++ }, (l) => live.push(l))
    await new Promise((r) => setTimeout(r, 0))
    expect(f.channels[0]!.filter).toEqual({ event: '*', schema: 'public', table: 'sn_ping', filter: `org_id=eq.${UUID1}` })
    expect(live).toContain(true)
    off()
    expect(live[live.length - 1]).toBe(false)
    expect(rings).toBe(0)
  })
})
