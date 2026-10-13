import { describe, expect, it } from 'vitest'
import type { BranchRepo, BranchInfo } from '../../db/branchRepo'
import type { SyncStateRepo } from '../../db/syncStateRepo'
import { createSharedActivation, SHARED_KEYS, type SharedActivation } from '../activationV2'
import type { SecretStore } from '../secretStore'
import { InMemorySharedServer, InMemorySharedTransport } from '../sharedTransport'

const KEY = 'Q3-ABCD-EFGH-JKLM'
const URL_OK = 'https://abcd.supabase.co'
const ANON = 'public-anon-key'
const PW = 'S3kret-Pass-Word'
const T0 = 1_700_000_000_000
const BRANCH_ID = '11111111-1111-4111-8111-111111111111'

const fakeSecrets = (available = true): SecretStore => ({
  available: () => available,
  encrypt: (s) => `enc:${Buffer.from(s).reverse().toString('base64')}`,
  decrypt: (b) => { if (!b.startsWith('enc:')) throw new Error('bad blob'); return Buffer.from(b.slice(4), 'base64').reverse().toString() }
})
function memSync(): SyncStateRepo & { all(): Record<string, string> } {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k), set: (k, v) => void m.set(k, v), setMany: (e) => { for (const [k, v] of Object.entries(e)) m.set(k, v) },
    remove: (ks) => { for (const k of ks) m.delete(k) }, keys: (p) => [...m.keys()].filter((k) => k.startsWith(p)), all: () => Object.fromEntries(m)
  }
}
function memBranches(prefix = 'Q3-'): BranchRepo & { audits: { action: string; detailJson: string | null }[]; local_: BranchInfo } {
  const local_: BranchInfo = { id: BRANCH_ID, name: 'Local', poPrefix: prefix, nextSeq: 1 }
  const audits: { action: string; detailJson: string | null }[] = []
  return { audits, local_, local: () => local_, otherPrefixes: () => [], setPrefix: (_id, p) => { local_.poPrefix = p }, audit: (a) => void audits.push(a) }
}

const input = (over: Record<string, unknown> = {}) => ({ supabaseUrl: URL_OK, anonKey: ANON, licenseKey: KEY, email: 'seat1@example.com', password: PW, branchName: 'Main shop', poPrefix: 'MS', ...over })

function mk(o: { secrets?: boolean; writable?: boolean } = {}) {
  const now = { t: T0 }
  const server = new InMemorySharedServer({ now: () => now.t })
  const { orgId } = server.addOrg({ licenseKey: KEY, seats: [{ email: 'seat1@example.com', password: PW }, { email: 'seat2@example.com', password: 'pw2' }] })
  const sync = memSync()
  const branches = memBranches()
  const logs: string[] = []
  const log = { info: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), warn: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), error: (m: string) => logs.push(m) }
  const made: InMemorySharedTransport[] = []
  const svc: SharedActivation = createSharedActivation(
    { sync, branches, secrets: fakeSecrets(o.secrets ?? true), makeTransport: () => { const t = new InMemorySharedTransport(server); made.push(t); return t }, log, deviceName: () => 'TEST-PC' },
    { ...(o.writable === false ? { writable: false } : {}), now: () => new Date(now.t) }
  )
  return { svc, sync, branches, server, orgId, now, logs, made }
}
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none' } catch (e) { return (e as { code?: string }).code ?? 'other' } }

