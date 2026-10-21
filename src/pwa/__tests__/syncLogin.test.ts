import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport } from '../../main/sync/sharedTransport'
import { openPhoneDb, putRecord } from '../data/db'
import { getMeta, setMetaValue } from '../data/metaRepo'
import { getSetting } from '../data/settingsRepo'
import { createAppLock, FREE_TRIES } from '../sync/appLock'
import { getBranchLink, linkPhoneToOrganisation, validateLinkInput, type LinkInput } from '../sync/branch'
import { CLOCK_WARN_MS, clockWarning, correctedNowIso, measureClockOffset, refreshClockOffset } from '../sync/clock'
import { toSyncFailure } from '../sync/errors'
import { createSessionVault, persistSessionChanges, restoreSyncSession, signOutPhone, VAULT_BLOB_SETTING } from '../sync/session'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const URL_ = 'https://example-project.supabase.co'
const ANON = 'invented-anon-key-for-tests'
const NOW0 = Date.parse('2026-10-21T10:00:00.000Z')

function world(opts: { seats?: number } = {}) {
  let clock = NOW0
  const server = new InMemorySharedServer({ now: () => clock })
  const seats = Array.from({ length: opts.seats ?? 2 }, (_, i) => ({ email: `seat${i + 1}@example.test`, password: `pw-${i + 1}-secret` }))
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats })
  return { server, orgId, seats, advance: (ms: number) => { clock += ms }, now: () => clock }
}

async function phone(server: InMemorySharedServer) {
  const db = await openPhoneDb({ factory: new IDBFactory() })
  return { db, port: new InMemorySharedTransport(server), vault: createSessionVault(db) }
}

const form = (over: Partial<LinkInput> = {}): LinkInput => ({
  supabaseUrl: URL_, anonKey: ANON, licenseKey: LICENSE, email: 'seat1@example.test', password: 'pw-1-secret', branchName: 'Android phone', poPrefix: 'PH', ...over
})

