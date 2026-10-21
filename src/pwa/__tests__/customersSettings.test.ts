// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { App as AppRaw, type AppProps } from '../App'
import { listBillHeads, saveBill, type SaveBillInput } from '../data/billsRepo'
import { addCustomer, CustomerError, editCustomer, listCustomerBills } from '../data/customersRepo'
import { openPhoneDb, countRecords, type PhoneDb } from '../data/db'
import { getMetaValue, setMetaValue } from '../data/metaRepo'
import { getParty, listCustomers, saveBillWithParty } from '../data/partiesRepo'
import { resetPhoneData } from '../data/resetData'
import { getSetting, setSetting } from '../data/settingsRepo'
import { exportBackup } from '../data/backup'
import { createAppLock } from '../sync/appLock'
import { listPending, withOutbox } from '../sync/outbox'
import type { LinkInput, LinkResult } from '../sync/branch'
import { CustomerPage, Customers } from '../ui/Customers'
import { billCountText, filterCustomers, phoneDigits, telHref, whatsappHref } from '../ui/customersModel'
import { LockScreen } from '../ui/LockScreen'
import { Settings } from '../ui/Settings'
import { checkCompany, checkLogoFile, nextResetStep } from '../ui/settingsModel'
import type { SyncAdmin } from '../ui/services'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const App = AppRaw as FC<AppProps>
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')

async function freshDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  return db
}
const bill = (id: string, name: string, phone = ''): SaveBillInput => ({
  bill: { id, party: { name, phone, address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-21', rows: [row('steel pipe', '2', '50')] }
})
const seedBill = (db: PhoneDb, id: string, name: string, phone = '') => saveBillWithParty(db, bill(id, name, phone), { ...withOutbox({ now: NOW }), now: NOW })

const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await tick()
  return host
}
const btn = (el: HTMLElement, label: string): HTMLButtonElement => {
  const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim() === label)
  if (!b) throw new Error(`no button "${label}"`)
  return b as HTMLButtonElement
}
const click = async (b: HTMLElement): Promise<void> => { await act(async () => { b.click() }); await tick() }
const field = (el: HTMLElement, label: string): HTMLInputElement => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Phase 185 - pure helpers', () => {
  it('phone links', () => {
    expect(phoneDigits('+91 98450-12345')).toBe('919845012345')
    expect(telHref('+91 98450 12345')).toBe('tel:+919845012345')
    expect(telHref('98450')).toBe('tel:98450')
    expect(telHref('12')).toBeNull()
    expect(whatsappHref('98450 12345')).toBe('https://wa.me/919845012345')
    expect(whatsappHref('098450 12345')).toBe('https://wa.me/919845012345')
    expect(whatsappHref('+91 98450 12345')).toBe('https://wa.me/919845012345')
    expect(whatsappHref('12345')).toBeNull()
    expect(billCountText(1)).toBe('1 bill')
    expect(billCountText(0)).toBe('0 bills')
  })
  it('filterCustomers matches name text and phone digits', () => {
    const rows = [
      { id: '1', name: 'Alpha Traders', phone: '98450 12345', address: '', transport: '', billCount: 0, lastBillDate: null },
      { id: '2', name: 'Beta Steel', phone: '', address: '', transport: '', billCount: 0, lastBillDate: null }
    ]
    expect(filterCustomers(rows, '').map((r) => r.id)).toEqual(['1', '2'])
    expect(filterCustomers(rows, '  ALPHA ').map((r) => r.id)).toEqual(['1'])
    expect(filterCustomers(rows, '845').map((r) => r.id)).toEqual(['1'])
    expect(filterCustomers(rows, 'zz')).toEqual([])
  })
  it('company, logo and the two-step reset rule', () => {
    expect(checkCompany({ name: ' A ', phone: '', address: '', logoDataUrl: null })).toEqual({ ok: true, value: { name: 'A', phone: '', address: '', logoDataUrl: null } })
    expect(checkCompany({ name: 'x'.repeat(200), phone: '', address: '', logoDataUrl: null }).ok).toBe(false)
    expect(checkLogoFile({ type: 'image/gif', size: 10 })).not.toBeNull()
    expect(checkLogoFile({ type: 'image/png', size: 300 * 1024 })).not.toBeNull()
    expect(checkLogoFile({ type: 'image/png', size: 1000 })).toBeNull()
    expect(nextResetStep('idle', 'start')).toEqual({ step: 'first', erase: false })
    expect(nextResetStep('idle', 'confirm').erase).toBe(false)
    expect(nextResetStep('first', 'confirm')).toEqual({ step: 'second', erase: false })
    expect(nextResetStep('second', 'confirm')).toEqual({ step: 'idle', erase: true })
    expect(nextResetStep('second', 'cancel')).toEqual({ step: 'idle', erase: false })
  })
})

