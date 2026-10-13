import { afterEach, describe, expect, it } from 'vitest'
import { openTestDb, type TestDb } from '../../db/__tests__/helpers'
import { createBranchRepo } from '../../db/branchRepo'
import { createSyncStateRepo } from '../../db/syncStateRepo'
import { licenseHandlers } from '../../ipc/license'
import { createLicenseService, SYNC_KEYS, type LicenseService } from '../licenseService'
import { deriveKey, open as openSealed, seal } from '../crypto'
import { InMemoryTransport } from '../transport'
import type { SecretStore } from '../secretStore'

const KEY = 'Q3-ABCD-EFGH-JKLM'
const URL_OK = 'https://abcd.supabase.co'
const ANON = 'public-anon-key'
const PASS = 'correct horse battery'
const input = (over: Partial<Record<'supabaseUrl' | 'anonKey' | 'licenseKey' | 'passphrase', string>> = {}) => ({ supabaseUrl: URL_OK, anonKey: ANON, licenseKey: KEY, passphrase: PASS, ...over })

const open: TestDb[] = []
afterEach(() => { open.splice(0).forEach((t) => t.cleanup()) })

/** Reversible fake: the stored text is never the plain secret. */
const fakeSecrets = (available = true): SecretStore => ({
  available: () => available,
  encrypt: (s) => `enc:${Buffer.from(s).reverse().toString('base64')}`,
  decrypt: (b) => { if (!b.startsWith('enc:')) throw new Error('bad blob'); return Buffer.from(b.slice(4), 'base64').reverse().toString() }
})

function mk(over: { writable?: boolean; secrets?: boolean; transport?: InMemoryTransport } = {}) {
  const t = openTestDb(); open.push(t)
  const transport = over.transport ?? new InMemoryTransport()
  if (!over.transport) transport.addLicense(KEY)
  const sync = createSyncStateRepo(t.handle.sqlite)
  const branches = createBranchRepo(t.handle.sqlite)
  const made: { url: string; anonKey: string }[] = []
  const logs: string[] = []
  const log = { info: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), warn: (m: string, x?: unknown) => logs.push(m + JSON.stringify(x ?? '')), error: (m: string) => logs.push(m) }
  const svc: LicenseService = createLicenseService(
    { sync, branches, kdfIterations: 1000, secrets: fakeSecrets(over.secrets ?? true), makeTransport: (c) => { made.push(c); return transport }, log, deviceName: () => 'TEST-PC' },
    { ...(over.writable === false ? { writable: false } : {}), now: () => new Date('2026-10-09T10:00:00Z') }
  )
  return { t, svc, sync, branches, transport, made, logs }
}
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'none' } catch (e) { return (e as { code?: string }).code ?? 'other' } }

describe('licenseService - encryption key (Phase 53)', () => {
  it('derives and caches the key at activation; the passphrase is never stored', async () => {
    const c = mk()
    expect(c.svc.encryptionKey()).toBeNull()
    await c.svc.activate(input())
    const key = c.svc.encryptionKey()!
    expect(key.length).toBe(32)
    const salt = c.sync.get(SYNC_KEYS.kdfSalt)!
    expect((await deriveKey(PASS, salt, 1000)).equals(key)).toBe(true)
    expect((await deriveKey('another passphrase', salt, 1000)).equals(key)).toBe(false)
    expect(c.sync.get(SYNC_KEYS.passphraseBlob)).toBeUndefined()
    const stored = JSON.stringify([c.sync.get(SYNC_KEYS.encKeyBlob), c.sync.get(SYNC_KEYS.encKeyCheck)])
    expect(stored).not.toContain(PASS)
    expect(stored).not.toContain(key.toString('base64'))
    expect(JSON.stringify(await c.svc.status())).not.toContain(key.toString('hex'))
  })

  it('a damaged cache reads as no key, and deactivate wipes it', async () => {
    const c = mk()
    await c.svc.activate(input())
    expect((await c.svc.status()).passphraseSaved).toBe(true)
    c.sync.set(SYNC_KEYS.encKeyBlob, 'garbage')
    expect(c.svc.encryptionKey()).toBeNull()
    expect((await c.svc.status()).passphraseSaved).toBe(false)
    await c.svc.deactivate({ confirm: 'DEACTIVATE' })
    expect(c.sync.get(SYNC_KEYS.encKeyBlob)).toBeUndefined()
    expect(c.svc.encryptionKey()).toBeNull()
  })

  it('a key sealed on one branch opens on another that used the same passphrase and salt', async () => {
    const c = mk()
    await c.svc.activate(input())
    const sealed = seal(c.svc.encryptionKey()!, { a: 1 }, 'bill-1', 3)
    const other = await deriveKey(PASS, c.sync.get(SYNC_KEYS.kdfSalt)!, 1000)
    expect(openSealed(other, sealed, 'bill-1', 3)).toEqual({ a: 1 })
  })
})

