// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { App as AppRaw, type AppProps } from '../App'
import type { SaveBillInput } from '../data/billsRepo'
import { getAllRecords, openPhoneDb, STORE_NAMES, type PhoneDb, type StoreName } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { saveBillWithParty } from '../data/partiesRepo'
import { withOutbox } from '../sync/outbox'
import { shareHooks } from '../ui/layouts/guided/guidedShare'
import { stepBack } from '../ui/layouts/guided/guidedStep'
import { isBlankRow } from '../ui/layouts/guided/guidedQuickAdd'
import { listDrafts } from '../data/draftsRepo'

// Phase 193 - Layout B "Guided flow": the screens over the same data. Sandbox (jsdom) only: the real phone look and keyboard are NOT checked.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const App = AppRaw as FC<AppProps>
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')
const LONG = 'Heavy duty galvanised steel water pipe with threaded sockets and long extra description that must never be cut'

const input = (id: string, name: string, rows: SaveBillInput['bill']['rows'], formatId = 'non_gst'): SaveBillInput => ({
  bill: { id, party: { name, phone: '', address: '', transport: '' }, formatId, extraCols: [], paperOverride: null, billDate: '2026-10-21', rows }
})

async function seeded(writer = true): Promise<PhoneDb> {
  const lock = { held: true }
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: lock })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  const opts = { ...withOutbox({ now: NOW }), now: NOW }
  await saveBillWithParty(db, input('b-long', 'Alpha Traders And Sons Private Limited Of The Long Road', [row(LONG, '382', '34')]), opts)
  await saveBillWithParty(db, input('b-two', 'Beta Stores', [row('first item', '2', '50'), row('second item', '3', '10')]), opts)
  await saveBillWithParty(db, input('b-gst', 'Gamma GST Co', [row('gst pipe', '10', '100', { gst: '18' })], 'gst'), opts)
  await saveBillWithParty(db, input('b-st', 'Branch Two', [row('stock pipe', '5 boxes', null)], 'stock_transfer'), opts)
  lock.held = writer
  return db
}
async function dataStores(db: PhoneDb): Promise<string> {
  const out: Record<string, unknown> = {}
  for (const name of STORE_NAMES) if (name !== 'settings') out[name] = await getAllRecords(db, name as StoreName)
  return JSON.stringify(out)
}

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; delete document.documentElement.dataset.layout; shareHooks.make = undefined; shareHooks.env = undefined })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(db: PhoneDb): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(App, { services: { db, now: NOW, engine: null, layout: 'guided' }, backEnv: null })) })
  await settle(120)
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const btn = (h: ParentNode, text: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await settle(20)
}
const area = (h: ParentNode, label: string): HTMLTextAreaElement => h.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!
const inp = (h: ParentNode, label: string): HTMLInputElement => h.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
const shared: string[] = []
const hookShare = (): void => {
  shared.length = 0
  shareHooks.make = async (bill, choice) => { shared.push(`${bill.poNumber}:${choice.style}/${choice.kind}`); return { bytes: new Uint8Array([1]), mime: 'image/png', fileName: 'x.png', pages: 1, paper: 'A5' } }
  shareHooks.env = { nav: { canShare: () => true, share: async () => undefined }, makeFile: (b, n, m) => new File([b as BlobPart], n, { type: m }), download: () => undefined }
}
const newBill = async (h: HTMLElement): Promise<void> => { await click([...h.querySelectorAll<HTMLElement>('.q3x-guided-new')][0]) }
const addLine = async (h: HTMLElement, name: string, qty: string, rate: string): Promise<void> => {
  await typeInto(area(h, 'Item'), name); await typeInto(inp(h, 'Qty'), qty); await typeInto(inp(h, 'Rate'), rate)
  await click(btn(h.querySelector('[aria-label="Quick add"]')!, 'Add'))
}

