// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ALL_SEAT_RIGHTS, NOT_AVAILABLE_WORDS, SALES_NOT_SHOWN, type SeatFlags } from '../../shared/seatRights'
import { exportBackup, importBackup } from '../data/backup'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { readPayments, writePayments } from '../data/paymentsRepo'
import { resetPhoneData } from '../data/resetData'
import { EVERYTHING_SNAPSHOT, publishSeatRights, RightsRefusedError } from '../data/seatRights'
import { createPaymentsSync } from '../sync/payments'
import { buildDashboardView, redactDashboardSales } from '../ui/dashboardModel'
import { groupTotal, listTotal } from '../ui/historyModel'
import { gatedScreen } from '../ui/kit/RightsGate'
import { PaymentsEntry } from '../ui/kit/PaymentsPage'
import { PriceListEntry } from '../ui/kit/PriceListParts'
import { SettingsStorage } from '../ui/SettingsStorage'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 290 (M25): seePriceList, seeSales, seePayments and exportData, each with the flag on and off. Invented data only.
const only = (flag: keyof SeatFlags, value: boolean): SeatFlags => ({ ...ALL_SEAT_RIGHTS, [flag]: value })
const setRights = (flags: SeatFlags): void => publishSeatRights({ flags: { ...flags }, source: 'admin', checkedAt: 'x' })
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
const freshDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })

describe('Phase 290 - seeSales', () => {
  const heads = [{ id: 'b1', poNumber: 'PH-1', partyName: 'Acme Test', billDate: '2026-10-21', grandTotal: '1000.00' }] as never[]
  const view = buildDashboardView({
    heads, now: new Date('2026-10-21T10:00:00Z'), meta: { org_id: null, branch_id: 'x', branch_name: 'B', last_export_at: null } as never,
    backup: { state: 'ok', daysSince: 0 } as never, engine: null, writable: true
  })
  it('dashboard totals and recent amounts become "Not shown"; counts and names stay', () => {
    const on = redactDashboardSales(view, { seeSales: true })
    expect(on).toBe(view)
    expect(view.today.total).not.toBe(SALES_NOT_SHOWN)
    const r = redactDashboardSales(view, { seeSales: false })
    expect(r.today.total).toBe(SALES_NOT_SHOWN)
    expect(r.month.total).toBe(SALES_NOT_SHOWN)
    expect(r.recent[0]).toMatchObject({ partyName: 'Acme Test', total: SALES_NOT_SHOWN })
    expect(r.today.count).toBe(view.today.count)
  })
  it('history list and day-group totals', () => {
    expect(listTotal('1000.00', true)).not.toBe(SALES_NOT_SHOWN)
    expect(listTotal('1000.00', false)).toBe(SALES_NOT_SHOWN)
    expect(groupTotal('₹1,000.00', false)).toBe(SALES_NOT_SHOWN)
    expect(groupTotal('₹1,000.00')).toBe('₹1,000.00')
  })
})

describe('Phase 290 - exportData', () => {
  it('export, import and reset refuse in code when off, and work when on', async () => {
    const db = await freshDb()
    setRights(only('exportData', false))
    await expect(exportBackup(db, { appVersion: 't' })).rejects.toBeInstanceOf(RightsRefusedError)
    await expect(importBackup(db, '{}')).rejects.toBeInstanceOf(RightsRefusedError)
    await expect(resetPhoneData(db)).rejects.toBeInstanceOf(RightsRefusedError)
    await expect(resetPhoneData(db)).rejects.toThrow(/needs/)
    setRights(only('exportData', true))
    await expect(exportBackup(db, { appVersion: 't' })).resolves.toBeTruthy()
    await expect(resetPhoneData(db)).resolves.toBeUndefined()
  })
  it('Settings > Storage hides the three actions but keeps the status lines; every flag off still renders', async () => {
    const db = await freshDb()
    setRights(only('exportData', true))
    let el = await render(createElement(SettingsStorage, { db, version: 't', storageEnv: {} }))
    expect(el.textContent).toContain('Export backup')
    expect(el.textContent).toContain('Reset phone data')
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights({ ...ALL_SEAT_RIGHTS, seeAddress: false, seeContact: false, seePriceList: false, seeSales: false, seePayments: false, shareBills: false, exportData: false, deleteBills: false, editOldBills: false, editCustomers: false, editPayments: false })
    el = await render(createElement(SettingsStorage, { db, version: 't', storageEnv: {} }))
    expect(el.textContent).not.toContain('Export backup')
    expect(el.textContent).not.toContain('Import backup')
    expect(el.textContent).not.toContain('Reset phone data')
    expect(el.textContent).toContain('Kept by the browser')
    expect(el.textContent).toContain('switched off for this phone')
  })
})

describe('Phase 290 - seePriceList and seePayments: entries and routes', () => {
  it('home entries are gone when off, present when on', async () => {
    const db = await freshDb()
    setRights(ALL_SEAT_RIGHTS)
    let el = await render(createElement('div', null, createElement(PriceListEntry, { db, onOpen: () => undefined }), createElement(PaymentsEntry, { onOpen: () => undefined })))
    expect(el.querySelectorAll('button')).toHaveLength(2)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights({ ...ALL_SEAT_RIGHTS, seePriceList: false })
    el = await render(createElement('div', null, createElement(PriceListEntry, { db, onOpen: () => undefined }), createElement(PaymentsEntry, { onOpen: () => undefined })))
    expect(el.querySelectorAll('button')).toHaveLength(1)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights({ ...ALL_SEAT_RIGHTS, seePayments: false })
    el = await render(createElement('div', null, createElement(PriceListEntry, { db, onOpen: () => undefined }), createElement(PaymentsEntry, { onOpen: () => undefined })))
    expect(el.querySelectorAll('button')).toHaveLength(1)
    expect(el.textContent).toContain('Price List')
  })
  it('a gated route shows "Not available" and goes back; the screen is not mounted', async () => {
    let mounted = 0; let backs = 0
    const Inner = (): ReactElement => { mounted++; return createElement('p', null, 'INNER') }
    const Gated = gatedScreen(Inner as never, 'seePriceList')
    setRights(only('seePriceList', false))
    let el = await render(createElement(Gated as never, { onBack: () => { backs++ } } as never))
    expect(el.textContent).toBe(NOT_AVAILABLE_WORDS)
    expect(mounted).toBe(0); expect(backs).toBeGreaterThan(0)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights(ALL_SEAT_RIGHTS)
    el = await render(createElement(Gated as never, { onBack: () => { backs = -99 } } as never))
    expect(el.textContent).toBe('INNER')
    expect(backs).toBeGreaterThan(-99)
  })
  it('without seePayments the phone drops the stored list and does not ask the master; with it, it asks', async () => {
    const db = await freshDb()
    const base = (await readPayments(db)).list
    await writePayments(db, base, false)
    expect((await readPayments(db)).stored).toBe(true)
    let asked = 0
    const sync = createPaymentsSync({
      db, vault: { load: async () => ({ deviceToken: 'tok' }) as never },
      master: { configured: () => true, paymentsGet: async () => { asked++; return { version: 0, list: null } as never }, paymentsSet: async () => ({}) as never } as never
    })
    setRights(only('seePayments', false))
    expect(await sync.refresh(true)).toBe('skipped')
    expect(asked).toBe(0)
    expect((await readPayments(db)).stored).toBe(false)
    setRights(ALL_SEAT_RIGHTS)
    await sync.refresh(true)
    expect(asked).toBe(1)
  })
})
