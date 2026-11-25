import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openPhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { dropPayments, readPayments, readPaymentsPrefs, writePayments, writePaymentsPrefs } from '../data/paymentsRepo'
import { createPaymentsSync, PAYMENTS_LOCAL_ONLY_WORDS, PAYMENTS_REFRESH_GAP_MS, storeMasterPayments } from '../sync/payments'
import { createPhoneMasterClient, PhoneMasterError, type PhoneMasterClient } from '../sync/master'
import { masterErrorWords } from '../../shared/master/errors'
import { seedList } from '../../shared/payments/seed'
import type { PaymentsList } from '../../shared/payments/types'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange

/** Phase 281 (M25 T23-T28): phone Payments data + sync. Fake master and vault, invented data, no network. */
const fresh = () => openPhoneDb({ factory: new IDBFactory() })
const { version: _v, ...BODY } = seedList()
const master = (version: number, over: Partial<typeof BODY> = {}) => ({ version, unchanged: false, list: { ...BODY, ...over } })
const vaultWith = (deviceToken?: string) => ({ load: async () => ({ supabaseUrl: 'u', anonKey: 'a', ...(deviceToken ? { deviceToken } : {}) }) as never })

interface Script { get?: () => unknown; set?: (a: any) => unknown; configured?: boolean }
function fake(s: Script = {}) {
  const calls: string[] = []
  const sets: any[] = []
  const m = {
    configured: () => s.configured !== false,
    paymentsGet: async (a: { knownVersion?: number }) => { calls.push(`get:${a.knownVersion ?? '-'}`); const r = s.get ? s.get() : master(0); if (r instanceof Error) throw r; return r },
    paymentsSet: async (a: any) => { calls.push(`set:${a.expectVersion}`); sets.push(a); const r = s.set ? s.set(a) : { version: a.expectVersion + 1, unchanged: false, list: a.list }; if (r instanceof Error) throw r; return r }
  } as unknown as PhoneMasterClient
  return { m, calls, sets }
}
const sync = (db: any, f: ReturnType<typeof fake>, token: string | undefined = 'tok', t = { v: 1_000 }) =>
  createPaymentsSync({ db, vault: vaultWith(token), master: f.m, nowMs: () => t.v, newReqId: () => '00000000-0000-4000-8000-000000000001' })

describe('data (T23, prefs)', () => {
  it('T23 a phone with nothing stored answers the seed WITHOUT storing it', async () => {
    const db = await fresh()
    const r = await readPayments(db)
    expect(r.stored).toBe(false); expect(r.list).toEqual(seedList()); expect(r.unpublished).toBe(false)
    expect((await getMeta(db)).schema_version).toBe(1) // other meta readers are unaffected
  })
  it('write / read / drop; a damaged row falls back to the seed', async () => {
    const db = await fresh()
    await writePayments(db, { ...seedList(), recipient: 'Shop X', version: 4 }, true)
    const r = await readPayments(db)
    expect(r).toMatchObject({ stored: true, unpublished: true }); expect(r.list.recipient).toBe('Shop X'); expect(r.list.version).toBe(4)
    await dropPayments(db)
    expect((await readPayments(db)).stored).toBe(false)
  })
  it('prefs default off and remember the switch and the last payee', async () => {
    const db = await fresh()
    expect(await readPaymentsPrefs(db)).toEqual({ accountMode: false, lastPayeeId: null })
    await writePaymentsPrefs(db, { accountMode: true, lastPayeeId: 'sbi' })
    expect(await readPaymentsPrefs(db)).toEqual({ accountMode: true, lastPayeeId: 'sbi' })
  })
})

