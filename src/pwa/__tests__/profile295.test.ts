// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEAT_RIGHT_FLAGS, ALL_SEAT_RIGHTS, NO_SEAT_RIGHTS, PRESETS, type SeatFlags } from '../../shared/seatRights'
import { seedList } from '../../shared/payments/seed'
import { openPhoneDb, countRecords, type PhoneDb } from '../data/db'
import { writePayments } from '../data/paymentsRepo'
import { setMetaValue } from '../data/metaRepo'
import { publishSeatRights, EVERYTHING_SNAPSHOT } from '../data/seatRights'
import { layoutHasRoute } from '../ui/layouts/layoutRegistry'
import { ProfileEntry, ProfilePage } from '../ui/ProfilePage'
import { NOT_SET_UP, NOT_SHOWN, buildProfile, diagnosticsText, whenWords, type ProfileInput } from '../ui/profileModel'
import { Settings } from '../ui/Settings'

// Phase 295 (M25): the phone Profile page. jsdom + fake-indexeddb only; invented data. A real phone, real storage numbers and the real
// master are NOT checked here.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; publishSeatRights(EVERYTHING_SNAPSHOT); vi.unstubAllGlobals() })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const newDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
async function mount(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await settle()
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }

const EMPTY: ProfileInput = {
  version: '0.1.63',
  meta: { branchName: null, poPrefix: null, linked: false, lastExportAt: null },
  seat: { seatNo: null, flags: ALL_SEAT_RIGHTS, source: 'not_linked', checkedAt: null },
  priceFlags: null, counts: null, storage: null, selfCheck: null, engine: null, company: null, companyDefaultVersion: null, payments: null, writable: true
}
const textOf = (v: ReturnType<typeof buildProfile>): string => v.groups.flatMap((g) => [g.title, ...g.rows.flatMap((r) => [r.label, r.value]), g.note ?? '']).join('\n')
const group = (v: ReturnType<typeof buildProfile>, id: string) => v.groups.find((g) => g.id === id)