describe('licenseService (Phase 52)', () => {
  it('starts not activated and says whether secrets can be protected', async () => {
    const c = mk()
    const s = await c.svc.status()
    expect(s).toMatchObject({ state: 'not_activated', secretsAvailable: true, readOnly: false, branches: [], passphraseSaved: false })
    expect(s.local).toMatchObject({ name: 'Main', poPrefix: 'Q3-' })
    expect(c.svc.isActivated()).toBe(false)
    expect(c.svc.credentials()).toBeNull()
  })

  it('activates: registers the local branch, stores secrets only encrypted, never returns them', async () => {
    const c = mk()
    const s = await c.svc.activate(input({ licenseKey: ` ${KEY.toLowerCase()} `, supabaseUrl: `${URL_OK}/` }))
    const local = c.branches.local()!
    expect(s).toMatchObject({ state: 'activated', host: 'abcd.supabase.co', licenseHint: 'Q3-ABCD-****-****', passphraseSaved: true, prefixInSync: true, link: { state: 'ok' } })
    expect(s.registered).toEqual({ branchId: local.id, name: 'Main', poPrefix: 'Q3-' })
    expect(s.branches).toEqual([{ branchId: local.id, name: 'Main', poPrefix: 'Q3-' }])
    expect(JSON.stringify(s)).not.toContain(KEY)
    expect(JSON.stringify(s)).not.toContain(PASS)
    expect(c.made).toEqual([{ url: URL_OK, anonKey: ANON }])
    // what is on disk
    const dump = c.sync.keys('license.').map((k) => c.sync.get(k)!).join('|')
    expect(dump).not.toContain(KEY); expect(dump).not.toContain(PASS)
    expect(c.sync.get(SYNC_KEYS.licenseBlob)!.startsWith('enc:')).toBe(true)
    expect(c.sync.get(SYNC_KEYS.kdfSalt)).toBeTruthy()
    // later phases can read the credentials back
    expect(c.svc.credentials()).toMatchObject({ url: URL_OK, anonKey: ANON, license: KEY, branchId: local.id })
    // the audit trail says it happened but not with what
    const audit = c.t.handle.sqlite.prepare("SELECT action, detail_json AS d FROM audit_log WHERE entity = 'license'").all() as { action: string; d: string }[]
    expect(audit.map((a) => a.action)).toEqual(['activate'])
    expect(audit[0]!.d).not.toContain(KEY)
    expect(c.logs.join('\n')).not.toContain(KEY)
    expect(c.logs.join('\n')).not.toContain(PASS)
  })

  it('the server received the branch id, name, prefix and device', async () => {
    const c = mk()
    await c.svc.activate(input())
    const list = await c.transport.listBranches({ license: KEY, branchId: c.branches.local()!.id })
    expect(list).toHaveLength(1)
    expect(c.transport.calls[0]).toEqual({ fn: 'qt_register_branch', license: KEY })
  })

  it('refuses bad input before contacting the server', async () => {
    const c = mk()
    for (const bad of [{ supabaseUrl: 'http://x.example' }, { anonKey: '' }, { licenseKey: 'nope' }, { passphrase: 'short' }]) {
      expect(await code(c.svc.activate(input(bad)))).toBe('VALIDATION')
    }
    expect(c.made).toHaveLength(0)
    expect(c.svc.isActivated()).toBe(false)
  })

  it('refuses when the OS cannot protect secrets, or the database is read-only', async () => {
    expect(await code(mk({ secrets: false }).svc.activate(input()))).toBe('IO_ERROR')
    expect(await code(mk({ writable: false }).svc.activate(input()))).toBe('DB_ERROR')
  })

  it('a wrong or suspended license is LICENSE_INVALID and stores nothing', async () => {
    const c = mk()
    expect(await code(c.svc.activate(input({ licenseKey: 'Q3-AAAA-BBBB-CCCC' })))).toBe('LICENSE_INVALID')
    expect(c.svc.isActivated()).toBe(false)
    expect(c.sync.keys('license.')).toEqual([])
    c.transport.suspend(KEY)
    expect(await code(c.svc.activate(input()))).toBe('LICENSE_INVALID')
  })

  it('offline is SYNC_OFFLINE, a prefix clash is a plain VALIDATION message about the prefix', async () => {
    const c = mk()
    c.transport.offline = true
    expect(await code(c.svc.activate(input()))).toBe('SYNC_OFFLINE')
    c.transport.offline = false
    await c.transport.registerBranch({ license: KEY, branchId: '44444444-4444-4444-8444-444444444444', name: 'Other', poPrefix: 'Q3-', device: '' })
    let msg = ''
    try { await c.svc.activate(input()) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/PO prefix/)
    expect(c.svc.isActivated()).toBe(false)
  })

  it('a seat limit stops the third branch, but this branch can re-activate without a new seat', async () => {
    const transport = new InMemoryTransport(); transport.addLicense(KEY, { maxBranches: 1 })
    const c = mk({ transport })
    await c.svc.activate(input())
    expect(await code(c.svc.activate(input()))).toBe('none') // same branch id: updates in place
    await transport.registerBranch({ license: KEY, branchId: '55555555-5555-4555-8555-555555555555', name: 'X', poPrefix: 'X-', device: '' }).catch(() => undefined)
    expect((await c.svc.status()).branches).toHaveLength(1)
  })

  it('a local prefix that cannot be registered is explained, nothing is sent', async () => {
    const c = mk()
    c.t.handle.sqlite.prepare("UPDATE branches SET po_prefix = 'WAYTOOLONGPREFIX' WHERE is_local = 1").run()
    expect(await code(c.svc.activate(input()))).toBe('VALIDATION')
    expect(c.made).toHaveLength(0)
  })

  it('status(check) records ok / offline / license problem and refreshes the branch list', async () => {
    const c = mk()
    await c.svc.activate(input())
    await c.transport.registerBranch({ license: KEY, branchId: '66666666-6666-4666-8666-666666666666', name: 'Pune', poPrefix: 'PUN-', device: '' })
    let s = await c.svc.status({ check: true })
    expect(s.link.state).toBe('ok')
    expect(s.branches.map((b) => b.poPrefix)).toEqual(['PUN-', 'Q3-'])
    c.transport.offline = true
    s = await c.svc.status({ check: true })
    expect(s.link.state).toBe('offline')
    expect(s.state).toBe('activated') // offline never un-activates
    expect(s.branches).toHaveLength(2) // the last known list is kept
    c.transport.offline = false
    c.transport.suspend(KEY)
    s = await c.svc.status({ check: true })
    expect(s.link.state).toBe('license_problem')
    expect(s.link.at).toBe('2026-10-09T10:00:00.000Z')
  })

  it('status without check never contacts the server', async () => {
    const c = mk()
    await c.svc.activate(input())
    const before = c.transport.calls.length
    await c.svc.status()
    expect(c.transport.calls.length).toBe(before)
  })

  it('flags a local prefix change made after registering', async () => {
    const c = mk()
    await c.svc.activate(input())
    c.t.handle.sqlite.prepare("UPDATE branches SET po_prefix = 'NEW-' WHERE is_local = 1").run()
    const s = await c.svc.status()
    expect(s.prefixInSync).toBe(false)
    expect(s.registered!.poPrefix).toBe('Q3-')
  })

  it('an unreadable stored license (another Windows user) shows as a license problem, not a crash', async () => {
    const c = mk()
    await c.svc.activate(input())
    c.sync.set(SYNC_KEYS.licenseBlob, 'garbage')
    expect(c.svc.credentials()).toBeNull()
    expect((await c.svc.status({ check: true })).link.state).toBe('license_problem')
  })

  it('deactivate needs the typed word, forgets everything, keeps the bills', async () => {
    const c = mk()
    await c.svc.activate(input())
    expect(await code(c.svc.deactivate({ confirm: 'yes' }))).toBe('VALIDATION')
    expect(c.svc.isActivated()).toBe(true)
    const s = await c.svc.deactivate({ confirm: 'deactivate' })
    expect(s.state).toBe('not_activated')
    expect(c.sync.keys('license.')).toEqual([])
    expect(c.svc.credentials()).toBeNull()
    expect(c.branches.local()).toBeTruthy()
    const audit = c.t.handle.sqlite.prepare("SELECT action FROM audit_log WHERE entity = 'license' ORDER BY id").all() as { action: string }[]
    expect(audit.map((a) => a.action)).toEqual(['activate', 'deactivate'])
    // and it can be activated again
    expect((await c.svc.activate(input())).state).toBe('activated')
  })
})

describe('license IPC handlers (Phase 52)', () => {
  it('validate strictly and never echo secrets', async () => {
    const c = mk()
    const h = licenseHandlers(c.svc)
    expect(Object.keys(h).sort()).toEqual(['license:activate', 'license:deactivate', 'license:status'])
    const bad = await h['license:activate']!({ ...input(), extra: 1 }) as { ok: boolean; error?: { code: string } }
    expect(bad.ok).toBe(false)
    expect((await h['license:status']!({ check: 'yes' }) as { ok: boolean }).ok).toBe(false)
    const ok = await h['license:activate']!(input()) as { ok: boolean; data: unknown }
    expect(ok.ok).toBe(true)
    expect(JSON.stringify(ok)).not.toContain(KEY)
    expect(JSON.stringify(ok)).not.toContain(ANON)
    const st = await h['license:status']!({}) as { ok: boolean; data: { state: string } }
    expect(st.data.state).toBe('activated')
    const wrong = await h['license:deactivate']!({ confirm: 'no' }) as { ok: boolean; error?: { code: string } }
    expect(wrong).toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
  })
})