describe('refresh (T24-T26)', () => {
  it('T23 the master has a list: it is stored, not the seed; the seed is used only when neither side has one', async () => {
    const db = await fresh()
    const f = fake({ get: () => master(3, { recipient: 'Master Shop' }) })
    expect(await sync(db, f).refresh()).toBe('updated')
    expect((await readPayments(db)).list).toMatchObject({ recipient: 'Master Shop', version: 3 })
    const db2 = await fresh()
    expect(await sync(db2, fake({ get: () => ({ version: 0, unchanged: false, list: null }) })).refresh()).toBe('same')
    expect((await readPayments(db2)).stored).toBe(false)
  })
  it('T24 an older or equal answer is ignored, a newer one is stored; knownVersion is sent', async () => {
    const db = await fresh()
    await writePayments(db, { ...seedList(), recipient: 'Mine', version: 5 }, false)
    const f = fake({ get: () => master(4, { recipient: 'Old' }) })
    expect(await sync(db, f).refresh()).toBe('same')
    expect(f.calls).toEqual(['get:5'])
    expect((await readPayments(db)).list.recipient).toBe('Mine')
    const f2 = fake({ get: () => ({ version: 5, unchanged: true, list: null }) })
    expect(await sync(db, f2).refresh()).toBe('same')
    const f3 = fake({ get: () => master(6, { recipient: 'New' }) })
    expect(await sync(db, f3).refresh()).toBe('updated')
    expect((await readPayments(db)).list).toMatchObject({ recipient: 'New', version: 6 })
  })
  it('a hostile list from the server is cleaned before it is stored', async () => {
    const db = await fresh()
    const evil = master(2, { accounts: [{ id: 'a', name: 'A', kind: 'upi', upiId: 'ok@sbi' }, { id: 'b', name: 'B', kind: 'upi', upiId: 'bad&x' } as never] })
    expect(await storeMasterPayments(db, evil as never)).toBe(true)
    expect((await readPayments(db)).list.accounts.map((a) => a.id)).toEqual(['a'])
  })
  it('T25 offline keeps the last list and never throws', async () => {
    const db = await fresh()
    await writePayments(db, { ...seedList(), recipient: 'Kept', version: 2 }, false)
    const f = fake({ get: () => new PhoneMasterError('Q3M90') })
    expect(await sync(db, f).refresh()).toBe('failed')
    expect((await readPayments(db)).list.recipient).toBe('Kept')
    expect(await sync(db, fake({ get: () => new Error('boom') })).refresh()).toBe('failed')
    expect(await sync(db, fake({ get: () => new PhoneMasterError('Q3M27') })).refresh()).toBe('failed')
  })
  it('Q3M22 (may not see Payments) is "refused" and stores nothing', async () => {
    const db = await fresh()
    expect(await sync(db, fake({ get: () => new PhoneMasterError('Q3M22') })).refresh()).toBe('refused')
    expect((await readPayments(db)).stored).toBe(false)
  })
  it('T26 no device token or master not configured: no call, no error', async () => {
    const db = await fresh()
    const a = fake(); const b = fake({ configured: false })
    expect(await sync(db, a, '').refresh()).toBe('skipped')
    expect(await sync(db, b).refresh()).toBe('skipped')
    expect(a.calls.length + b.calls.length).toBe(0)
  })
  it('throttled to one call per 5 minutes unless forced', async () => {
    const db = await fresh(); const f = fake(); const t = { v: 1_000 }
    const s = sync(db, f, 'tok', t)
    await s.refresh(); expect(await s.refresh()).toBe('skipped')
    await s.refresh(true)
    t.v += PAYMENTS_REFRESH_GAP_MS + 1
    await s.refresh()
    expect(f.calls.length).toBe(3)
  })
})

