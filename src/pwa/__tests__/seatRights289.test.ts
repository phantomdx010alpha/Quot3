// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { ALL_SEAT_RIGHTS, HIDDEN_BY_ADMIN, redactParty } from '../../shared/seatRights'
import type { Bill } from '../../shared/types'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { saveBillWithParty } from '../data/partiesRepo'
import { withOutbox } from '../sync/outbox'
import { EVERYTHING_SNAPSHOT, publishSeatRights } from '../data/seatRights'
import { computePageBreaks as _unused, layoutPrintModel, layoutTexts, type Measure } from '../share/layout'
import { modelFor } from '../share/shareBill'
import { buildBillView, redactBillViewParty } from '../ui/billViewModel'
import { contactLinks, filterCustomers, redactSuggestions } from '../ui/customersModel'
import { CustomerPage, Customers } from '../ui/Customers'

void _unused
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 289 (M25): hide customer address and contact IN THE APP; the shared image / PDF keep them (D6). Invented data only.
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')
const off = { ...ALL_SEAT_RIGHTS, seeAddress: false, seeContact: false }
const setRights = (flags: typeof ALL_SEAT_RIGHTS): void => publishSeatRights({ flags: { ...flags }, source: 'admin', checkedAt: 'x' })
const PHONE = '98450 12345'
const ADDRESS = '12 Test Lane, Sampletown'
const mkBill = (): Bill => ({ id: 'b1', poNumber: 'PH-1', party: { name: 'Acme Test Traders', phone: PHONE, address: ADDRESS, transport: 'Lorry' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-21', rows: [row('steel pipe', '2', '50')] } as unknown as Bill)

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; publishSeatRights(EVERYTHING_SNAPSHOT) })
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
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
async function seed(db: PhoneDb): Promise<void> {
  await saveBillWithParty(db, { bill: mkBill() } as never, { ...withOutbox({ now: NOW }), now: NOW })
}

describe('Phase 289 - redactParty', () => {
  it('replaces only the blanked fields, never changes the input', () => {
    const p = { name: 'A', phone: PHONE, address: ADDRESS, transport: 'T' }
    const r = redactParty(p, off)
    expect(r).toEqual({ name: 'A', phone: HIDDEN_BY_ADMIN, address: HIDDEN_BY_ADMIN, transport: 'T' })
    expect(p.phone).toBe(PHONE)
    expect(redactParty(p, { seeAddress: true, seeContact: false })).toMatchObject({ phone: HIDDEN_BY_ADMIN, address: ADDRESS })
    expect(redactParty(p, { seeAddress: false, seeContact: true })).toMatchObject({ phone: PHONE, address: HIDDEN_BY_ADMIN })
    expect(redactParty(p, ALL_SEAT_RIGHTS)).toEqual(p)
  })
})

describe('Phase 289 - screen models', () => {
  const rows = [{ id: '1', name: 'Acme Test', phone: '98450 12345', address: null, transport: null, billCount: 1, lastBillDate: null }] as never[]
  it('customer search is name only without seeContact', () => {
    expect(filterCustomers(rows, '984501')).toHaveLength(1)
    expect(filterCustomers(rows, '984501', { seeContact: true })).toHaveLength(1)
    expect(filterCustomers(rows, '984501', { seeContact: false })).toHaveLength(0)
    expect(filterCustomers(rows, 'acme', { seeContact: false })).toHaveLength(1)
  })
  it('call and WhatsApp links disappear without seeContact', () => {
    expect(contactLinks(PHONE, { seeContact: true }).call).toMatch(/^tel:/)
    expect(contactLinks(PHONE, { seeContact: false })).toEqual({ call: null, whatsapp: null })
  })
  it('suggestions: marker text, and a digits query matches the name only', () => {
    const list = [{ id: '1', name: 'Acme Test', phone: PHONE, address: ADDRESS, transport: '' }]
    expect(redactSuggestions(list, 'acme', off)[0]).toMatchObject({ phone: HIDDEN_BY_ADMIN, address: HIDDEN_BY_ADMIN })
    expect(redactSuggestions(list, '984501', off)).toHaveLength(0)
    expect(redactSuggestions(list, '984501', ALL_SEAT_RIGHTS)).toHaveLength(1)
    expect(list[0]!.phone).toBe(PHONE)
  })
  it('bill view party block: marker lines, no blanks, name and transport stay', () => {
    const v = buildBillView(mkBill())
    const r = redactBillViewParty(v, off)
    expect(r.party.map((f) => [f.key, f.value])).toEqual([['name', 'Acme Test Traders'], ['phone', HIDDEN_BY_ADMIN], ['transport', 'Lorry'], ['address', HIDDEN_BY_ADMIN]])
    expect(redactBillViewParty(v, ALL_SEAT_RIGHTS)).toBe(v)
    expect(JSON.stringify(r)).not.toContain('Sampletown')
  })
})

describe('Phase 289 - the share exception (D6)', () => {
  it('with both flags off the shared layout still has the address and phone; the screen model does not', () => {
    const measure: Measure = (t, s) => t.length * s.sizePx * 0.5
    const bill = mkBill()
    const all = layoutTexts(layoutPrintModel(modelFor(bill, 'professional', { name: 'Phone Co', phone: '99000 11111', address: '1 High St', logoDataUrl: null }), measure)).join('').replace(/\s+/g, '')
    expect(all).toContain(ADDRESS.replace(/\s+/g, ''))
    expect(all).toContain(PHONE.replace(/\s+/g, ''))
    expect(JSON.stringify(redactBillViewParty(buildBillView(bill), off))).not.toContain(PHONE)
    expect(bill.party.phone).toBe(PHONE) // nothing mutated
  })
})

describe('Phase 289 - Customers screens', () => {
  it('list and detail show the marker and no Call / WhatsApp with both flags off; on shows the values', async () => {
    const db = await freshDb(); await seed(db)
    setRights(off)
    let el = await render(createElement(Customers, { db, onOpen: () => undefined, onAdd: () => undefined }))
    expect(el.textContent).toContain(HIDDEN_BY_ADMIN)
    expect(el.textContent).not.toContain(PHONE)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const id = (await (await import('../data/partiesRepo')).listCustomers(db))[0]!.id
    el = await render(createElement(CustomerPage, { db, id, now: NOW, onOpenBill: () => undefined, onAdded: () => undefined }))
    expect(el.textContent).not.toContain(PHONE)
    expect(el.textContent).not.toContain('Sampletown')
    expect(el.textContent).toContain(HIDDEN_BY_ADMIN)
    expect([...el.querySelectorAll('a')].some((a) => /Call|WhatsApp/.test(a.textContent ?? ''))).toBe(false)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    setRights(ALL_SEAT_RIGHTS)
    el = await render(createElement(CustomerPage, { db, id, now: NOW, onOpenBill: () => undefined, onAdded: () => undefined }))
    expect(el.textContent).toContain('Sampletown')
    expect([...el.querySelectorAll('a')].some((a) => a.textContent === 'Call')).toBe(true)
  })
})
