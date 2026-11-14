import { describe, expect, it } from 'vitest'
import type { BranchRepo, BranchInfo } from '../../db/branchRepo'
import type { SyncStateRepo } from '../../db/syncStateRepo'
import { createSharedActivation, RECREDENTIAL_GAP_MS, SEAT_REMOVED_WORDS, SHARED_KEYS, type SharedActivation, type SharedActivationDeps } from '../activationV2'
import type { SecretStore } from '../secretStore'
import { InMemorySharedServer, InMemorySharedTransport } from '../sharedTransport'

/** Phase 267: silent re-credential on auth_failed. Invented strings only; the master is a fake (no network, no real Supabase). */
const KEY = 'Q3-ABCD-EFGH-JKLM'
const URL_OK = 'https://abcd.supabase.co'
const PW = 'S3kret-Pass-Word'
const NEW_PW = 'Fresh-Invented-Pass-99'
const T0 = 1_700_000_000_000
const EMAIL = 'seat2@example.com'

const fakeSecrets = (): SecretStore => ({
  available: () => true,
  encrypt: (s) => `enc:${Buffer.from(s).reverse().toString('base64')}`,
  decrypt: (b) => Buffer.from(b.slice(4), 'base64').reverse().toString()
})
function memSync(): SyncStateRepo {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), setMany: (e) => { for (const [k, v] of Object.entries(e)) m.set(k, v) }, remove: (ks) => { for (const k of ks) m.delete(k) }, keys: (p) => [...m.keys()].filter((k) => k.startsWith(p)) }
}
const branches = (): BranchRepo => {
  const b: BranchInfo = { id: '11111111-1111-4111-8111-111111111111', name: 'Local', poPrefix: 'Q3-', nextSeq: 1 }
  return { local: () => b, otherPrefixes: () => [], setPrefix: () => undefined, audit: () => undefined }
}
type Outcome = Awaited<ReturnType<NonNullable<SharedActivationDeps['recredential']>['refresh']>>

async function setup(o: { token?: boolean; recred?: boolean } = {}) {
  const now = { t: T0 }
  const server = new InMemorySharedServer({ now: () => now.t })
  server.addOrg({ licenseKey: KEY, seats: [{ email: 'seat1@example.com', password: 'pw1' }, { email: EMAIL, password: PW }] })
  const logs: string[] = []
  const log = { info: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), warn: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), error: (m: string) => logs.push(m) }
  const calls = { refresh: 0 }
  const master: { next: () => Outcome | Promise<Outcome> } = { next: () => ({ ok: true, legacy: false, applied: true }) }
  const ref: { svc: SharedActivation | null } = { svc: null }
  const svc = createSharedActivation({
    sync: memSync(), branches: branches(), secrets: fakeSecrets(), makeTransport: () => new InMemorySharedTransport(server), log, deviceName: () => 'TEST-PC',
    ...(o.recred === false ? {} : {
      recredential: {
        hasDeviceToken: () => o.token !== false,
        refresh: async () => {
          calls.refresh++
          const out = await master.next()
          // the real master service hands the new password to this port before it answers
          if (out.ok && out.applied) ref.svc!.storeSeatPassword(NEW_PW)
          return out
        }
      }
    })
  }, { now: () => new Date(now.t) })
  ref.svc = svc
  await svc.activate({ supabaseUrl: URL_OK, anonKey: 'public-anon-key', licenseKey: KEY, email: EMAIL, password: PW, branchName: 'Shop two', poPrefix: 'S2' })
  const reset = (): void => { server.setSeatPassword(EMAIL, NEW_PW); server.expireAccessTokens() }
  return { svc, server, now, logs, calls, master, reset }
}
const fail = async (p: Promise<unknown>): Promise<{ code?: string; message?: string }> => { try { await p; return {} } catch (e) { return e as { code?: string; message?: string } } }

