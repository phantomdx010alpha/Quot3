// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement, act, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import type { BillRow } from '../../shared/types'
import { navigate, navigateTab, createRouter, currentRoute, goBack, activeTab } from '../router'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { deleteBills, getBill, saveBill, type SaveBillInput } from '../data/billsRepo'
import { listPending } from '../sync/outbox'
import { listSearchCandidates } from '../data/historyRepo'
import { buildHistory, groupByDate, rangeStart } from '../ui/historyModel'
import { buildBillView, phoneEditBlockReason } from '../ui/billViewModel'
import { App, type AppProps } from '../App'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 21, 12, 0, 0)
const TODAY = '2026-10-21'

async function freshDb(readOnly = false): Promise<PhoneDb> {
  const writer = { held: true }
  const db = await openPhoneDb({ factory: new IDBFactory(), writer })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  if (readOnly) writer.held = false
  return db
}

let n = 0
function bill(name: string, date: string, rows: BillRow[], formatId = 'non_gst', extra: Partial<SaveBillInput['bill']> = {}): SaveBillInput {
  return { bill: { id: `b-${++n}`, party: { name, phone: '98450', address: 'Main Road', transport: 'VRL' }, formatId, extraCols: [], paperOverride: null, billDate: date, rows, ...extra } }
}

async function seed(db: PhoneDb): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  const add = async (key: string, inp: SaveBillInput): Promise<void> => { ids[key] = (await saveBill(db, inp)).id }
  await add('alpha', bill('Alpha Traders', TODAY, [row('steel pipe', '2', '50')]))
  await add('beta', bill('Beta Stores', TODAY, [row('copper wire', '1', '1250')]))
  await add('gamma', bill('Gamma Works', '2026-10-20', [row('brass tap', '3', '100')]))
  await add('old', bill('Old Customer', '2026-08-01', [row('cement bag', '10', '400')]))
  return ids
}

describe('History model', () => {
  it('groups by date with Today / Yesterday labels and exact day totals', async () => {
    const db = await freshDb()
    await seed(db)
    const c = await listSearchCandidates(db)
    const r = buildHistory(c, { query: '', range: 'all', today: TODAY })
    expect(r.groups.map((g) => [g.label, g.count, g.total])).toEqual([
      ['Today', 2, '₹1,350.00'], ['Yesterday', 1, '₹300.00'], ['01-08-26', 1, '₹4,000.00']
    ])
  })
  it('range chips cut by bill date; All shows everything', async () => {
    const c = await listSearchCandidates(await (async () => { const d = await freshDb(); await seed(d); return d })())
    expect(buildHistory(c, { query: '', range: 'today', today: TODAY }).items).toHaveLength(2)
    expect(buildHistory(c, { query: '', range: '7d', today: TODAY }).items).toHaveLength(3)
    expect(buildHistory(c, { query: '', range: '30d', today: TODAY }).items).toHaveLength(3)
    expect(buildHistory(c, { query: '', range: 'all', today: TODAY }).items).toHaveLength(4)
    expect(rangeStart('7d', TODAY)).toBe('2026-10-15')
    expect(rangeStart('all', TODAY)).toBeNull()
  })
  it('searches party, PO number, item text and amount, across all dates', async () => {
    const db = await freshDb()
    await seed(db)
    const c = await listSearchCandidates(db)
    const find = (q: string): string[] => buildHistory(c, { query: q, range: 'today', today: TODAY }).items.map((i) => i.partyName)
    expect(find('gamma')).toEqual(['Gamma Works']) // outside the "today" range, still found
    expect(find('copper')).toEqual(['Beta Stores'])
    expect(find('PH-0004')).toEqual(['Old Customer'])
    expect(find('1250')).toContain('Beta Stores')
    expect(find('zzzz')).toEqual([])
    expect(find('alpha steel')).toEqual(['Alpha Traders'])
  })
  it('caps the list and reports how many are hidden', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, poNumber: `P${i}`, poSeq: i, billDate: TODAY, partyName: 'X', grandTotal: '10', branchId: 'b', revision: 1, itemText: '' }))
    const r = buildHistory(items, { query: '', range: 'all', today: TODAY, limit: 3 })
    expect(r.items).toHaveLength(3)
    expect(r.hiddenCount).toBe(2)
    expect(groupByDate(r.items, TODAY)[0]!.total).toBe('₹30.00')
  })
})