describe('guided layout', () => {
  it('shell: four tabs (Home, Bills, Customers, More), a huge New bill, today’s bills with a Share button', async () => {
    const db = await seeded()
    const h = await mount(db)
    expect(document.documentElement.dataset.layout).toBe('guided')
    expect([...h.querySelectorAll('.q3x-tidy-tab')].map((b) => b.textContent)).toEqual(['Home', 'Bills', 'Customers', 'More'])
    expect(h.querySelector('.q3x-guided-new')?.textContent).toBe('New bill')
    expect(h.querySelector('.q3-nav')).toBeNull()
    expect(h.textContent).toContain('Alpha Traders And Sons Private Limited Of The Long Road')
    expect(btn(h, 'Continue draft')).toBeUndefined()
    hookShare()
    await click([...h.querySelectorAll<HTMLElement>('.q3x-guided-bill')].find((r) => r.textContent?.includes('Beta Stores'))!.querySelector('.q3x-btn'))
    expect(shared).toHaveLength(1)
    expect(h.textContent).toContain('Shared.')
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-tab')].find((b) => b.textContent === 'More'))
    expect(h.querySelector('h1')?.textContent).toBe('Settings')
  })

  it('three steps, Back steps back first, and at the first step the unsaved guard runs', async () => {
    const h = await mount(await seeded())
    await newBill(h)
    expect(h.querySelector('.q3x-tidy-nav')).toBeNull()
    expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Party')
    await typeInto(area(h, 'Party name'), 'Zeta Traders')
    await click(btn(h, 'Next: items'))
    expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Items')
    await addLine(h, 'brass tap', '4', '25')
    await click(btn(h, 'Review'))
    expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Review')
    await click(btn(h, 'Back')); expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Items')
    await click(btn(h, 'Back')); expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Party')
    expect(h.querySelector('[aria-label="Unsaved bill"]')).toBeNull()
    await click(btn(h, 'Back'))
    const dlg = h.querySelector('[role="dialog"][aria-label="Unsaved bill"]')
    expect(dlg).toBeTruthy()
    await click(btn(dlg!, 'Keep editing'))
    expect(area(h, 'Party name').value).toBe('Zeta Traders')
    expect([stepBack('items', false), stepBack('review', false), stepBack('party', false), stepBack('review', true)]).toEqual(['party', 'items', null, 'leave'])
  })

  it('quick-add adds a row through the editor model, keeps a long name whole, shows the running total, tap edits, remove has Undo', async () => {
    const h = await mount(await seeded())
    await newBill(h)
    await typeInto(area(h, 'Party name'), 'Zeta'); await click(btn(h, 'Next: items'))
    await addLine(h, LONG, '382', '34')
    expect(h.querySelector('.q3x-item-name')?.textContent).toBe(LONG)
    expect(h.querySelector('.q3x-item-detail')?.textContent).toBe('382 x Rs34')
    expect(h.querySelector('footer[aria-label="Running total"]')?.textContent).toContain('12,988.00')
    expect(area(h, 'Item').value).toBe('')
    await addLine(h, 'second', '2', '10')
    expect(h.querySelectorAll('.q3x-tidy-rowbtn')).toHaveLength(2)
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-rowbtn')].find((b) => b.textContent?.includes('second')))
    expect(area(h, 'Item').value).toBe('second')
    await typeInto(inp(h, 'Qty'), '3')
    await click(btn(h, 'Update'))
    expect(h.querySelector('footer[aria-label="Running total"]')?.textContent).toContain('13,018.00')
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-rowbtn')].find((b) => b.textContent?.includes('second')))
    await click(btn(h, 'Remove row'))
    expect(h.querySelectorAll('.q3x-tidy-rowbtn')).toHaveLength(1)
    await click(btn(h.querySelector('.q3x-snack')!, 'Undo'))
    expect(h.querySelectorAll('.q3x-tidy-rowbtn')).toHaveLength(2)
    expect(isBlankRow({ name: ' ', qty: '', rate: '', override: '' })).toBe(true)
  })

  it('name is required: Review with no party name goes back to Party and says so', async () => {
    const h = await mount(await seeded())
    await newBill(h)
    await click(btn(h, 'Next: items'))
    await addLine(h, 'tap', '1', '5')
    await click(btn(h, 'Review'))
    expect(h.querySelector('.q3x-guided-stepname')?.textContent).toBe('Party')
    expect(h.querySelector('[role="alert"]')).toBeTruthy()
  })

  it('Review saves, says "Saved as ...", shares image / PDF through the share code, Done opens the bill view (no second Saved sheet)', async () => {
    const db = await seeded()
    const h = await mount(db)
    await newBill(h)
    await typeInto(area(h, 'Party name'), 'Zeta Traders'); await click(btn(h, 'Next: items'))
    await addLine(h, 'brass tap', '4', '25')
    await click(btn(h, 'Review'))
    expect(h.querySelector('.q3x-totals-grand')?.textContent).toContain('100.00')
    expect(btn(h, 'Share image')).toBeUndefined()
    await click(btn(h, 'Save bill'))
    await settle(200)
    expect(h.textContent).toMatch(/Saved as PH-\d+; pick WhatsApp in the share list\./)
    expect(btn(h, 'Rough')).toBeTruthy(); expect(btn(h, 'Professional')).toBeTruthy()
    hookShare()
    await click(btn(h, 'Share image'))
    await click(btn(h, 'Share PDF'))
    expect(shared.map((s) => s.split(':')[1])).toEqual(['professional/image', 'professional/pdf'])
    await click(btn(h, 'Done'))
    expect(h.querySelector('article')).toBeTruthy()
    expect(h.querySelector('[aria-label="Saved"]')).toBeNull()
    expect(h.querySelector('[aria-label="Unsaved bill"]')).toBeNull()
  })

  it('Create always opens a clean bill; a saved draft is only offered by "Continue draft", which recovers it', async () => {
    const db = await seeded()
    let h = await mount(db)
    await newBill(h)
    await typeInto(area(h, 'Party name'), 'Draft Party')
    await settle(1000)
    expect((await listDrafts(db)).length).toBeGreaterThan(0)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    h = await mount(db)
    expect(btn(h, 'Continue draft')).toBeTruthy()
    await newBill(h)
    expect(area(h, 'Party name').value).toBe('') // A31: clean, the draft is only offered
    expect(h.querySelector('[aria-label="Unsaved bill from last time"]')).toBeTruthy()
  })

  it('Continue draft goes straight into the saved draft', async () => {
    const db = await seeded()
    let h = await mount(db)
    await newBill(h)
    await typeInto(area(h, 'Party name'), 'Draft Party')
    await settle(1000)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    h = await mount(db)
    await click(btn(h, 'Continue draft'))
    await settle(150)
    expect(area(h, 'Party name').value).toBe('Draft Party')
  })

  it('read-only: the status pill shows, nothing is hidden, and layout screens write nothing on their own', async () => {
    const db = await seeded(false)
    const before = await dataStores(db)
    const h = await mount(db)
    expect(h.querySelector('.q3x-readonly-line')?.textContent).toMatch(/Read-only/)
    expect(await dataStores(db)).toBe(before)
  })
})