describe('activationV2 silent re-credential (Phase 267)', () => {
  it('reset mid-run: one master refresh, the new password is stored, the retry connects and the link is ok', async () => {
    const c = await setup()
    c.reset() // the OLD password is dead; the server now holds the master's new one
    const r = await c.svc.connect()
    expect(r.creds.email).toBe(EMAIL)
    expect(c.calls.refresh).toBe(1)
    expect((await c.svc.status()).link.state).toBe('ok')
  })

  it('after the reset the password lives in the same wrapped login blob and appears in no log', async () => {
    const c = await setup()
    c.reset()
    await c.svc.connect()
    expect(c.logs.join('|')).not.toContain(NEW_PW)
    expect(c.logs.join('|')).not.toContain(PW)
    await c.svc.connect() // a later connect works from the stored session / new password with no second master call
    expect(c.calls.refresh).toBe(1)
  })

  it('master unreachable: the old behaviour (auth failed, paused), ONE attempt per 60 s, another after the gap', async () => {
    const c = await setup()
    c.master.next = () => ({ ok: false, code: 'Q3M90', message: 'Master unreachable.' })
    c.reset()
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    expect(c.calls.refresh).toBe(1) // the second call is inside the 60 s gap
    c.now.t += RECREDENTIAL_GAP_MS + 1
    await fail(c.svc.connect())
    expect(c.calls.refresh).toBe(2)
  })

  it('offline reset then master back: the next connect after the gap recovers by itself', async () => {
    const c = await setup()
    let up = false
    c.master.next = () => (up ? { ok: true, legacy: false, applied: true } : { ok: false, code: 'Q3M90', message: 'Master unreachable.' })
    c.reset()
    await fail(c.svc.connect())
    up = true; c.now.t += RECREDENTIAL_GAP_MS + 1
    const r = await c.svc.connect()
    expect(r.creds.email).toBe(EMAIL)
    expect(c.calls.refresh).toBe(2)
  })

  it('seat removed (Q3M07): the plain words, link shows the problem, and no retry loop inside the gap', async () => {
    const c = await setup()
    c.master.next = () => ({ ok: false, code: 'Q3M07', message: 'x' })
    c.reset()
    const e = await fail(c.svc.connect())
    expect(e.code).toBe('AUTH_FAILED')
    expect(e.message).toBe(SEAT_REMOVED_WORDS)
    expect(SEAT_REMOVED_WORDS).toBe('This seat was removed. Ask the admin for a new code.')
    const st = await c.svc.status()
    expect(st.link.state).toBe('license_problem')
    expect(st.link.message).toBe(SEAT_REMOVED_WORDS)
    expect((await fail(c.svc.connect())).message).toBe(SEAT_REMOVED_WORDS)
    expect(c.calls.refresh).toBe(1)
  })

  it('master throws or answers legacy / not applied: the old auth failure, never a crash', async () => {
    const c = await setup()
    c.master.next = () => { throw new Error('boom') }
    c.reset()
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    c.now.t += RECREDENTIAL_GAP_MS + 1
    c.master.next = () => ({ ok: true, legacy: true, applied: false })
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    expect(c.calls.refresh).toBe(2)
  })

  it('no device token: unchanged behaviour, the master is never asked', async () => {
    const c = await setup({ token: false })
    c.reset()
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    expect(c.calls.refresh).toBe(0)
  })

  it('no re-credential wired (old setup): unchanged behaviour', async () => {
    const c = await setup({ recred: false })
    c.reset()
    expect((await fail(c.svc.connect())).code).toBe('AUTH_FAILED')
    expect(c.calls.refresh).toBe(0)
  })

  it('push, pull and doorbell connecting together share ONE master call', async () => {
    const c = await setup()
    c.master.next = async () => { await new Promise((r) => setTimeout(r, 5)); return { ok: true, legacy: false, applied: true } }
    c.reset()
    const all = await Promise.all([c.svc.connect(), c.svc.connect(), c.svc.connect()])
    expect(all.length).toBe(3)
    expect(c.calls.refresh).toBe(1)
  })

  it('storeSeatPassword refuses an empty password and a PC that is not activated', async () => {
    const c = await setup()
    expect(c.svc.storeSeatPassword('')).toBe(false)
    expect(c.svc.storeSeatPassword('abc-new', EMAIL)).toBe(true)
    expect(SHARED_KEYS.loginBlob).toBe('shared.loginBlob')
  })
})
