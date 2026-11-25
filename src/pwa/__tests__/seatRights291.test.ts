// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { ACTION_OFF_WORDS, ALL_SEAT_RIGHTS, OLD_BILLS_VIEW_ONLY, isOlderThanToday, localDateString, type SeatFlags } from '../../shared/seatRights'
import type { Bill } from '../../shared/types'
import { deleteBills, restoreBills, saveBill } from '../data/billsRepo'
import { addCustomer, editCustomer } from '../data/customersRepo'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { readPayments, writePayments } from '../data/paymentsRepo'
import { listPartyRecords, saveBillWithParty } from '../data/partiesRepo'
import { EVERYTHING_SNAPSHOT, publishSeatRights, RightsRefusedError } from '../data/seatRights'
import { makeShareFile, type PhoneCompany } from '../share/shareBill'
import { shareFile, type ShareEnv } from '../share/shareSheet'
import { BillView } from '../ui/BillView'
import { Customers } from '../ui/Customers'
import { ShareBar } from '../ui/kit/ShareBar'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 291 (M25): the five action flags, each on and off, in the repo AND on the screen. Invented data only.
const NOW = (): Date => new Date(2026, 9, 21, 10, 0, 0) // local 21 Oct 2026
const only = (flag: keyof SeatFlags, value: boolean): SeatFlags => ({ ...ALL_SEAT_RIGHTS, [flag]: value })
const setRights = (flags: SeatFlags): void => publishSeatRights({ flags: { ...flags }, source: 'admin', checkedAt: 'x' })
const mkBill = (id: string, date: string, party = 'Acme Test Traders'): Bill => ({ id, poNumber: '', party: { name: party, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: date, rows: [row('steel pipe', '2', '50')] } as unknown as Bill)
const COMPANY: PhoneCompany = { name: 'Phone Co', phone: '', address: '', logoDataUrl: null }

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; publishSeatRights(EVERYTHING_SNAPSHOT) })
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
async function render(el: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await tick()
  return host
}
async function freshDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone'); await setMetaValue(db, 'po_prefix', 'PH-')
  return db
}
const save = (db: PhoneDb, b: Bill) => saveBillWithParty(db, { bill: b }, { now: NOW })
const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll('button')].map((b) => b.textContent ?? '')

describe('Phase 291 - the older-than-today rule', () => {
  it('uses the local calendar date; today and later are not old', () => {
    expect(localDateString(NOW())).toBe('2026-10-21')
    expect(isOlderThanToday('2026-10-20', NOW())).toBe(true)
    expect(isOlderThanToday('2026-10-21', NOW())).toBe(false)
    expect(isOlderThanToday('2026-10-22', NOW())).toBe(false)
    expect(isOlderThanToday('', NOW())).toBe(false)
  })
})

describe('Phase 291 - deleteBills', () => {
  it('delete refuses when off, works when on; Trash restore stays allowed', async () => {
    const db = await freshDb()
    const r = await save(db, mkBill('b1', '2026-10-21'))
    setRights(only('deleteBills', false))
    await expect(deleteBills(db, [r.id], { now: NOW })).rejects.toBeInstanceOf(RightsRefusedError)
    setRights(ALL_SEAT_RIGHTS)
    await expect(deleteBills(db, [r.id], { now: NOW })).resolves.toMatchObject({ deleted: [r.id] })
    setRights(only('deleteBills', false))
    await expect(restoreBills(db, [r.id], { now: NOW })).resolves.toMatchObject({ restored: [r.id] })
  })
})