describe('Bill view model', () => {
  it('shows items and footer from the shared totals and keeps the name runs', async () => {
    const db = await freshDb()
    const r = { ...row('x', '2', '50'), nameRuns: [{ t: 'Red ', b: 1 as const, r: 1 as const }, { t: 'pipe' }] }
    const adj: BillRow = { ...row('Discount', null as unknown as string, null as unknown as string), totalOverride: '-10' }
    const res = await saveBill(db, bill('Alpha', TODAY, [r, adj]))
    const v = buildBillView(await getBill(db, res.id))
    expect(v.items[0]!.runs).toEqual([{ t: 'Red ', b: 1, r: 1 }, { t: 'pipe' }])
    expect(v.items[0]!.fields.find((f) => f.key === 'total')?.value).toBe('100.00')
    expect(v.footer.at(-1)).toMatchObject({ label: 'Final total', strong: true })
    expect(v.poNumber).toBe('PH-0001')
    expect(v.party.map((f) => f.key)).toEqual(['name', 'phone', 'transport', 'address'])
    expect(v.readOnlyReason).toBeNull()
  })
  it('stock transfers, hybrid bills and unknown layouts are read-only with "Edit on PC"', () => {
    expect(phoneEditBlockReason({ formatId: 'stock_transfer' })).toMatch(/^Edit on PC/)
    expect(phoneEditBlockReason({ formatId: 'non_gst', hybrid: { active: true } as never })).toMatch(/hybrid/)
    expect(phoneEditBlockReason({ formatId: 'made_up_format' })).toMatch(/^Edit on PC/)
    expect(phoneEditBlockReason({ formatId: 'gst' })).toBeNull()
    expect(phoneEditBlockReason({ formatId: 'non_gst' })).toBeNull()
  })
})

describe('router params', () => {
  it('billview carries the id; Back goes to the page it came from; the History tab stays lit', () => {
    const r = navigate(navigateTab(createRouter('home'), 'history'), 'billview', 'abc')
    expect(currentRoute(r)).toEqual({ name: 'billview', param: 'abc' })
    expect(activeTab(r)).toBe('history')
    expect(currentRoute(goBack(r)).name).toBe('history')
    expect(navigate(r, 'billview', 'abc')).toBe(r)
    expect(navigate(r, 'billview', 'other')).not.toBe(r)
  })
})