describe('profile model', () => {
  it('every group missing: plain "Not set up" / "Never" lines, no blank value, all seven groups', () => {
    const v = buildProfile(EMPTY)
    expect(v.groups.map((g) => g.id)).toEqual(['who', 'connection', 'rights', 'data', 'company', 'payments', 'help'])
    for (const g of v.groups) for (const r of g.rows) expect(r.value.trim(), `${g.id}/${r.label}`).not.toBe('')
    expect(group(v, 'who')!.rows.find((r) => r.label === 'Seat')!.value).toBe(NOT_SET_UP)
    expect(group(v, 'who')!.rows.find((r) => r.label === 'App version')!.value).toBe('0.1.63')
    expect(group(v, 'connection')!.rows.find((r) => r.label === 'Signed in')!.value).toBe('No')
    expect(group(v, 'data')!.rows.find((r) => r.label === 'Last backup file saved')!.value).toBe('Never')
    expect(group(v, 'data')!.rows.find((r) => r.label === 'Last self-check')!.value).toBe('Never')
    expect(group(v, 'payments')!.rows[0]!.value).toBe(NOT_SET_UP)
    expect(group(v, 'company')!.rows[0]!.value).toBe(NOT_SET_UP)
  })

  it('a full phone shows its facts', () => {
    const v = buildProfile({
      ...EMPTY,
      meta: { branchName: 'Pune', poPrefix: 'PN', linked: true, lastExportAt: '2026-11-20T08:30:00.000Z' },
      seat: { seatNo: 2, flags: PRESETS.Full, source: 'admin', checkedAt: '2026-11-25T08:30:00.000Z' },
      priceFlags: { add: true, edit: true, overwrite: false, delete: false, structure: false },
      counts: { bills: 12, customers: 4, priceRows: 30 },
      storage: { persistApiAvailable: true, persisted: true, usageBytes: 2048, quotaBytes: 1048576 },
      selfCheck: { at: '2026-11-25T08:35:00.000Z', outcome: 'in_step', fetched: 0, reason: '' },
      engine: { lastSuccessAt: '2026-11-25T08:40:00.000Z', pending: 2, failed: 1 },
      company: { name: 'Acme Pipes', hasPhone: true, hasAddress: false, hasLogo: true, fromCompanyDefault: true },
      companyDefaultVersion: 3,
      payments: { stored: true, count: 3, defaultName: 'Main bank', version: 5, unpublished: false }
    })
    const rows = (id: string): Record<string, string> => Object.fromEntries(group(v, id)!.rows.map((r) => [r.label, r.value]))
    expect(rows('who')).toMatchObject({ Seat: 'Seat 2', Company: 'Acme Pipes', Branch: 'Pune', 'PO prefix': 'PN' })
    expect(rows('connection')).toMatchObject({ 'Signed in': 'Yes', 'Bills only on this phone': '3', 'Company defaults from your admin': 'Received (version 3)' })
    expect(rows('rights')['Price List: Change existing prices']).toBe('Not allowed')
    expect(rows('rights')['Price List: Add new items']).toBe('Allowed')
    expect(rows('data')).toMatchObject({ Bills: '12', Customers: '4', 'Price List rows': '30', 'Protected from clean-up': 'Yes' })
    expect(rows('data')['Last self-check']).toMatch(/^Checked \d\d:\d\d, all in step$/)
    expect(rows('company')).toMatchObject({ Phone: 'Set', Address: NOT_SET_UP, Logo: 'Set', 'Comes from': 'Your admin (company default)' })
    expect(rows('payments')).toMatchObject({ Payees: '3', 'Default payee': 'Main bank', 'List version': '5' })
    expect(group(v, 'company')!.link).toEqual({ id: 'company', label: 'Open Company settings' })
  })

  it('a restricted phone: Payments group gone, Price List rows not shown, flags read Not allowed, honest limit stated', () => {
    const flags: SeatFlags = { ...NO_SEAT_RIGHTS, shareBills: true }
    const v = buildProfile({ ...EMPTY, meta: { ...EMPTY.meta, linked: true }, seat: { seatNo: 3, flags, source: 'admin', checkedAt: null }, counts: { bills: 1, customers: 1, priceRows: 9 } })
    expect(group(v, 'payments')).toBeUndefined()
    expect(v.groups.at(-1)!.id).toBe('help')
    expect(group(v, 'data')!.rows.find((r) => r.label === 'Price List rows')!.value).toBe(NOT_SHOWN)
    const rights = group(v, 'rights')!
    expect(rights.rows.find((r) => r.label === 'Share bills (image, PDF, QR)')!.value).toBe('Allowed')
    expect(rights.rows.filter((r) => r.value === 'Not allowed').length).toBeGreaterThanOrEqual(SEAT_RIGHT_FLAGS.length - 1)
    expect(rights.rows.find((r) => r.label === 'Last checked')!.value).toBe('Not checked yet')
    expect(rights.note).toContain('hide and block things in the app only')
    expect(textOf(v)).not.toMatch(/secure|leak-proof/i)
  })

  it('whenWords is calm about junk', () => {
    expect(whenWords(null)).toBe('Never'); expect(whenWords('nonsense')).toBe('Never')
    expect(whenWords('2026-11-25T08:30:00.000Z')).toMatch(/^\d{1,2} Nov 2026, \d\d:\d\d$/)
  })

  it('model and loader are read only and never reach the network (source scan)', () => {
    for (const f of ['../ui/profileModel.ts', '../ui/loadProfile.ts']) {
      const src = readFileSync(resolve(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/fetch\(|XMLHttpRequest|putRecord|deleteRecord|setSetting|setMetaValue|writePayments|localStorage/)
      expect(src, f).not.toMatch(/from '\.\.\/\.\.\/main|from 'electron'/)
    }
  })
})

describe('profile page', () => {
  it('opens on an empty phone with every group, edits nothing and does not touch the network', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('no network in this test') })
    vi.stubGlobal('fetch', fetchSpy)
    const db = await newDb()
    const before = await countRecords(db, 'meta')
    const h = await mount(createElement(ProfilePage, { db, version: '0.1.63', storageEnv: {} }))
    for (const id of ['who', 'connection', 'rights', 'data', 'company', 'payments', 'help']) expect(h.querySelector(`[data-testid="profile-${id}"]`), id).toBeTruthy()
    expect(h.textContent).toContain('0.1.63')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await countRecords(db, 'meta')).toBe(before)
  })

  it('a restricted live snapshot removes the Payments group', async () => {
    const db = await newDb()
    publishSeatRights({ flags: { ...PRESETS.Staff }, source: 'admin', checkedAt: '2026-11-25T08:00:00.000Z' })
    const h = await mount(createElement(ProfilePage, { db, version: '1', storageEnv: {} }))
    expect(h.querySelector('[data-testid="profile-payments"]')).toBeNull()
    expect(h.querySelector('[data-testid="profile-rights"]')).toBeTruthy()
  })

  it('redaction scan: no bank, UPI, code, token or password text on the page or in the copied diagnostics', async () => {
    const db = await newDb()
    const list = seedList()
    await writePayments(db, { ...list, version: 4 }, false)
    await setMetaValue(db, 'org_id', 'org-SECRET-0001')
    await setMetaValue(db, 'branch_name', 'Pune')
    const secrets: string[] = []
    for (const a of list.accounts) {
      if (a.upiId) secrets.push(a.upiId)
      if (a.account?.number) secrets.push(a.account.number)
      if (a.account?.ifsc) secrets.push(a.account.ifsc)
      if (a.merchant) for (const v of Object.values(a.merchant)) if (typeof v === 'string' && v.length > 5) secrets.push(v)
    }
    secrets.push('org-SECRET-0001')
    expect(secrets.length).toBeGreaterThan(2)
    let copied = ''
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => { copied = t } } })
    const h = await mount(createElement(ProfilePage, { db, version: '0.1.63', storageEnv: {}, onOpenPayments: () => undefined, onOpenCompany: () => undefined }))
    await click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Copy diagnostics'))
    const page = h.textContent ?? ''
    expect(page).toContain('Payees')
    expect(copied).toContain('phone profile')
    for (const s of secrets) { expect(page, s).not.toContain(s); expect(copied, s).not.toContain(s) }
    for (const t of [page, copied]) {
      expect(t).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|service_role|password\s*[:=]|token\s*[:=]|[\w.-]+@(?!gmail)[a-z]{2,}/i)
    }
    expect(copied).not.toContain('Support')
  })

  it('the links call their openers', async () => {
    const db = await newDb()
    let company = 0, pay = 0
    const h = await mount(createElement(ProfilePage, { db, version: '1', storageEnv: {}, onOpenCompany: () => { company++ }, onOpenPayments: () => { pay++ } }))
    await click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Open Company settings'))
    await click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Open Payments'))
    expect([company, pay]).toEqual([1, 1])
  })
})