describe('activationV2 (Phase 132)', () => {
  it('activates: signs in, registers the branch, stores everything wrapped, status has masked hints only', async () => {
    const c = mk()
    const st = await c.svc.activate(input())
    expect(st).toMatchObject({ state: 'activated', orgId: c.orgId, seatNo: 1, licenseHint: 'Q3-ABCD-****-****', emailHint: 's***@example.com', host: 'abcd.supabase.co', link: { state: 'ok' } })
    expect(st.registered).toEqual({ branchId: BRANCH_ID, name: 'Main shop', poPrefix: 'MS' })
    expect(st.branches).toEqual([{ branchId: BRANCH_ID, name: 'Main shop', poPrefix: 'MS' }])
    expect(c.server.seatOf('seat1@example.com')!.branchId).toBe(BRANCH_ID)
    expect(c.svc.isActivated()).toBe(true)
    expect(c.svc.credentials()).toMatchObject({ url: URL_OK, anonKey: ANON, license: KEY, email: 'seat1@example.com', branchId: BRANCH_ID, orgId: c.orgId })
    expect(c.branches.local_.poPrefix).toBe('MS') // the registered prefix is now the local one
    expect(c.branches.audits.map((a) => a.action)).toEqual(['activate_shared'])
  })

  it('secrets: key, password and tokens are stored only wrapped, and appear nowhere in status, audit or logs', async () => {
    const c = mk()
    const st = await c.svc.activate(input())
    const session = c.made[0]!.currentSession()!
    const plainKeys = Object.entries(c.sync.all()).filter(([k]) => !k.endsWith('Blob')).map(([, v]) => v).join('|')
    const everything = JSON.stringify(c.sync.all())
    for (const secret of [KEY, PW, session.accessToken, session.refreshToken]) {
      expect(everything).not.toContain(secret)
      expect(plainKeys).not.toContain(secret)
      expect(JSON.stringify(st)).not.toContain(secret)
      expect(JSON.stringify(c.branches.audits)).not.toContain(secret)
      expect(c.logs.join('\n')).not.toContain(secret)
    }
    expect(JSON.stringify(st)).not.toContain('seat1@example.com')
    expect(JSON.stringify(st)).not.toContain(ANON)
    expect(c.sync.get(SHARED_KEYS.loginBlob)).toMatch(/^enc:/)
    expect(c.sync.get(SHARED_KEYS.sessionBlob)).toMatch(/^enc:/)
  })

  it('refuses without secure storage, in a read-only database, and for bad input - before any network call', async () => {
    expect(await code(mk({ secrets: false }).svc.activate(input()))).toBe('IO_ERROR')
    expect(await code(mk({ writable: false }).svc.activate(input()))).toBe('DB_ERROR')
    const c = mk()
    for (const bad of [{ supabaseUrl: 'http://evil.example.com' }, { anonKey: 'a.' + Buffer.from('{"role":"service_role"}').toString('base64url') + '.c' }, { licenseKey: 'nope' }, { email: 'nope' }, { password: '' }, { branchName: '  ' }, { poPrefix: 'bad prefix!' }]) {
      expect(await code(c.svc.activate(input(bad)))).toBe('VALIDATION')
    }
    expect(c.made).toHaveLength(0)
    expect(c.svc.isActivated()).toBe(false)
  })

  it('failures leave nothing stored and map to the right IPC code', async () => {
    const c = mk()
    expect(await code(c.svc.activate(input({ password: 'wrong' })))).toBe('AUTH_FAILED')
    expect(await code(c.svc.activate(input({ licenseKey: 'Q3-AAAA-AAAA-AAAA' })))).toBe('LICENSE_INVALID')
    c.server.setPaused(true)
    expect(await code(c.svc.activate(input()))).toBe('SERVER_PAUSED')
    c.server.setPaused(false)
    c.server.setOffline(true)
    expect(await code(c.svc.activate(input()))).toBe('SYNC_OFFLINE')
    c.server.setOffline(false)
    expect(c.svc.isActivated()).toBe(false)
    expect(Object.keys(c.sync.all())).toEqual([])
    expect(c.branches.audits).toEqual([])
    expect(c.branches.local_.poPrefix).toBe('Q3-')
  })

  it('name and prefix clashes come back as VALIDATION; a seat in use needs takeover', async () => {
    const c = mk()
    await c.svc.activate(input())
    // a second installation (another branch id) on the same seat
    const other = mk()
    other.server.addOrg({ licenseKey: 'Q3-ZZZZ-ZZZZ-ZZZZ', seats: [] })
    const s2 = new InMemorySharedTransport(c.server)
    await s2.signIn({ email: 'seat2@example.com', password: 'pw2' })
    const act = (name: string, poPrefix: string) => s2.activate({ license: KEY, branchId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name, poPrefix, device: '', takeover: false })
    await expect(act('main SHOP', 'ZZ')).rejects.toMatchObject({ kind: 'name_taken' })
    await expect(act('Other', 'ms')).rejects.toMatchObject({ kind: 'prefix_taken' })
    // the first seat re-installed on a new id: refused until takeover
    const reinstall = mk()
    const svc2 = createSharedActivation({ sync: memSync(), branches: { ...memBranches(), local: () => ({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'New', poPrefix: 'Q3-', nextSeq: 1 }) }, secrets: fakeSecrets(), makeTransport: () => new InMemorySharedTransport(c.server), log: { info() {}, warn() {}, error() {} } })
    expect(await code(svc2.activate(input()))).toBe('VALIDATION')
    const st = await svc2.activate(input({ takeover: true }))
    expect(st.registered!.branchId).toBe('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
    expect(reinstall.svc.isActivated()).toBe(false)
  })

  it('connect(): restores the stored session; a refreshed session is stored again', async () => {
    const c = mk()
    await c.svc.activate(input())
    const { transport, creds } = await c.svc.connect()
    expect((await transport.touch({ license: creds.license, branchId: creds.branchId })).serverTime).toBeTruthy()
    // expire the access token: the next connect refreshes it and stores the new session
    const before = c.sync.get(SHARED_KEYS.sessionBlob)
    c.now.t += 2 * 3600 * 1000
    const again = await c.svc.connect()
    expect(await again.transport.touch({ license: creds.license, branchId: creds.branchId })).toBeTruthy()
    expect(c.sync.get(SHARED_KEYS.sessionBlob)).not.toBe(before)
  })

  it('connect(): when the session is gone it signs in again with the stored seat password; a changed password is AUTH_FAILED', async () => {
    const c = mk()
    await c.svc.activate(input())
    c.now.t += 2 * 3600 * 1000
    c.server.dropRefreshTokens()
    const { transport, creds } = await c.svc.connect()
    expect(await transport.touch({ license: creds.license, branchId: creds.branchId })).toBeTruthy()
    // the owner resets the seat (new password): the stored one no longer works
    c.server.revokeSeat('seat1@example.com')
    c.server.addOrg({ licenseKey: 'Q3-ZZZZ-ZZZZ-ZZZZ', seats: [] })
    c.now.t += 2 * 3600 * 1000
    c.server.dropRefreshTokens()
    expect(await code(c.svc.connect())).toBe('AUTH_FAILED')
    const st = await c.svc.status()
    expect(st.link.state).toBe('license_problem')
  })

  it('connect(): offline or paused is reported as such and is NOT answered by signing in again', async () => {
    const c = mk()
    await c.svc.activate(input())
    c.now.t += 2 * 3600 * 1000
    c.server.setOffline(true)
    expect(await code(c.svc.connect())).toBe('SYNC_OFFLINE')
    c.server.setOffline(false)
    c.server.setPaused(true)
    expect(await code(c.svc.connect())).toBe('SERVER_PAUSED')
    expect((await c.svc.status()).link.state).toBe('server_problem')
  })

  it('connect() before activation is refused', async () => {
    expect(await code(mk().svc.connect())).toBe('LICENSE_INVALID')
  })

  it('status({check}) contacts the server, refreshes the branch list and the link state', async () => {
    const c = mk()
    await c.svc.activate(input())
    const s2 = new InMemorySharedTransport(c.server)
    await s2.signIn({ email: 'seat2@example.com', password: 'pw2' })
    await s2.activate({ license: KEY, branchId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Second', poPrefix: 'BB', device: '', takeover: false })
    const st = await c.svc.status({ check: true })
    expect(st.branches.map((b) => b.poPrefix)).toEqual(['BB', 'MS'])
    expect(st.link.state).toBe('ok')
    c.server.setOffline(true)
    expect((await c.svc.status({ check: true })).link.state).toBe('offline')
  })

  it('deactivate needs the word, wipes only shared.* keys and is audited', async () => {
    const c = mk()
    await c.svc.activate(input())
    c.sync.set('license.orgId', 'v1-value')
    expect(await code(c.svc.deactivate({ confirm: 'nope' }))).toBe('VALIDATION')
    const st = await c.svc.deactivate({ confirm: ' deactivate ' })
    expect(st.state).toBe('not_activated')
    expect(Object.keys(c.sync.all())).toEqual(['license.orgId']) // v1 keys untouched until Phase 142
    expect(c.branches.audits.map((a) => a.action)).toEqual(['activate_shared', 'deactivate_shared'])
    expect(c.svc.credentials()).toBeNull()
  })
})
