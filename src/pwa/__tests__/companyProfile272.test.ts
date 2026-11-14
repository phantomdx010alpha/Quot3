import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openPhoneDb } from '../data/db'
import { getSetting, setSetting } from '../data/settingsRepo'
import { createProfileRefresher, effectiveCompany, pickCompany, storeMasterProfile, PROFILE_REFRESH_GAP_MS } from '../sync/companyProfile'
import type { PhoneMasterClient } from '../sync/master'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 272: the phone shows the company default. Fake master + fake vault, invented strings, no network. */
const LOCAL = { name: 'Local Shop', phone: '111', address: 'Local Road', logoDataUrl: null }
const prof = (version: number, over: Record<string, unknown> = {}) => ({ version, name: 'Company Default', phone: '999', address: 'Head Office', logo: null, ...over })

async function fresh() { return openPhoneDb({ factory: new IDBFactory() }) }

function fakeMaster(opts: { changed?: boolean; profile?: ReturnType<typeof prof>; fail?: boolean; configured?: boolean } = {}) {
  const calls: string[] = []
  const m = {
    configured: () => opts.configured !== false,
    heartbeat: async (a: { profileVersion: number | null }) => { calls.push(`hb:${a.profileVersion}`); if (opts.fail) throw new Error('offline'); return { profileChanged: opts.changed ?? true, seat: { no: 2, label: 'x', status: 'active' } } },
    profileGet: async () => { calls.push('get'); return opts.profile ?? prof(1) }
  } as unknown as PhoneMasterClient
  return { m, calls }
}
const vaultWith = (deviceToken?: string) => ({ load: async () => ({ supabaseUrl: 'u', anonKey: 'a', ...(deviceToken ? { deviceToken } : {}) }) as never })

describe('Phase 272 - phone company profile', () => {
  it('pickCompany: no default or an unnamed default = the phone\'s own record', () => {
    expect(pickCompany(null, LOCAL)).toBe(LOCAL)
    expect(pickCompany({ version: 1, name: ' ', phone: '1', address: '', logoDataUrl: null }, LOCAL)).toBe(LOCAL)
  })
  it('not linked: effectiveCompany is the local record exactly as before', async () => {
    const db = await fresh()
    await setSetting(db, 'company.profile', LOCAL)
    expect(await effectiveCompany(db)).toEqual(LOCAL)
  })
  it('a stored default is what share / bill output reads, logo as a data URL', async () => {
    const db = await fresh()
    await setSetting(db, 'company.profile', LOCAL)
    expect(await storeMasterProfile(db, prof(2, { logo: 'AAAA' }) as never)).toBe(true)
    expect(await effectiveCompany(db)).toEqual({ name: 'Company Default', phone: '999', address: 'Head Office', logoDataUrl: 'data:image/png;base64,AAAA' })
    expect(await getSetting(db, 'company.profile')).toEqual(LOCAL) // the phone's own record is never rewritten
  })
  it('an older or equal version is ignored', async () => {
    const db = await fresh()
    await storeMasterProfile(db, prof(5) as never)
    expect(await storeMasterProfile(db, prof(4, { name: 'Old' }) as never)).toBe(false)
    expect((await effectiveCompany(db)).name).toBe('Company Default')
  })
  it('refresh: version moved -> heartbeat then profile-get, stored', async () => {
    const db = await fresh(); const { m, calls } = fakeMaster({ profile: prof(3) })
    const r = createProfileRefresher({ db, vault: vaultWith('tok'), master: m })
    expect(await r.refresh()).toBe('updated')
    expect(calls).toEqual(['hb:null', 'get'])
    expect((await getSetting(db, 'company.master'))?.version).toBe(3)
  })
  it('refresh: version unchanged -> no download', async () => {
    const db = await fresh(); const { m, calls } = fakeMaster({ changed: false })
    expect(await createProfileRefresher({ db, vault: vaultWith('tok'), master: m }).refresh()).toBe('same')
    expect(calls).toEqual(['hb:null'])
  })
  it('offline keeps the last default and never throws', async () => {
    const db = await fresh(); await storeMasterProfile(db, prof(2) as never)
    const { m } = fakeMaster({ fail: true })
    expect(await createProfileRefresher({ db, vault: vaultWith('tok'), master: m }).refresh()).toBe('failed')
    expect((await effectiveCompany(db)).name).toBe('Company Default')
  })
  it('no device token or master not configured: no call, nothing changes', async () => {
    const db = await fresh()
    const a = fakeMaster(); const b = fakeMaster({ configured: false })
    expect(await createProfileRefresher({ db, vault: vaultWith(), master: a.m }).refresh()).toBe('skipped')
    expect(await createProfileRefresher({ db, vault: vaultWith('tok'), master: b.m }).refresh()).toBe('skipped')
    expect(a.calls.length + b.calls.length).toBe(0)
  })
  it('throttled: a second call inside the gap is skipped, force or the gap passing runs it', async () => {
    const db = await fresh(); const { m, calls } = fakeMaster({ changed: false }); let t = 1_000
    const r = createProfileRefresher({ db, vault: vaultWith('tok'), master: m, nowMs: () => t })
    await r.refresh(); expect(await r.refresh()).toBe('skipped')
    expect(await r.refresh(true)).toBe('same')
    t += PROFILE_REFRESH_GAP_MS + 1
    expect(await r.refresh()).toBe('same')
    expect(calls.length).toBe(3)
  })
})