describe('entries and routing', () => {
  it('Settings shows Profile FIRST, only inside a new layout that passes the opener', async () => {
    const db = await newDb()
    let opened = 0
    const base = { db, version: '0', theme: 'light' as never, onTheme: () => undefined }
    const h = await mount(createElement(Settings, { ...base, plain: true, onOpenProfile: () => { opened++ } }))
    const items = [...h.querySelectorAll('.q3-menu-item')]
    expect(items[0]!.querySelector('.q3-menu-label')!.textContent).toBe('Profile')
    await click(items[0])
    expect(opened).toBe(1)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const h2 = await mount(createElement(Settings, { ...base }))
    expect([...h2.querySelectorAll('.q3-menu-item')].some((b) => (b.textContent ?? '').includes('Profile'))).toBe(false)
  })

  it('the Home entry opens the route; Classic has no Profile page, the three new layouts do', async () => {
    let opened = 0
    const h = await mount(createElement(ProfileEntry, { onOpen: () => { opened++ } }))
    await click(h.querySelector('button'))
    expect(opened).toBe(1)
    expect(layoutHasRoute('classic', 'profile')).toBe(false)
    for (const l of ['tidy', 'guided', 'inbox'] as const) expect(layoutHasRoute(l, 'profile'), l).toBe(true)
  })
})
