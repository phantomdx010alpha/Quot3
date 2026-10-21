// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement, act, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { legacyBill, LEGACY_ITEMS_TOTAL, row } from '../../shared/__fixtures__/bills'
import { createEmptyBill } from '../../shared/billModel'
import { getBillOptions } from '../../shared/calc/billOptions'
import { computeBill } from '../../shared/calc/billTotals'
import { D } from '../../shared/money'
import { resolveFormat } from '../../shared/format/registry'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { getBill, saveBill, type SaveBillInput } from '../data/billsRepo'
import { listPartyRecords } from '../data/partiesRepo'
import { listDrafts, saveDraft } from '../data/draftsRepo'
import { listPending } from '../sync/outbox'
import {
  addAdjustment, addItemRow, applyParty, buildEditorView, checkSave, isDirty, openExistingBill, openNewBill, readNumberText, removeRow,
  setAdjustment, setFormat, setItemField, setPartyField, toSaveInput
} from '../ui/editor/editorModel'
import { App, type AppProps } from '../App'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 21, 12, 0, 0)
const TODAY = '2026-10-21'

async function freshDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  return db
}

const fresh = () => openNewBill({ branchId: 'b1', roundOff: true, today: TODAY, now: NOW.toISOString() })

describe('editor model', () => {
  it('totals equal the shared engine (desktop numbers) on the legacy fixture plus an adjustment', () => {
    const base = createEmptyBill({ branchId: 'b1', formatId: 'non_gst', billDate: TODAY })
    let s = openExistingBill({ ...base, rows: legacyBill() })
    s = setPartyField(s, 'name', 'Legacy Co')
    const a = addAdjustment(s)
    s = setAdjustment(a.state, a.id, { name: 'Discount', amount: '-26' })
    const v = buildEditorView(s)
    const shared = computeBill(resolveFormat('non_gst'), s.bill.rows, getBillOptions(s.bill))
    const grand = shared.display.find((d) => d.kind === 'grandTotal')
    expect(v.grandTotal).toBe(grand?.cells['amount'] || grand?.cells['total'])
    expect(D(shared.itemsTotal).toFixed(2)).toBe(LEGACY_ITEMS_TOTAL)
    expect(D(shared.grandTotal).toFixed(2)).toBe('17200.00')
    expect(v.items).toHaveLength(legacyBill().length)
    expect(v.adjustments).toEqual([{ id: a.id, name: 'Discount', amount: '-26' }])
  })

  it('GST toggle keeps every entered value and goes back unchanged', () => {
    let s = fresh()
    const id = s.bill.rows[0]!.id
    s = setItemField(setItemField(setItemField(s, id, 'name', 'pipe'), id, 'qty', '2'), id, 'rate', '50')
    const before = s.bill.rows
    const g = setFormat(s, 'gst')
    expect(g.bill.formatId).toBe('gst')
    expect(g.bill.rows).toBe(before)
    expect(buildEditorView(g).hasGst).toBe(true)
    const g2 = setItemField(g, id, 'gstRate', '18')
    expect(buildEditorView(g2).items[0]?.amount).toBe('118.00')
    const back = setFormat(g2, 'non_gst')
    expect(back.bill.rows[0]).toMatchObject({ qty: '2', rate: '50', gstRate: '18' })
    expect(buildEditorView(back).hasGst).toBe(false)
    expect(buildEditorView(back).items[0]?.amount).toBe('100.00')
    expect(setFormat(s, 'no-such-format')).toBe(s)
  })

  it('adjustments: negative allowed, in the footer, removable; the last item row is blanked, not removed', () => {
    let s = fresh()
    const id = s.bill.rows[0]!.id
    s = setItemField(setItemField(s, id, 'qty', '1'), id, 'rate', '1000')
    const a = addAdjustment(s)
    s = setAdjustment(a.state, a.id, { name: 'Freight', amount: '50' })
    expect(buildEditorView(s).grandTotal).toBe('1050.00')
    s = setAdjustment(s, a.id, { amount: '-100' })
    expect(buildEditorView(s).grandTotal).toBe('900.00')
    expect(buildEditorView(s).footer.map((f) => f.key)).toEqual(['itemsTotal', 'adjustmentsTotal', 'grandTotal'])
    s = removeRow(s, a.id)
    expect(buildEditorView(s).adjustments).toHaveLength(0)
    s = removeRow(s, id)
    expect(s.bill.rows).toHaveLength(1)
    expect(buildEditorView(s).items[0]).toMatchObject({ name: '', qty: '', rate: '' })
  })

  it('number text: digits and one dot, optional minus only where allowed', () => {
    expect(readNumberText('1,5', false)).toEqual({ text: '1.5', value: '1.5' })
    expect(readNumberText('12.', false)).toEqual({ text: '12.', value: '12' })
    expect(readNumberText('.5', false)).toEqual({ text: '.5', value: '0.5' })
    expect(readNumberText('1.2.3', false).text).toBe('1.23')
    expect(readNumberText('-5', false)).toEqual({ text: '5', value: '5' })
    expect(readNumberText('-5', true)).toEqual({ text: '-5', value: '-5' })
    expect(readNumberText('-', true).value).toBeNull()
    expect(readNumberText('abc', false)).toEqual({ text: '', value: null })
  })

  it('a name edit that changes no text keeps bold / red runs; a changed name keeps the styling of untouched text', () => {
    const r = row('x', '1', '1')
    r.nameRuns = [{ t: 'steel ', b: 1 }, { t: 'pipe', c: 'red', b: 1 }] as never
    const base = createEmptyBill({ branchId: 'b1', billDate: TODAY })
    let s = openExistingBill({ ...base, rows: [r] })
    const same = setItemField(s, r.id, 'name', 'steel pipe')
    expect(same.bill.rows[0]?.nameRuns).toBe(r.nameRuns)
    s = setItemField(s, r.id, 'name', 'steel pipes')
    // Phase 183: untouched text keeps its styling (shared applyTextChange).
    expect(s.bill.rows[0]?.nameRuns.map((x) => x.t).join('')).toBe('steel pipes')
    expect(s.bill.rows[0]?.nameRuns[0]).toMatchObject({ b: 1 })
  })

  it('dirty flag: a new bill is clean, blank padding never makes it dirty, typing does', () => {
    let s = fresh()
    expect(isDirty(s)).toBe(false)
    s = addItemRow(s).state
    expect(isDirty(s)).toBe(false)
    s = setPartyField(s, 'name', 'A')
    expect(isDirty(s)).toBe(true)
    expect(checkSave(s)?.code).toBe('NO_ROWS')
    expect(checkSave(fresh())?.code).toBe('PARTY_NAME_REQUIRED')
  })

  it('picking a customer fills the snapshot; unknown fields ride into the save input', () => {
    const base = createEmptyBill({ branchId: 'b1', billDate: TODAY })
    const withExtras = { ...base, rows: [row('a', '1', '1')], tailRows: [{ extras: { k: { text: 'x' } } }], footerExtras: { grandTotal: { k: { text: 'y' } } } }
    let s = openExistingBill(withExtras)
    s = applyParty(s, { id: 'p1', name: 'Alpha', phone: '9', address: 'Road', transport: 'VRL' })
    expect(s.bill.party).toEqual({ name: 'Alpha', phone: '9', address: 'Road', transport: 'VRL' })
    const input = toSaveInput(s)
    expect(input.bill.tailRows).toEqual(withExtras.tailRows)
    expect(input.bill.footerExtras).toEqual(withExtras.footerExtras)
  })
})