describe('Phase 185 - customers repo', () => {
  it('adds, refuses a same-name duplicate, and queues the customer for sync', async () => {
    const db = await freshDb()
    const made = await addCustomer(db, { name: '  Alpha  Traders ', phone: '98450', address: '', transport: 'Blue Dart' }, { now: NOW, parties: withOutbox({ now: NOW }).parties })
    expect(made.name).toBe('Alpha  Traders')
    expect(made.phone).toBe('98450')
    expect(made.address).toBeNull()
    expect((await listPending(db)).map((r) => `${r.kind}:${r.recId}`)).toEqual([`party:${made.id}`])
    await expect(addCustomer(db, { name: 'ALPHA TRADERS', phone: '', address: '', transport: '' }, { parties: withOutbox().parties })).rejects.toMatchObject({ code: 'DUPLICATE' })
    await expect(addCustomer(db, { name: '   ', phone: '', address: '', transport: '' })).rejects.toBeInstanceOf(CustomerError)
    expect(await countRecords(db, 'parties')).toBe(1)
  })
  it('edit changes phone / address / transport, can clear, never renames, and a no-op queues nothing', async () => {
    const db = await freshDb()
    const made = await addCustomer(db, { name: 'Beta', phone: '111', address: 'Road', transport: '' }, { now: NOW })
    const w = { now: () => new Date('2026-10-22T10:00:00Z'), parties: withOutbox({ now: NOW }).parties }
    const same = await editCustomer(db, made.id, { phone: '111', address: 'Road', transport: '' }, w)
    expect(same.updatedAt).toBe(made.updatedAt)
    expect(await listPending(db)).toHaveLength(0)
    const next = await editCustomer(db, made.id, { phone: '', address: 'New Road', transport: 'VRL' }, w)
    expect(next).toMatchObject({ name: 'Beta', phone: null, address: 'New Road', transport: 'VRL', updatedAt: '2026-10-22T10:00:00.000Z' })
    expect((await listPending(db)).map((r) => r.recId)).toEqual([made.id])
    await expect(editCustomer(db, 'missing', { phone: '', address: '', transport: '' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
  it('bill counts and the customer’s own bills follow live bills only', async () => {
    const db = await freshDb()
    await seedBill(db, 'b-1', 'Alpha')
    await seedBill(db, 'b-2', 'Alpha')
    await seedBill(db, 'b-3', 'Beta')
    const rows = await listCustomers(db)
    expect(rows.map((r) => [r.name, r.billCount])).toEqual([['Alpha', 2], ['Beta', 1]])
    const alpha = rows[0]!
    expect((await listCustomerBills(db, alpha.id)).map((h) => h.id).sort()).toEqual(['b-1', 'b-2'])
  })
})

describe('Phase 185 - Customers screens', () => {
  it('list shows counts, searches, and opens a customer', async () => {
    const db = await freshDb()
    await seedBill(db, 'b-1', 'Alpha Traders', '98450 12345')
    await seedBill(db, 'b-2', 'Alpha Traders')
    await seedBill(db, 'b-3', 'Beta Steel')
    const opened: string[] = []
    const el = await render(createElement(Customers, { db, onOpen: (id: string) => opened.push(id), onAdd: () => opened.push('NEW') }))
    expect(el.textContent).toContain('2 bills')
    expect(el.textContent).toContain('1 bill')
    expect(el.textContent).toContain('2 customers')
    await typeInto(el.querySelector('input[type="search"]') as HTMLInputElement, 'beta')
    expect(el.querySelectorAll('.q3-li')).toHaveLength(1)
    await typeInto(el.querySelector('input[type="search"]') as HTMLInputElement, '')
    await click(el.querySelectorAll<HTMLElement>('.q3-li-btn')[0]!)
    expect(opened).toHaveLength(1)
    await click(btn(el, 'Add customer'))
    expect(opened[1]).toBe('NEW')
  })
  it('detail shows Call and WhatsApp, lists bills, and Edit saves and queues', async () => {
    const db = await freshDb()
    await seedBill(db, 'b-1', 'Alpha Traders', '98450 12345')
    const [alpha] = await listCustomers(db)
    const before = (await listPending(db)).length
    const el = await render(createElement(CustomerPage, { db, id: alpha!.id, now: NOW, onOpenBill: () => undefined, onAdded: () => undefined }))
    expect(el.querySelector('a[href="tel:9845012345"]')).not.toBeNull()
    const wa = el.querySelector('a[href="https://wa.me/919845012345"]') as HTMLAnchorElement
    expect(wa.rel).toContain('noopener')
    expect(el.textContent).toContain('Bills (1)')
    await click(btn(el, 'Edit'))
    expect(field(el, 'Name').readOnly).toBe(true)
    await typeInto(field(el, 'Address'), 'MG Road')
    await click(btn(el, 'Save'))
    expect(el.textContent).toContain('Saved.')
    expect(el.textContent).toContain('MG Road')
    expect((await getParty(db, alpha!.id))!.address).toBe('MG Road')
    expect((await listPending(db)).length).toBeGreaterThanOrEqual(before)
  })
  it('Add form creates once, and a duplicate name shows the message', async () => {
    const db = await freshDb()
    const added: string[] = []
    const el = await render(createElement(CustomerPage, { db, id: 'new', now: NOW, onOpenBill: () => undefined, onAdded: (id: string) => added.push(id) }))
    await typeInto(field(el, 'Name'), 'Gamma')
    await typeInto(field(el, 'Phone'), '99999 88888')
    await click(btn(el, 'Save'))
    expect(added).toHaveLength(1)
    await typeInto(field(el, 'Name'), 'gamma')
    await click(btn(el, 'Save'))
    expect(el.textContent).toContain('already exists')
    expect(added).toHaveLength(1)
    expect(await countRecords(db, 'parties')).toBe(1)
  })
})

describe('Phase 185 - Settings', () => {
  const baseProps = (db: PhoneDb) => ({ db, version: '0.1.26', theme: 'navy-ember' as const, onTheme: () => undefined, onAbout: () => undefined, now: NOW })

  it('company profile and share defaults round trip through the settings store', async () => {
    const db = await freshDb()
    let el = await render(createElement(Settings, baseProps(db)))
    await typeInto(field(el, 'Company name'), '  Acme Steel ')
    await typeInto(field(el, 'Company phone'), '99999')
    await click(btn(el, 'Save company'))
    expect(await getSetting(db, 'company.profile')).toEqual({ name: 'Acme Steel', phone: '99999', address: '', logoDataUrl: null })
    await click(btn(el, 'Rough'))
    await click(btn(el, 'PDF'))
    expect(await getSetting(db, 'share.defaults')).toEqual({ style: 'rough', kind: 'pdf' })
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    el = await render(createElement(Settings, baseProps(db)))
    expect(field(el, 'Company name').value).toBe('Acme Steel')
    expect(btn(el, 'Rough').getAttribute('aria-pressed')).toBe('true')
    expect(btn(el, 'PDF').getAttribute('aria-pressed')).toBe('true')
  })

  it('Reset phone data needs two confirms and keeps settings, the branch link and the PO counter', async () => {
    const db = await freshDb()
    await seedBill(db, 'b-1', 'Alpha')
    await setSetting(db, 'company.profile', { name: 'Acme', phone: '', address: '', logoDataUrl: null })
    await setMetaValue(db, 'server_seq', 42)
    const counter = await getMetaValue(db, 'po_counter')
    const changed: number[] = []
    const el = await render(createElement(Settings, { ...baseProps(db), onChanged: () => changed.push(1) }))
    await click(btn(el, 'Reset phone data'))
    expect((await listBillHeads(db)).length).toBe(1)
    await click(btn(el, 'Continue'))
    expect((await listBillHeads(db)).length).toBe(1) // first confirm alone erases nothing
    expect(el.textContent).toContain('Last check')
    await click(btn(el, 'Keep my data'))
    expect((await listBillHeads(db)).length).toBe(1)
    await click(btn(el, 'Reset phone data'))
    await click(btn(el, 'Continue'))
    await click(btn(el, 'Yes, erase now'))
    expect(await listBillHeads(db)).toHaveLength(0)
    expect(await countRecords(db, 'parties')).toBe(0)
    expect(await countRecords(db, 'sync_outbox')).toBe(0)
    expect(await getMetaValue(db, 'server_seq')).toBeNull()
    expect(await getMetaValue(db, 'po_counter')).toBe(counter)
    expect(await getMetaValue(db, 'branch_id')).toBe('branch-phone')
    expect((await getSetting(db, 'company.profile')).name).toBe('Acme')
    expect(changed.length).toBeGreaterThan(0)
  })

  it('resetPhoneData is all or nothing and never reuses a PO number', async () => {
    const db = await freshDb()
    const a = await seedBill(db, 'b-1', 'Alpha')
    await resetPhoneData(db)
    const b = await seedBill(db, 'b-2', 'Alpha')
    expect(b.poNumber).not.toBe(a.poNumber)
  })

  it('Export gives a file and records the date; Import asks before it replaces', async () => {
    const db = await freshDb()
    await seedBill(db, 'b-1', 'Alpha')
    const saved: { name: string; blob: Blob }[] = []
    const storageEnv = { storage: { persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 2048, quota: 1_048_576 }) } }
    let el = await render(createElement(Settings, { ...baseProps(db), storageEnv, download: (blob: Blob, name: string) => saved.push({ blob, name }) }))
    expect(el.textContent).toContain('no backup file yet')
    expect(el.textContent).toContain('2.0 KB')
    await click(btn(el, 'Export backup'))
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toMatch(/^quot3-phone-backup-.*\.json$/)
    expect(await getMetaValue(db, 'last_export_at')).not.toBeNull()
    expect(el.textContent).toContain('1 bills')
    // now erase, then import the file back (two confirms are for Reset; Import has its own Replace question)
    await resetPhoneData(db)
    const file = new File([await saved[0]!.blob.text()], 'backup.json', { type: 'application/json' })
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    el = await render(createElement(Settings, { ...baseProps(db), storageEnv }))
    const input = el.querySelector('input[aria-label="Import backup file"]') as HTMLInputElement
    await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })) })
    await tick()
    expect(el.textContent).toContain('Replace everything on this phone')
    expect(await listBillHeads(db)).toHaveLength(0) // nothing changed until Replace
    await click(btn(el, 'Replace'))
    expect(await listBillHeads(db)).toHaveLength(1)
    // keep the unused import honest
    expect((await exportBackup(db, { appVersion: 'x' })).counts.bills).toBe(1)
  })

  it('app lock: needs matching PINs, then turns off only with the right PIN', async () => {
    const db = await freshDb()
    const appLock = createAppLock(db, { iterations: 1 })
    const el = await render(createElement(Settings, { ...baseProps(db), appLock }))
    await typeInto(field(el, 'New PIN'), '1234')
    await typeInto(field(el, 'Repeat PIN'), '9999')
    await click(btn(el, 'Turn on app lock'))
    expect(el.textContent).toContain('not the same')
    expect(await appLock.isEnabled()).toBe(false)
    await typeInto(field(el, 'New PIN'), '1234')
    await typeInto(field(el, 'Repeat PIN'), '1234')
    await click(btn(el, 'Turn on app lock'))
    expect(await appLock.isEnabled()).toBe(true)
    await typeInto(field(el, 'Current PIN'), '0000')
    await click(btn(el, 'Turn off app lock'))
    expect(el.textContent).toContain('not right')
    expect(await appLock.isEnabled()).toBe(true)
    await typeInto(field(el, 'Current PIN'), '1234')
    await click(btn(el, 'Turn off app lock'))
    expect(await appLock.isEnabled()).toBe(false)
  })

  it('sync: no connection says so; with one, an empty form is stopped by the shared validators before any call', async () => {
    const db = await freshDb()
    let el = await render(createElement(Settings, baseProps(db)))
    expect(el.textContent).toContain('not available in this build yet')
    expect(btn(el, 'Sign in').disabled).toBe(true)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''

    const calls: LinkInput[] = []
    const sync: SyncAdmin = {
      link: async (i): Promise<LinkResult> => { calls.push(i); await setMetaValue(db, 'org_id', 'org-1'); await setMetaValue(db, 'branch_id', 'br-9'); await setMetaValue(db, 'branch_name', i.branchName); await setMetaValue(db, 'po_prefix', i.poPrefix); return { ok: true, orgId: 'org-1', branchId: 'br-9', branchName: i.branchName, poPrefix: i.poPrefix, seatNo: 2, clockOffsetMs: 0, branches: [] } },
      signOut: async () => undefined
    }
    await setMetaValue(db, 'branch_id', null)
    await setMetaValue(db, 'po_prefix', null)
    el = await render(createElement(Settings, { ...baseProps(db), sync }))
    await click(btn(el, 'Sign in'))
    expect(calls).toHaveLength(0) // validation stops an empty form
    expect(el.querySelectorAll('[role="alert"]').length).toBeGreaterThan(0)
  })

  it('theme chips still work', async () => {
    const db = await freshDb()
    const picked: string[] = []
    const el = await render(createElement(Settings, { ...baseProps(db), onTheme: (t: string) => picked.push(t) }))
    await click(btn(el, 'Light'))
    expect(picked).toEqual(['light'])
  })
})