describe('Phase 291 - editOldBills', () => {
  it('a bill dated before today is refused when off; a bill dated today or later is not', async () => {
    const db = await freshDb()
    setRights(only('editOldBills', false))
    await expect(save(db, mkBill('old', '2026-10-20'))).rejects.toThrow(OLD_BILLS_VIEW_ONLY)
    await expect(save(db, mkBill('today', '2026-10-21'))).resolves.toBeTruthy()
    await expect(save(db, mkBill('later', '2026-10-25'))).resolves.toBeTruthy()
    setRights(ALL_SEAT_RIGHTS)
    await expect(save(db, mkBill('old', '2026-10-20'))).resolves.toBeTruthy()
  })
  it('an existing old bill cannot be re-dated to today when off (the stored date counts)', async () => {
    const db = await freshDb()
    const r = await save(db, mkBill('o2', '2026-10-01'))
    setRights(only('editOldBills', false))
    await expect(save(db, mkBill(r.id, '2026-10-21'))).rejects.toBeInstanceOf(RightsRefusedError)
  })
  it('bill view: Edit is disabled with the plain line for an old bill; a today bill stays editable', async () => {
    const db = await freshDb()
    const old = await save(db, mkBill('o3', '2026-01-02'))
    const today = await save(db, mkBill('t3', localDateString(new Date())))
    setRights(only('editOldBills', false))
    let el = await render(createElement(BillView, { db, id: old.id, onEdit: () => undefined, onDeleted: () => undefined }))
    expect(el.textContent).toContain(OLD_BILLS_VIEW_ONLY)
    expect((([...el.querySelectorAll('button')].find((b) => b.textContent === 'Edit')) as HTMLButtonElement).disabled).toBe(true)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    el = await render(createElement(BillView, { db, id: today.id, onEdit: () => undefined, onDeleted: () => undefined }))
    expect(el.textContent).not.toContain(OLD_BILLS_VIEW_ONLY)
    expect((([...el.querySelectorAll('button')].find((b) => b.textContent === 'Edit')) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('Phase 291 - editCustomers', () => {
  it('add / edit refuse when off; the bill still saves with its typed name and no customer is made', async () => {
    const db = await freshDb()
    setRights(only('editCustomers', false))
    await expect(addCustomer(db, { name: 'Zed Test', phone: '', address: '', transport: '' })).rejects.toBeInstanceOf(RightsRefusedError)
    const r = await save(db, mkBill('c1', '2026-10-21', 'Typed Only Name'))
    expect(r.partyId).toBeNull()
    expect(await listPartyRecords(db)).toHaveLength(0)
    setRights(ALL_SEAT_RIGHTS)
    const made = await addCustomer(db, { name: 'Zed Test', phone: '', address: '', transport: '' })
    setRights(only('editCustomers', false))
    await expect(editCustomer(db, made.id, { phone: '1', address: '', transport: '' })).rejects.toBeInstanceOf(RightsRefusedError)
  })
  it('re-saving a bill that already has a customer keeps the link and changes no customer', async () => {
    const db = await freshDb()
    const r = await save(db, mkBill('c2', '2026-10-21', 'Linked Test'))
    expect(r.partyId).not.toBeNull()
    setRights(only('editCustomers', false))
    const again = await save(db, mkBill('c2', '2026-10-21', 'Linked Test Renamed'))
    expect(again.partyId).toBe(r.partyId)
    expect((await listPartyRecords(db)).map((p) => p.name)).toEqual(['Linked Test'])
  })
  it('Customers screen: Add customer is gone when off and there when on', async () => {
    const db = await freshDb()
    setRights(only('editCustomers', false))
    let el = await render(createElement(Customers, { db, onOpen: () => undefined, onAdd: () => undefined }))
    expect(buttons(el).some((t) => t.includes('Add customer'))).toBe(false)
    expect(el.textContent).toContain(ACTION_OFF_WORDS.editCustomers)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights(ALL_SEAT_RIGHTS)
    el = await render(createElement(Customers, { db, onOpen: () => undefined, onAdd: () => undefined }))
    expect(buttons(el).some((t) => t.includes('Add customer'))).toBe(true)
  })
})

describe('Phase 291 - editPayments', () => {
  it('a local edit refuses when off; the master list is still stored; viewing works', async () => {
    const db = await freshDb()
    const base = (await readPayments(db)).list
    setRights(only('editPayments', false))
    await expect(writePayments(db, base, true)).rejects.toBeInstanceOf(RightsRefusedError)
    await expect(writePayments(db, base, false)).resolves.toBeUndefined()
    await expect(readPayments(db)).resolves.toBeTruthy()
    setRights(ALL_SEAT_RIGHTS)
    await expect(writePayments(db, base, true)).resolves.toBeUndefined()
  })
})

describe('Phase 291 - shareBills', () => {
  const env: ShareEnv = { nav: undefined, makeFile: (b, n, m) => new File([b as BlobPart], n, { type: m }), download: () => undefined }
  it('shareFile and makeShareFile refuse when off', async () => {
    setRights(only('shareBills', false))
    await expect(shareFile(env, new Uint8Array([1]), 'a.png', 'image/png', 't')).rejects.toBeInstanceOf(RightsRefusedError)
    await expect(makeShareFile(mkBill('s1', '2026-10-21'), { style: 'rough', kind: 'image' }, COMPANY, {} as never)).rejects.toBeInstanceOf(RightsRefusedError)
    setRights(ALL_SEAT_RIGHTS)
    await expect(shareFile(env, new Uint8Array([1]), 'a.png', 'image/png', 't')).resolves.toMatchObject({ outcome: 'downloaded' })
  })
  it('share bar and bill view: no Share / Share QR / Delete buttons when the flags are off, the plain lines instead; Edit stays', async () => {
    const db = await freshDb()
    const r = await save(db, mkBill('s2', localDateString(new Date())))
    setRights({ ...ALL_SEAT_RIGHTS, shareBills: false, deleteBills: false })
    let el = await render(createElement(BillView, { db, id: r.id, onEdit: () => undefined, onDeleted: () => undefined }))
    expect(buttons(el)).toContain('Edit')
    expect(buttons(el)).not.toContain('Share')
    expect(buttons(el)).not.toContain('Delete')
    expect(el.textContent).toContain(ACTION_OFF_WORDS.shareBills)
    expect(el.textContent).toContain(ACTION_OFF_WORDS.deleteBills)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    el = await render(createElement(ShareBar, { db, bill: mkBill('s3', '2026-10-21'), mode: 'view', onShareQr: () => undefined, onEdit: () => undefined }))
    expect(buttons(el)).toEqual(['Edit'])
    expect(el.textContent).toContain(ACTION_OFF_WORDS.shareBills)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights(ALL_SEAT_RIGHTS)
    el = await render(createElement(ShareBar, { db, bill: mkBill('s3', '2026-10-21'), mode: 'view', onShareQr: () => undefined, onEdit: () => undefined }))
    expect(buttons(el)).toEqual(expect.arrayContaining(['Share', 'Share QR', 'Edit']))
  })
})