describe('editor screen', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

  const settle = (ms = 120): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  async function mount(db: PhoneDb): Promise<HTMLElement> {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root?.render(createElement(App as FC<AppProps>, { services: { db, now: () => NOW, engine: null }, backEnv: null })) })
    await settle()
    return host
  }
  const click = async (el: Element | null | undefined): Promise<void> => {
    expect(el).toBeTruthy()
    await act(async () => { (el as HTMLElement).click() })
    await settle()
  }
  const btn = (h: HTMLElement, text: string | RegExp): HTMLButtonElement | undefined =>
    [...h.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
  const nav = (h: HTMLElement, label: string): HTMLButtonElement | undefined => [...h.querySelectorAll<HTMLButtonElement>('.q3-nav-item')].find((b) => b.textContent === label)
  const input = (h: HTMLElement, label: string): HTMLInputElement => h.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  const type = async (el: HTMLInputElement, value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const enter = async (el: HTMLElement): Promise<void> => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) }) }
  const openCreate = async (h: HTMLElement): Promise<void> => { await click(nav(h, 'New')) }
  const openFirstRow = async (h: HTMLElement): Promise<void> => { await click(h.querySelector('.q3-erow-line')) }

  it('creates a bill: party, one item, totals strip, Save stores it, creates the customer, queues sync, opens the bill', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await openCreate(h)
    expect(h.querySelector('h1')?.textContent).toBe('New bill')
    await type(input(h, 'Party name'), 'Zeta Traders')
    await openFirstRow(h)
    await type(input(h, 'Item name'), 'steel pipe')
    await type(input(h, 'Qty'), '2')
    await type(input(h, 'Rate'), '50')
    expect(h.querySelector('.q3-grand strong')?.textContent).toBe('100.00')
    expect(h.textContent).toContain('New customer')
    await click(btn(h, 'Save'))
    await settle(200)
    expect(h.querySelector('h1')?.textContent).toBe('Bill')
    const parties = await listPartyRecords(db)
    expect(parties.map((p) => p.name)).toEqual(['Zeta Traders'])
    const pending = await listPending(db)
    expect(pending.some((p) => p.kind === 'bill')).toBe(true)
    expect(pending.some((p) => p.kind === 'party')).toBe(true)
    expect(h.textContent).toContain('steel pipe')
  })

  it('Next / Done moves name -> qty -> rate -> a new row', async () => {
    const h = await mount(await freshDb())
    await openCreate(h)
    await openFirstRow(h)
    const name = input(h, 'Item name')
    name.focus()
    await enter(name)
    expect(document.activeElement).toBe(input(h, 'Qty'))
    await enter(input(h, 'Qty'))
    expect(document.activeElement).toBe(input(h, 'Rate'))
    await enter(input(h, 'Rate'))
    await settle()
    expect(h.querySelectorAll('.q3-erow')).toHaveLength(2)
    expect(document.activeElement).toBe(input(h, 'Item name'))
  })

  it('Save with no party name shows the message and stores nothing', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await openCreate(h)
    await openFirstRow(h)
    await type(input(h, 'Qty'), '1')
    await type(input(h, 'Rate'), '10')
    await click(btn(h, 'Save'))
    expect(h.querySelector('[role="alert"]')?.textContent).toMatch(/name/i)
    expect(h.querySelector('h1')?.textContent).toBe('New bill')
    expect(await listPartyRecords(db)).toHaveLength(0)
  })

  it('GST toggle in the screen shows the GST % box and keeps the typed values', async () => {
    const h = await mount(await freshDb())
    await openCreate(h)
    await openFirstRow(h)
    await type(input(h, 'Qty'), '3')
    await type(input(h, 'Rate'), '10')
    expect(h.querySelector('input[aria-label="GST %"]')).toBeNull()
    await click(btn(h, 'GST'))
    expect(h.querySelector('input[aria-label="GST %"]')).toBeTruthy()
    expect(input(h, 'Qty').value).toBe('3')
    await click(btn(h, 'Non-GST'))
    expect(h.querySelector('input[aria-label="GST %"]')).toBeNull()
    expect(input(h, 'Rate').value).toBe('10')
  })

  it('unsaved-changes guard: leaving asks; Keep editing stays; Discard leaves and drops the draft', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await openCreate(h)
    await type(input(h, 'Party name'), 'Guarded')
    await click(nav(h, 'History'))
    expect(h.querySelector('[role="dialog"]')).toBeTruthy()
    expect(h.querySelector('h1')?.textContent).toBe('New bill')
    await click(btn(h, 'Keep editing'))
    expect(h.querySelector('[role="dialog"]')).toBeNull()
    expect(input(h, 'Party name').value).toBe('Guarded')
    await click(nav(h, 'History'))
    await click(btn(h.querySelector<HTMLElement>('[role="dialog"]')!, 'Discard'))
    expect(h.querySelector('h1')?.textContent).toBe('History')
    expect(await listDrafts(db)).toHaveLength(0)
  })

  it('guard Save path saves a complete bill and then leaves', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await openCreate(h)
    await type(input(h, 'Party name'), 'Saver')
    await openFirstRow(h)
    await type(input(h, 'Qty'), '1')
    await type(input(h, 'Rate'), '10')
    await click(nav(h, 'History'))
    const dialog = h.querySelector<HTMLElement>('[role="dialog"]')!
    await click(btn(dialog, 'Save'))
    await settle(200)
    expect(h.querySelector('[role="dialog"]')).toBeNull()
    expect(h.querySelector('h1')?.textContent).toBe('History')
    expect((await listPartyRecords(db)).map((p) => p.name)).toEqual(['Saver'])
  })

  it('autosaves a draft; Create opens CLEAN even when a draft exists and only offers it; Recover loads it', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await openCreate(h)
    await type(input(h, 'Party name'), 'Draft Co')
    await settle(1000)
    const drafts = await listDrafts(db)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.bill.party.name).toBe('Draft Co')
    // leave without discarding (system kill): a fresh app start
    act(() => root?.unmount()); host?.remove()
    const h2 = await mount(db)
    await openCreate(h2)
    expect(input(h2, 'Party name').value).toBe('')
    expect(h2.textContent).toContain('unsaved bill')
    await click(btn(h2, 'Recover'))
    expect(input(h2, 'Party name').value).toBe('Draft Co')
  })

  it('Create is clean after a stored draft; Discard on the offer removes it', async () => {
    const db = await freshDb()
    const b = createEmptyBill({ branchId: 'branch-phone', billDate: TODAY })
    b.party.name = 'Old draft'
    await saveDraft(db, b)
    const h = await mount(db)
    await openCreate(h)
    expect(input(h, 'Party name').value).toBe('')
    await click(btn(h, 'Discard'))
    expect(await listDrafts(db)).toHaveLength(0)
  })

  it('edits a saved bill from the Dashboard: Edit opens it, a change saves as revision 2, a customer pick fills the party', async () => {
    const db = await freshDb()
    const inp: SaveBillInput = { bill: { id: 'e1', party: { name: 'Alpha Traders', phone: '98450', address: 'Main Road', transport: 'VRL' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: TODAY, rows: [row('steel pipe', '2', '50')] } }
    await saveBill(db, inp)
    const h = await mount(db)
    await click(h.querySelector('.q3-li-btn'))
    expect(h.querySelector('h1')?.textContent).toBe('Bill')
    await click(btn(h, 'Edit'))
    expect(h.querySelector('h1')?.textContent).toBe('New bill')
    expect(input(h, 'Party name').value).toBe('Alpha Traders')
    await openFirstRow(h)
    await type(input(h, 'Qty'), '4')
    expect(h.querySelector('.q3-grand strong')?.textContent).toBe('200.00')
    await click(btn(h, 'Save'))
    await settle(200)
    const saved = await getBill(db, 'e1')
    expect(saved.revision).toBe(2)
    expect(saved.rows[0]?.qty).toBe('4')
    expect(saved.poNumber).toBe('PH-0001')
  })

  it('a stock transfer opens read-only: Edit on PC, no editor', async () => {
    const db = await freshDb()
    const inp: SaveBillInput = { bill: { id: 't1', party: { name: 'Branch X', phone: '', address: '', transport: '' }, formatId: 'stock_transfer', extraCols: [], paperOverride: null, billDate: TODAY, rows: [row('chair', '2', null)] } }
    await saveBill(db, inp)
    const h = await mount(db)
    await click(h.querySelector('.q3-li-btn'))
    expect(h.textContent).toContain('Edit on PC')
    expect(btn(h, 'Edit')?.disabled).toBe(true)
  })
})