describe('link: sign in + branch', () => {
  it('signs in, registers the branch and stores org / branch / prefix together', async () => {
    const w = world()
    const p = await phone(w.server)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(r.ok).toBe(true)
    const m = await getMeta(p.db)
    expect(m.org_id).toBe(w.orgId)
    expect(m.branch_name).toBe('Android phone')
    expect(m.po_prefix).toBe('PH')
    expect(m.branch_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(w.server.branches(w.orgId)).toHaveLength(1)
    expect(w.server.branches(w.orgId)[0]!.branchId).toBe(m.branch_id)
    expect((await getBranchLink(p.db)).linked).toBe(true)
    const v = await p.vault.load()
    expect(v?.session?.userId).toBeTruthy()
    expect(v?.license).toBe(LICENSE)
  })

  it('never stores the password, and the stored login is not readable text', async () => {
    const w = world()
    const p = await phone(w.server)
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    const blob = JSON.stringify(await getSetting<unknown>(p.db, VAULT_BLOB_SETTING, null))
    expect(blob).not.toContain('pw-1-secret')
    expect(blob).not.toContain('seat1@example.test')
    expect(blob).not.toContain(ANON)
    expect(blob).not.toContain(LICENSE)
    const all = JSON.stringify(await getMeta(p.db))
    expect(all).not.toContain('pw-1-secret')
  })

  it('the vault key is non-extractable', async () => {
    const w = world()
    const p = await phone(w.server)
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    const k = await getSetting<CryptoKey>(p.db, 'secret.syncVaultKey', null as never)
    expect(k.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', k)).rejects.toBeTruthy()
  })

  it('measures the clock offset against the server at link time', async () => {
    const w = world()
    const p = await phone(w.server)
    const phoneClock = () => w.now() - 5 * 60_000 // the phone is 5 minutes behind
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), phoneClock)
    expect(r.ok && r.clockOffsetMs).toBe(5 * 60_000)
    expect((await getMeta(p.db)).clock_offset_ms).toBe(5 * 60_000)
  })

  it('refuses a duplicate PO prefix and leaves the phone untouched', async () => {
    const w = world()
    const a = await phone(w.server)
    await linkPhoneToOrganisation(a.db, a.port, a.vault, form({ poPrefix: 'DUP' }), w.now)
    const b = await phone(w.server)
    const r = await linkPhoneToOrganisation(b.db, b.port, b.vault, form({ email: 'seat2@example.test', password: 'pw-2-secret', branchName: 'Second phone', poPrefix: 'dup' }), w.now)
    expect(r.ok).toBe(false)
    if (!r.ok && r.code === 'SYNC') {
      expect(r.failure.kind).toBe('prefix_taken')
      expect(r.errors.poPrefix).toMatch(/PO prefix/)
    } else throw new Error('expected SYNC failure')
    const m = await getMeta(b.db)
    expect(m.org_id).toBeNull()
    expect(m.branch_id).toBeNull()
    expect(m.po_prefix).toBeNull()
    expect((await b.vault.load())?.session ?? null).toBeNull()
    expect(w.server.branches(w.orgId)).toHaveLength(1)
  })

  it('refuses a duplicate branch name (case and spaces ignored) on the name field', async () => {
    const w = world()
    const a = await phone(w.server)
    await linkPhoneToOrganisation(a.db, a.port, a.vault, form({ branchName: 'Main  Shop', poPrefix: 'MS' }), w.now)
    const b = await phone(w.server)
    const r = await linkPhoneToOrganisation(b.db, b.port, b.vault, form({ email: 'seat2@example.test', password: 'pw-2-secret', branchName: 'main shop', poPrefix: 'P2' }), w.now)
    expect(!r.ok && r.code === 'SYNC' && r.failure.kind).toBe('name_taken')
    expect(!r.ok && r.code === 'SYNC' && r.errors.branchName).toBeTruthy()
    expect((await getMeta(b.db)).branch_id).toBeNull()
  })

  it('a wrong password is refused on the password field and nothing is stored', async () => {
    const w = world()
    const p = await phone(w.server)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form({ password: 'nope' }), w.now)
    expect(!r.ok && r.code === 'SYNC' && r.failure.kind).toBe('auth_failed')
    expect(!r.ok && r.code === 'SYNC' && r.errors.password).toBeTruthy()
    expect((await getMeta(p.db)).org_id).toBeNull()
  })

  it('a wrong license key is refused on the license field', async () => {
    const w = world()
    const p = await phone(w.server)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form({ licenseKey: 'Q3-AAAA-BBBB-CCCC' }), w.now)
    expect(!r.ok && r.code === 'SYNC' && r.failure.kind).toBe('license')
    expect(!r.ok && r.code === 'SYNC' && r.errors.licenseKey).toBeTruthy()
  })

  it('a paused server says paused, not "no internet"', async () => {
    const w = world()
    const p = await phone(w.server)
    w.server.setPaused(true)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(!r.ok && r.code === 'SYNC' && r.failure.kind).toBe('server_paused')
    expect(!r.ok && r.code === 'SYNC' && r.failure.message).toMatch(/paused/i)
    expect(!r.ok && r.code === 'SYNC' && r.failure.message).not.toMatch(/internet/i)
  })

  it('an unreachable server says it could not reach Supabase', async () => {
    const w = world()
    const p = await phone(w.server)
    w.server.setOffline(true)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(!r.ok && r.code === 'SYNC' && r.failure.kind).toBe('offline')
    expect(!r.ok && r.code === 'SYNC' && r.failure.message).toMatch(/internet|reach/i)
  })

  it('a seat already bound to another install is refused unless the person chose take over', async () => {
    const w = world()
    const a = await phone(w.server)
    await linkPhoneToOrganisation(a.db, a.port, a.vault, form(), w.now)
    const b = await phone(w.server)
    const r1 = await linkPhoneToOrganisation(b.db, b.port, b.vault, form({ branchName: 'Reinstalled', poPrefix: 'RE' }), w.now)
    expect(!r1.ok && r1.code === 'SYNC' && r1.failure.kind).toBe('seat_in_use')
    const r2 = await linkPhoneToOrganisation(b.db, b.port, b.vault, form({ branchName: 'Reinstalled', poPrefix: 'RE', takeover: true }), w.now)
    expect(r2.ok).toBe(true)
    expect(w.server.branches(w.orgId)).toHaveLength(1)
  })

  it('relinking after a failed try reuses the same branch id', async () => {
    const w = world()
    const p = await phone(w.server)
    w.server.setOffline(true)
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    w.server.setOffline(false)
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(r.ok).toBe(true)
    const again = await linkPhoneToOrganisation(p.db, p.port, p.vault, form({ branchName: 'Android phone 2' }), w.now)
    expect(again.ok).toBe(true)
    expect(w.server.branches(w.orgId)).toHaveLength(1)
  })

  it('the PO prefix is locked once the phone has issued PO numbers', async () => {
    const w = world()
    const p = await phone(w.server)
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    await setMetaValue(p.db, 'po_counter', 3)
    const bad = await linkPhoneToOrganisation(p.db, p.port, p.vault, form({ poPrefix: 'NEW' }), w.now)
    expect(!bad.ok && bad.code).toBe('PREFIX_LOCKED')
    expect((await getMeta(p.db)).po_prefix).toBe('PH')
    const same = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(same.ok).toBe(true)
  })

  it('refuses to attach a phone holding another organisation\'s data', async () => {
    const w = world()
    const p = await phone(w.server)
    await setMetaValue(p.db, 'org_id', '99999999-2222-4333-8444-555555555555')
    const r = await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    expect(!r.ok && r.code).toBe('ORG_MISMATCH')
    expect((await getMeta(p.db)).org_id).toBe('99999999-2222-4333-8444-555555555555')
    expect((await p.vault.load())?.session ?? null).toBeNull()
  })

  it('reports a browser without Web Crypto as a storage problem', async () => {
    const w = world()
    const db = await openPhoneDb({ factory: new IDBFactory() })
    const r = await linkPhoneToOrganisation(db, new InMemorySharedTransport(w.server), createSessionVault(db, {} as Crypto), form(), w.now)
    expect(!r.ok && r.code).toBe('STORAGE')
  })

  it('checks every field shape before any network call', () => {
    const r = validateLinkInput({ supabaseUrl: 'http://evil.example', anonKey: 'a service_role key', licenseKey: 'nope', email: 'x', password: '', branchName: ' ', poPrefix: 'TOO-LONG-PREFIX' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['anonKey', 'branchName', 'email', 'licenseKey', 'password', 'poPrefix', 'supabaseUrl'])
  })
})