describe('publish (T27, T28)', () => {
  const edited = (): PaymentsList => ({ ...seedList(), recipient: 'Edited Shop' })
  it('success: master version stored, unpublished cleared, reqId and expectVersion sent, no version in the body', async () => {
    const db = await fresh()
    const f = fake()
    const r = await sync(db, f).publish(edited())
    expect(r).toEqual({ ok: true, version: 1 })
    expect(f.sets[0].expectVersion).toBe(0); expect(f.sets[0].reqId).toMatch(/^[0-9a-f-]{36}$/); expect('version' in f.sets[0].list).toBe(false)
    expect(await readPayments(db)).toMatchObject({ stored: true, unpublished: false, list: { recipient: 'Edited Shop', version: 1 } })
  })
  it('T27 refused (Q3M23): the edit stays, marked unpublished, plain words shown', async () => {
    const db = await fresh()
    const r = await sync(db, fake({ set: () => new PhoneMasterError('Q3M23') })).publish(edited())
    expect(r).toEqual({ ok: false, code: 'Q3M23', words: masterErrorWords('Q3M23'), keptLocally: true })
    expect(r.ok === false && r.words).toBe('This phone is not allowed to change Payments. Ask your admin.')
    expect(await readPayments(db)).toMatchObject({ unpublished: true, list: { recipient: 'Edited Shop' } })
  })
  it('T28 conflict (Q3M24): the master list is adopted and the person is told', async () => {
    const db = await fresh()
    await writePayments(db, { ...seedList(), version: 1 }, false)
    const f = fake({ set: () => new PhoneMasterError('Q3M24'), get: () => master(2, { recipient: 'Other Phone' }) })
    const r = await sync(db, f).publish(edited())
    expect(r.ok === false && r.code).toBe('Q3M24')
    expect(r.ok === false && r.words).toBe(masterErrorWords('Q3M24'))
    expect((await readPayments(db))).toMatchObject({ unpublished: false, list: { recipient: 'Other Phone', version: 2 } })
  })
  it('no device token: kept on this phone with the local-only words, no call', async () => {
    const db = await fresh(); const f = fake()
    const r = await sync(db, f, '').publish(edited())
    expect(r).toEqual({ ok: false, code: 'LOCAL', words: PAYMENTS_LOCAL_ONLY_WORDS, keptLocally: true })
    expect(f.calls).toEqual([]); expect((await readPayments(db)).unpublished).toBe(true)
  })
  it('offline: kept, unpublished, never throws', async () => {
    const db = await fresh()
    const r = await sync(db, fake({ set: () => new PhoneMasterError('Q3M90') })).publish(edited())
    expect(r.ok).toBe(false); expect((await readPayments(db)).unpublished).toBe(true)
  })
})

describe('wire and logs (real master client, fake fetch)', () => {
  it('payments-get / payments-set post the contract bodies with the device header, and nothing secret is logged', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: any }> = []
    const logs: string[] = []
    const client = createPhoneMasterClient({
      url: 'https://master.example.invalid', anon: 'anon-key-anon-key-anon-key', appVersion: '0.1.62', sleep: async () => undefined,
      log: { info: (m, meta) => logs.push(m + JSON.stringify(meta)), warn: (m, meta) => logs.push(m + JSON.stringify(meta)) },
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body); seen.push({ url, headers: init.headers, body })
        return { status: 200, text: async () => JSON.stringify({ ok: true, payments: { version: 1, unchanged: false, list: BODY } }) }
      }
    })
    const g = await client.paymentsGet({ knownVersion: 2 }, 'tok')
    const s = await client.paymentsSet({ reqId: '00000000-0000-4000-8000-000000000009', expectVersion: 1, list: BODY }, 'tok')
    expect(g.version).toBe(1); expect(s.list?.accounts).toHaveLength(3)
    expect(seen[0]!.url).toMatch(/\/payments-get$/); expect(seen[1]!.url).toMatch(/\/payments-set$/)
    expect(seen[0]!.body).toEqual({ v: 1, knownVersion: 2 })
    expect(seen[1]!.body).toMatchObject({ v: 1, expectVersion: 1 })
    expect(JSON.stringify(seen[0]!.headers).toLowerCase()).toContain('x-q3-device')
    const all = logs.join('\n')
    for (const bad of ['meenakshibuttons@sbi', 'SBIN0040015', '54047475538', '112011011564', 'Meenakshi', 'tok"']) expect(all).not.toContain(bad)
    expect(all).toContain('payments-get')
  })
})