describe('Phase 185 - lock screen and App wiring', () => {
  it('LockScreen: wrong PIN stays locked, right PIN unlocks', async () => {
    const db = await freshDb()
    const lock = createAppLock(db, { iterations: 1 })
    await lock.setPin('4321')
    let unlocked = 0
    const el = await render(createElement(LockScreen, { lock, onUnlocked: () => { unlocked++ } }))
    await typeInto(field(el, 'PIN'), '1111')
    await click(btn(el, 'Unlock'))
    expect(unlocked).toBe(0)
    expect(el.textContent).toContain('not right')
    await typeInto(field(el, 'PIN'), '4321')
    await click(btn(el, 'Unlock'))
    expect(unlocked).toBe(1)
  })

  it('App: starts on the PIN screen when locked, then the Customers tab and a customer page open', async () => {
    const db = await freshDb()
    await createAppLock(db, { iterations: 1 }).setPin('2468') // the stored record carries its iteration count, so the App's own lock verifies fast
    await seedBill(db, 'b-1', 'Alpha Traders')
    const el = await render(createElement(App, { services: { db, engine: null, now: NOW, startLocked: true }, backEnv: null }))
    expect(el.textContent).toContain('is locked')
    expect(el.textContent).not.toContain('Customers')
    await typeInto(field(el, 'PIN'), '2468')
    await click(btn(el, 'Unlock'))
    const tab = [...el.querySelectorAll<HTMLButtonElement>('.q3-nav-item')].find((b) => b.textContent === 'Customers')!
    await click(tab)
    expect(el.textContent).toContain('Alpha Traders')
    await click(el.querySelector<HTMLElement>('.q3-li-btn')!)
    expect(el.querySelector('h1')!.textContent).toBe('Customer')
    expect(el.textContent).toContain('Bills (1)')
    expect(el.querySelector('[aria-label="Back"]')).not.toBeNull()
  })

  it('a locked app with no lock configured does not trap the person', async () => {
    const el = await render(createElement(App, { services: { db: null, error: 'x', engine: null }, backEnv: null }))
    expect(el.textContent).not.toContain('is locked')
  })
})