describe('History screens (jsdom)', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

  async function mount(db: PhoneDb): Promise<HTMLElement> {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root?.render(createElement(App as FC<AppProps>, { services: { db, now: () => NOW, engine: null }, backEnv: null })) })
    await settle()
    return host
  }
  const settle = (): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, 120)) })
  const until = async (ok: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !ok(); i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  }
  const click = async (el: Element | null | undefined): Promise<void> => {
    expect(el).toBeTruthy()
    await act(async () => { (el as HTMLElement).click() })
    await settle()
  }
  const btn = (h: HTMLElement, text: string | RegExp): HTMLButtonElement | undefined =>
    [...h.querySelectorAll<HTMLButtonElement>('button')].find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')))
  const nav = (h: HTMLElement, label: string): HTMLButtonElement | undefined => [...h.querySelectorAll<HTMLButtonElement>('.q3-nav-item')].find((b) => b.textContent === label)
  const type = async (input: HTMLInputElement, value: string): Promise<void> => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const title = (h: HTMLElement): string => h.querySelector('h1')?.textContent ?? ''

  it('lists date groups, searches, opens a bill and Back returns to History', async () => {
    const db = await freshDb()
    await seed(db)
    const h = await mount(db)
    await click(nav(h, 'History'))
    expect([...h.querySelectorAll('.q3-day')].map((e) => e.textContent)).toEqual(['Today2 · ₹1,350.00', 'Yesterday1 · ₹300.00'])
    await type(h.querySelector('input[type="search"]')!, 'copper')
    expect(h.querySelectorAll('.q3-li')).toHaveLength(1)
    await click(h.querySelector('.q3-li-btn'))
    expect(title(h)).toBe('Bill')
    expect(h.textContent).toContain('Beta Stores')
    expect(h.textContent).toContain('copper wire')
    expect(h.textContent).toContain('Total')
    expect(h.textContent).toContain('1250.00')
    await click(h.querySelector('button[aria-label="Back"]'))
    expect(title(h)).toBe('History')
  })

  it('delete asks first, moves the bill to Recently deleted, queues the sync change, and Restore brings it back', async () => {
    const db = await freshDb()
    const ids = await seed(db)
    const h = await mount(db)
    await click(nav(h, 'History'))
    await click([...h.querySelectorAll('.q3-li-btn')].find((b) => b.textContent?.includes('Alpha Traders')))
    await click(btn(h, 'Delete'))
    expect(h.querySelector('[role="alertdialog"]')).toBeTruthy()
    await click(btn(h, 'Cancel'))
    expect(h.querySelector('[role="alertdialog"]')).toBeNull()
    await click(btn(h, 'Delete'))
    await click(btn(h, 'Delete')) // confirm
    await until(() => !h.textContent!.includes('Loading') && title(h) === 'History')
    expect(title(h)).toBe('History')
    expect(h.textContent).not.toContain('Alpha Traders')
    expect(btn(h, /Recently deleted \(1\)/)).toBeTruthy()
    expect((await listPending(db)).some((o) => o.recId === ids.alpha && o.op === 'delete')).toBe(true)

    await click(btn(h, /Recently deleted/))
    await until(() => !h.textContent!.includes('Loading'))
    expect(title(h)).toBe('Recently deleted')
    expect(h.textContent).toContain('Alpha Traders')
    await click(btn(h, 'Restore'))
    expect(h.textContent).toContain('PH-0001 restored.')
    expect(h.textContent).toContain('Nothing deleted.')
    await click(h.querySelector('button[aria-label="Back"]'))
    await until(() => !h.textContent!.includes('Loading'))
    expect(h.textContent).toContain('Alpha Traders')
    expect((await getBill(db, ids.alpha!)).revision).toBe(3) // save, delete, restore
  })

  it('a stock transfer opens read-only with "Edit on PC" and no Edit', async () => {
    const db = await freshDb()
    const res = await saveBill(db, bill('Godown 2', TODAY, [{ ...row('shirts', '1', ''), qty: 'two dozen', rate: null }], 'stock_transfer'))
    const h = await mount(db)
    await click(nav(h, 'History'))
    await click(h.querySelector('.q3-li-btn'))
    expect(h.textContent).toContain('Edit on PC: this is a stock transfer.')
    expect(btn(h, 'Edit')!.disabled).toBe(true)
    expect(res.poNumber).toBe('PH-0001')
  })

  it('Edit opens the editor entry point with the bill id', async () => {
    const db = await freshDb()
    await seed(db)
    const h = await mount(db)
    await click(nav(h, 'History'))
    await click(h.querySelector('.q3-li-btn'))
    await click(btn(h, 'Edit'))
    expect(title(h)).toBe('New bill')
    // Phase 182: Edit now opens the real editor on the stored bill.
    expect(h.querySelector<HTMLInputElement>('input[aria-label="Party name"]')?.value).toBe('Beta Stores')
  })

  it('a read-only tab can read but not delete or restore', async () => {
    const db = await freshDb()
    const ids = await seed(db)
    await deleteBills(db, [ids.gamma!])
    ;(db as unknown as { canWrite: () => boolean }).canWrite = () => false
    const h = await mount(db)
    await click(nav(h, 'History'))
    await click(h.querySelector('.q3-li-btn'))
    expect(btn(h, 'Delete')!.disabled).toBe(true)
    expect(btn(h, 'Edit')!.disabled).toBe(true)
    await click(h.querySelector('button[aria-label="Back"]'))
    await click(btn(h, /Recently deleted/))
    expect(btn(h, 'Restore')!.disabled).toBe(true)
  })

  it('Dashboard recent bills open the bill, and Back returns to the Dashboard', async () => {
    const db = await freshDb()
    await seed(db)
    const h = await mount(db)
    await click(h.querySelector('.q3-li-btn'))
    expect(title(h)).toBe('Bill')
    await click(h.querySelector('button[aria-label="Back"]'))
    expect(title(h)).toBe('Quot3')
  })
})
