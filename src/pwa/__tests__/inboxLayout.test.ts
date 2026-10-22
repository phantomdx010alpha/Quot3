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
import { cellOrder, nextCell, prevCell } from '../ui/layouts/inbox/inboxToolbar'

// Phase 194 - Layout C "Bills inbox": the screens over the same data. Sandbox (jsdom) only: the real phone look and keyboard are NOT checked.
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
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; delete document.documentElement.dataset.layout })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(db: PhoneDb): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(App, { services: { db, now: NOW, engine: null, layout: 'inbox' }, backEnv: null })) })
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
const fab = (h: HTMLElement): HTMLElement => h.querySelector<HTMLElement>('.q3x-inbox-fab')!
const bar = (h: HTMLElement): HTMLElement => h.querySelector<HTMLElement>('[role="toolbar"]')!

describe('inbox layout', () => {
  it('shell: no bottom nav, a gear and Customers in the top bar, a floating New bill, search always on, bills grouped by day, one-line strip', async () => {
    const h = await mount(await seeded())
    expect(document.documentElement.dataset.layout).toBe('inbox')
    expect(h.querySelector('nav')).toBeNull()
    expect(btn(h, 'Settings')).toBeTruthy(); expect(btn(h, 'Customers')).toBeTruthy()
    expect(fab(h).getAttribute('aria-label')).toBe('New bill')
    expect(h.querySelector('input[type="search"]')).toBeTruthy()
    expect(h.querySelector('[data-testid="strip"]')?.textContent).toMatch(/Today 4 bills/)
    expect(h.querySelectorAll('section[aria-label] h2').length).toBeGreaterThan(0)
    expect(h.textContent).toContain('Alpha Traders And Sons Private Limited Of The Long Road')
    await click(btn(h, 'Settings'))
    expect(h.querySelector('h1')?.textContent).toBe('Settings')
    expect(h.querySelector(".q3x-inbox-fab")).toBeNull()
  })

  it('search uses the shared ranking and long names stay whole; no match says so', async () => {
    const h = await mount(await seeded())
    await typeInto(h.querySelector<HTMLInputElement>('input[type="search"]')!, 'Gamma')
    expect(h.querySelector('[aria-label="Search results"]')?.textContent).toContain('Gamma GST Co')
    expect(h.querySelector('[aria-label="Search results"]')?.textContent).not.toContain('Beta')
    await typeInto(h.querySelector<HTMLInputElement>('input[type="search"]')!, 'zzzzqq')
    expect(h.textContent).toContain('No bills match.')
  })

  it('paper bill view: # / Item / Qty / Rate / Amount, a long name in full, GST bill ends Before GST / GST / Total, floating Share and Edit', async () => {
    const h = await mount(await seeded())
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-row')].find((b) => b.textContent?.includes('Alpha Traders')))
    const art = h.querySelector('article')!
    expect([...art.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['#', 'Item', 'Qty', 'Rate', 'Amount'])
    expect(art.querySelector('.q3x-paper-name')?.textContent).toBe(LONG)
    expect(art.querySelector('.q3x-totals-grand')?.textContent).toContain('12,988.00')
    expect(art.querySelector('.q3x-inbox-float')).toBeTruthy()
    expect(btn(art, 'Share')).toBeTruthy(); expect(btn(art, 'Edit')).toBeTruthy()
    await click(btn(h, 'Back'))
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-row')].find((b) => b.textContent?.includes('Gamma GST')))
    expect([...h.querySelectorAll('.q3x-totals dt')].map((d) => d.textContent)).toEqual(['Before GST', 'GST', 'Total'])
    expect(h.querySelector('.q3x-paper-extra')?.textContent).toBe('+18% GST')
  })

  it('a stock transfer shows "Edit on PC" (disabled) and no totals', async () => {
    const h = await mount(await seeded())
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-row')].find((b) => b.textContent?.includes('Branch Two')))
    expect((btn(h, 'Edit on PC') as HTMLButtonElement).disabled).toBe(true)
    expect(h.querySelector('.q3x-totals')).toBeNull()
  })

  it('cell order and toolbar helpers: name, qty, rate (then GST %), next row; Next at the end asks for a new row', () => {
    const o = cellOrder(['a', 'b'], false)
    expect(o).toEqual(['a:name', 'a:qty', 'a:rate', 'b:name', 'b:qty', 'b:rate'])
    expect(cellOrder(['a'], true)).toEqual(['a:name', 'a:qty', 'a:rate', 'a:gstRate'])
    expect(nextCell(o, 'a:rate')).toBe('b:name'); expect(nextCell(o, 'b:rate')).toBeNull(); expect(prevCell(o, 'b:name')).toBe('a:rate'); expect(prevCell(o, 'a:name')).toBeNull()
  })

  it('paper editor: tap a cell, toolbar appears (previous / next / B / R+B / done), Next follows the order and adds a row, B styles the name', async () => {
    const h = await mount(await seeded())
    await click(fab(h))
    expect(h.querySelector('[role="toolbar"]')).toBeNull()
    await typeInto(area(h, 'Party name'), 'Zeta Traders')
    await click(btn(h, 'Edit item name of row 1'))
    expect(bar(h)).toBeTruthy()
    expect([...bar(h).querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Previous cell', 'Next cell', 'BBold', 'R+BRed and bold', 'Done'])
    await typeInto(area(h, 'Item name'), LONG)
    await click(btn(bar(h), 'Next cell'))
    expect(document.activeElement).toBe(inp(h, 'Qty'))
    await typeInto(inp(h, 'Qty'), '4')
    await click(btn(bar(h), 'Next cell'))
    await typeInto(inp(h, 'Rate'), '25')
    await click(btn(bar(h), 'Previous cell'))
    expect(document.activeElement).toBe(inp(h, 'Qty'))
    await click(btn(bar(h), 'Next cell')); await click(btn(bar(h), 'Next cell'))
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2) // Next on the last cell added a row
    expect(document.activeElement).toBe(area(h, 'Item name'))
    await click(btn(h, 'Edit item name of row 1'))
    expect(area(h, 'Item name').value).toBe(LONG)
    await click(btn(bar(h), 'BBold'))
    await click(btn(bar(h), 'Done'))
    expect(h.querySelector('[role="toolbar"]')).toBeNull()
    expect(h.querySelector('tbody tr .q3x-paper-name strong, tbody tr .q3x-paper-name b, tbody tr .q3x-paper-name span')).toBeTruthy()
    expect(h.querySelector('footer[aria-label="Save"]')?.textContent).toContain('100.00')
  })

  it('Save goes to the bill view with the Saved sheet; Create is clean; Back with typed changes asks first; name required', async () => {
    const db = await seeded()
    const h = await mount(db)
    await click(fab(h))
    await click(btn(h.querySelector('footer')!, 'Save'))
    expect(h.querySelector('footer [role="alert"]')).toBeTruthy()
    await typeInto(area(h, 'Party name'), 'Zeta Traders')
    await click(btn(h, 'Edit item name of row 1'))
    await typeInto(area(h, 'Item name'), 'brass tap')
    await click(btn(bar(h), 'Next cell')); await typeInto(inp(h, 'Qty'), '4')
    await click(btn(bar(h), 'Next cell')); await typeInto(inp(h, 'Rate'), '25')
    await click(btn(h, 'Back'))
    const dlg = h.querySelector('[role="dialog"][aria-label="Unsaved bill"]')
    expect(dlg).toBeTruthy()
    await click(btn(dlg!, 'Keep editing'))
    await click(btn(h.querySelector('footer')!, 'Save'))
    await settle(200)
    const sheet = h.querySelector('[role="dialog"][aria-label="Saved"]')
    expect(sheet?.textContent).toMatch(/Zeta Traders is saved/)
    expect(btn(sheet!, 'Share')).toBeTruthy()
    await click(btn(sheet!, 'Done'))
    expect(h.querySelector('article .q3x-totals-grand')?.textContent).toContain('100.00')
  })

  it('removing a row offers Undo', async () => {
    const h = await mount(await seeded())
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-row')].find((b) => b.textContent?.includes('Beta Stores')))
    await click(btn(h, 'Edit'))
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2)
    await click(btn(h, 'Remove row 2'))
    expect(h.querySelectorAll('tbody tr')).toHaveLength(1)
    await click(btn(h.querySelector('.q3x-snack')!, 'Undo'))
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('read-only: the status pill shows and nothing is written', async () => {
    const db = await seeded(false)
    const before = await dataStores(db)
    const h = await mount(db)
    expect(h.querySelector('.q3x-readonly-line')?.textContent).toMatch(/Read-only/)
    expect(await dataStores(db)).toBe(before)
  })
})