describe('session: restore, refresh, sign out', () => {
  async function linked() {
    const w = world()
    const p = await phone(w.server)
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    return { w, ...p }
  }

  it('sign out clears the session but keeps the branch, bills and connection details', async () => {
    const { w, db, port, vault } = await linked()
    await signOutPhone(vault, port)
    const v = await vault.load()
    expect(v?.session).toBeNull()
    expect(v?.email).toBe('seat1@example.test')
    expect(v?.license).toBe(LICENSE)
    expect((await getMeta(db)).branch_name).toBe('Android phone')
    expect(w.server.branches(w.orgId)).toHaveLength(1)
    const r = await restoreSyncSession(vault, port)
    expect(r.state).toBe('signed_out')
  })

  it('sign out still clears the tokens when the phone is offline', async () => {
    const { w, port, vault } = await linked()
    w.server.setOffline(true)
    await signOutPhone(vault, { signOut: () => Promise.reject(new Error('offline')) })
    expect((await vault.load())?.session).toBeNull()
    void port
  })

  it('restores the stored login on a fresh transport (a new start of the app)', async () => {
    const { w, db, vault } = await linked()
    const fresh = new InMemorySharedTransport(w.server)
    const r = await restoreSyncSession(createSessionVault(db), fresh)
    expect(r.state).toBe('signed_in')
    void vault
  })

  it('an expired access token is refreshed and the NEW tokens are stored (refresh tokens are single use)', async () => {
    const { w, db, vault } = await linked()
    const before = (await vault.load())!.session!
    w.advance(3_600_000 - 30_000) // the stored access token now has under 60 s left, so the transport refreshes it
    const fresh = new InMemorySharedTransport(w.server)
    const r = await restoreSyncSession(createSessionVault(db), fresh)
    expect(r.state).toBe('signed_in')
    const after = (await vault.load())!.session!
    expect(after.refreshToken).not.toBe(before.refreshToken)
    // and the stored pair works again on yet another start
    const again = await restoreSyncSession(createSessionVault(db), new InMemorySharedTransport(w.server))
    expect(again.state).toBe('signed_in')
  })

  it('persistSessionChanges stores a refresh that happens later, in order', async () => {
    const { w, db, vault } = await linked()
    const t = new InMemorySharedTransport(w.server)
    await restoreSyncSession(vault, t)
    const off = persistSessionChanges(t, vault)
    const m = await getMeta(db)
    w.advance(3_600_000 - 30_000)
    await t.touch({ license: LICENSE, branchId: m.branch_id! }) // forces a refresh inside the transport
    await new Promise((r) => setTimeout(r, 20))
    expect((await vault.load())!.session!.refreshToken).toBe(t.currentSession()!.refreshToken)
    off()
  })

  it('a refused (dropped) refresh token signs out and clears the tokens', async () => {
    const { w, db, vault } = await linked()
    w.server.expireAccessTokens()
    w.server.dropRefreshTokens()
    const r = await restoreSyncSession(vault, new InMemorySharedTransport(w.server))
    expect(r.state).toBe('signed_out')
    expect((await createSessionVault(db).load())?.session).toBeNull()
  })

  it('a paused or offline server keeps the stored login', async () => {
    const { w, vault } = await linked()
    w.server.expireAccessTokens()
    w.server.setPaused(true)
    const r = await restoreSyncSession(vault, new InMemorySharedTransport(w.server))
    expect(r.state).toBe('unreachable')
    if (r.state === 'unreachable') expect(r.failure.message).toMatch(/paused/i)
    expect((await vault.load())?.session).not.toBeNull()
    w.server.setPaused(false)
    w.server.setOffline(true)
    const r2 = await restoreSyncSession(vault, new InMemorySharedTransport(w.server))
    expect(r2.state).toBe('unreachable')
    expect((await vault.load())?.session).not.toBeNull()
  })

  it('nothing stored means "none"; a damaged blob is dropped and treated as signed out', async () => {
    const w = world()
    const p = await phone(w.server)
    expect((await restoreSyncSession(p.vault, p.port)).state).toBe('none')
    await linkPhoneToOrganisation(p.db, p.port, p.vault, form(), w.now)
    await putRecord(p.db, 'settings', { key: VAULT_BLOB_SETTING, value: { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' } })
    expect(await p.vault.load()).toBeNull()
    expect((await restoreSyncSession(p.vault, p.port)).state).toBe('none')
  })

  it('forget removes the key and the blob', async () => {
    const { db, vault } = await linked()
    await vault.forget()
    expect(await vault.load()).toBeNull()
    expect(await getSetting<unknown>(db, 'secret.syncVaultKey', null)).toBeNull()
  })

  it('secret settings are not in a backup export', async () => {
    const { db } = await linked()
    const { exportBackup } = await import('../data/backup')
    const file = await exportBackup(db, { appVersion: 'test' })
    const text = await file.blob.text()
    expect(text).not.toContain('syncVault')
    expect(text).not.toContain('seat1@example.test')
  })
})

describe('error text', () => {
  it('maps transport errors, network TypeErrors and unknown errors without copying server text', () => {
    expect(toSyncFailure({ kind: 'server_paused' }).message).toMatch(/paused/i)
    expect(toSyncFailure(new TypeError('Failed to fetch')).kind).toBe('offline')
    const odd = toSyncFailure(new Error('secret-token-abc leaked here'))
    expect(odd.kind).toBe('server')
    expect(odd.message).not.toContain('secret-token-abc')
  })
})

describe('clock', () => {
  it('offset is server minus the round-trip midpoint', async () => {
    let t = 1_000_000
    const off = await measureClockOffset({ now: async () => { t += 400; return { serverTime: new Date(1_000_000 + 10_000 + 200).toISOString() } } }, () => t)
    expect(off).toBe(10_000) // phone midpoint = 1_000_200; server = 1_010_200
  })
  it('rejects a bad server time and keeps the stored offset', async () => {
    const w = world()
    const p = await phone(w.server)
    await setMetaValue(p.db, 'clock_offset_ms', 1234)
    await expect(refreshClockOffset(p.db, { now: async () => ({ serverTime: 'garbage' }) })).rejects.toThrow()
    expect((await getMeta(p.db)).clock_offset_ms).toBe(1234)
  })
  it('corrects edited_at by the stored offset and warns only over 2 minutes', async () => {
    const w = world()
    const p = await phone(w.server)
    await setMetaValue(p.db, 'clock_offset_ms', 60_000)
    expect(await correctedNowIso(p.db, () => NOW0)).toBe(new Date(NOW0 + 60_000).toISOString())
    expect(clockWarning(CLOCK_WARN_MS)).toBeNull()
    expect(clockWarning(CLOCK_WARN_MS + 1)).toMatch(/behind/)
    expect(clockWarning(-5 * 60_000)).toMatch(/ahead/)
  })
})

describe('app lock groundwork (off by default)', () => {
  const mk = async () => {
    const db = await openPhoneDb({ factory: new IDBFactory() })
    let t = NOW0
    return { db, lock: createAppLock(db, { iterations: 1000, nowMs: () => t }), tick: (ms: number) => { t += ms } }
  }
  it('is off until a PIN is set; the PIN is stored hashed', async () => {
    const { db, lock } = await mk()
    expect(await lock.isEnabled()).toBe(false)
    expect(await lock.setPin('12')).toBe(false)
    expect(await lock.setPin('12ab')).toBe(false)
    expect(await lock.setPin('4821')).toBe(true)
    expect(await lock.isEnabled()).toBe(true)
    expect(JSON.stringify(await getSetting<unknown>(db, 'secret.appLockPin', null))).not.toContain('4821')
    expect((await lock.verify('4821')).ok).toBe(true)
    expect((await lock.verify('0000')).ok).toBe(false)
  })
  it('slows guessing after repeated wrong tries and recovers after the wait', async () => {
    const { lock, tick } = await mk()
    await lock.setPin('4821')
    for (let i = 0; i < FREE_TRIES - 1; i++) expect(await lock.verify('1111')).toMatchObject({ ok: false, lockedForMs: 0 })
    const locked = await lock.verify('1111')
    expect(locked).toMatchObject({ ok: false, triesLeft: 0 })
    expect(!locked.ok && locked.lockedForMs).toBeGreaterThan(0)
    expect((await lock.verify('4821')).ok).toBe(false) // still locked, even with the right PIN
    tick(60_000)
    expect((await lock.verify('4821')).ok).toBe(true)
  })
  it('disable needs the current PIN and removes it', async () => {
    const { lock } = await mk()
    await lock.setPin('4821')
    expect(await lock.disable('0000')).toBe(false)
    expect(await lock.isEnabled()).toBe(true)
    expect(await lock.disable('4821')).toBe(true)
    expect(await lock.isEnabled()).toBe(false)
  })
})
