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
import { tidyTotals } from '../ui/layouts/tidy/tidyTotals'

// Phase 192 - Layout A "Tidy tabs": the screens over the same data. Sandbox (jsdom) only: the real phone look and keyboard are NOT checked.
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
  await act(async () => { root!.render(createElement(App, { services: { db, now: NOW, engine: null, layout: 'tidy' }, backEnv: null })) })
  await settle(120)
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const btn = (h: ParentNode, text: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)
const tab = (h: HTMLElement, label: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('.q3x-tidy-tab')].find((b) => b.textContent === label)
const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await settle(20)
}
const openBill = async (h: HTMLElement, party: string): Promise<void> => {
  await click(tab(h, 'Bills'))
  await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-row')].find((b) => b.textContent?.includes(party)))
}

describe('tidy layout', () => {
  it('draws the tidy shell: five-tab nav with a raised New button, Home tiles and recent bills (long party names in full)', async () => {
    const h = await mount(await seeded())
    expect(document.documentElement.dataset.layout).toBe('tidy')
    expect(h.querySelector('.q3x-tidy-nav')).toBeTruthy()
    expect([...h.querySelectorAll('.q3x-tidy-tab')].map((b) => b.textContent)).toEqual(['Home', 'Bills', 'Customers', 'Settings'])
    expect(h.querySelector('.q3x-tidy-new')?.getAttribute('aria-label')).toBe('New bill')
    expect(h.querySelector('[data-testid="tile-today"]')).toBeTruthy()
    expect(h.querySelector('.q3x-tidy-list')?.textContent).toContain('Alpha Traders And Sons Private Limited Of The Long Road')
    expect(h.querySelector('.q3-nav')).toBeNull() // not the classic nav
  })

  it('Bills lists two-line rows; the bill view shows a long item name in full, with the two-line detail and a totals block', async () => {
    const h = await mount(await seeded())
    await openBill(h, 'Alpha Traders')
    const art = h.querySelector('article')!
    expect(art.querySelector('.q3x-tidy-party')?.textContent).toBe('Alpha Traders And Sons Private Limited Of The Long Road')
    expect(art.querySelector('.q3x-item-name')?.textContent).toBe(LONG)
    expect(art.querySelector('.q3x-item-detail')?.textContent).toBe('382 x Rs34')
    expect(art.querySelector('.q3x-totals-grand')?.textContent).toContain('12,988.00')
    expect(art.textContent).not.toMatch(/rev \d/) // "rev" is in the overflow menu
    await click(btn(h, 'More'))
    expect(h.querySelector('[role="dialog"]')?.textContent).toMatch(/revision 1/i)
  })

  it('a GST bill reads Before GST / GST / Total with "+18% GST" on the line', async () => {
    const h = await mount(await seeded())
    await openBill(h, 'Gamma GST')
    const labels = [...h.querySelectorAll('.q3x-totals dt')].map((d) => d.textContent)
    expect(labels).toEqual(['Before GST', 'GST', 'Total'])
    expect(h.querySelector('.q3x-item-detail')?.textContent).toBe('10 x Rs100 \u00b7 +18% GST')
    expect(tidyTotals({ formatId: 'gst', roundOff: 0, rows: [row('x', '1', '100', { gst: '18' })] }).total).toBe('118.00')
  })

  it('a stock transfer opens read-only with "Edit on PC" (disabled), shows no money totals', async () => {
    const h = await mount(await seeded())
    await openBill(h, 'Branch Two')
    const edit = btn(h, 'Edit on PC') as HTMLButtonElement
    expect(edit).toBeTruthy(); expect(edit.disabled).toBe(true)
    expect(h.querySelector('.q3x-totals')).toBeNull()
    expect(h.querySelector('[role="note"]')?.textContent).toMatch(/Edit on PC/)
  })

  it('read-only: the status pill and the thin line show, nothing is hidden (the pill sheet lists it with Try again)', async () => {
    const h = await mount(await seeded(false))
    expect(h.querySelector('.q3x-readonly-line')?.textContent).toMatch(/Read-only/)
    await click(h.querySelector('.q3x-pill'))
    expect(h.querySelector('[role="dialog"]')?.textContent).toMatch(/Try again/)
    expect(h.querySelector('.q3-banner')).toBeNull()
  })

  it('editor: nav hidden, Back with typed changes asks first (guard), Keep editing stays', async () => {
    const h = await mount(await seeded())
    await click(h.querySelector('.q3x-tidy-new'))
    expect(h.querySelector('.q3x-tidy-nav')).toBeNull()
    expect(btn(h, 'GST')).toBeTruthy(); expect(btn(h, 'Non-GST')).toBeTruthy()
    await typeInto(h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Party name"]')!, 'Zeta')
    await click(btn(h, 'Back'))
    const dlg = h.querySelector('[role="dialog"][aria-label="Unsaved bill"]')
    expect(dlg).toBeTruthy()
    await click(btn(dlg!, 'Keep editing'))
    expect(h.querySelector('[aria-label="Unsaved bill"]')).toBeNull()
    expect(h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Party name"]')!.value).toBe('Zeta')
  })

  it('name is required: Save with no party name stays and says so', async () => {
    const h = await mount(await seeded())
    await click(h.querySelector('.q3x-tidy-new'))
    await click(btn(h.querySelector('footer')!, 'Save'))
    expect(h.querySelector('footer [role="alert"]')).toBeTruthy()
    expect(h.querySelector('textarea[aria-label="Party name"]')).toBeTruthy()
  })

  it('Save goes to the bill view with the Saved sheet; Share is offered; Done closes it', async () => {
    const db = await seeded()
    const h = await mount(db)
    await click(h.querySelector('.q3x-tidy-new'))
    await typeInto(h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Party name"]')!, 'Zeta Traders')
    await click(h.querySelector('.q3x-tidy-rowbtn') ?? btn(h, 'Add item'))
    await typeInto(h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Item name"]')!, 'brass tap')
    await typeInto(h.querySelector<HTMLInputElement>('input[aria-label="Qty"]')!, '4')
    await typeInto(h.querySelector<HTMLInputElement>('input[aria-label="Rate"]')!, '25')
    await click(btn(h.querySelector('footer')!, 'Save'))
    await settle(200)
    const sheet = h.querySelector('[role="dialog"][aria-label="Saved"]')
    expect(sheet).toBeTruthy()
    expect(sheet!.textContent).toMatch(/Zeta Traders is saved/)
    expect(btn(sheet!, 'Share')).toBeTruthy(); expect(btn(sheet!, 'Done')).toBeTruthy()
    expect(h.querySelector('article .q3x-totals-grand')?.textContent).toContain('100.00')
    await click(btn(sheet!, 'Done'))
    expect(h.querySelector('[aria-label="Saved"]')).toBeNull()
    expect(h.querySelector('article')).toBeTruthy()
  })

  it('removing a row offers Undo in a snackbar and Undo brings the same row back', async () => {
    const h = await mount(await seeded())
    await openBill(h, 'Beta Stores')
    await click(btn(h, 'Edit'))
    expect(h.textContent).toContain('second item')
    await click([...h.querySelectorAll<HTMLElement>('.q3x-tidy-rowbtn')].find((b) => b.textContent?.includes('second item')))
    await click(btn(h, 'Remove row'))
    expect(h.textContent).not.toContain('second item')
    expect(h.querySelector('.q3x-snack')?.textContent).toMatch(/Row removed/)
    await click(btn(h.querySelector('.q3x-snack')!, 'Undo'))
    expect(h.textContent).toContain('second item')
    expect(h.querySelector('.q3x-snack')).toBeNull()
  })

  it('a long item name is typed into a box that is not cut (textarea, wraps), and the bill date field is there', async () => {
    const h = await mount(await seeded())
    await openBill(h, 'Alpha Traders')
    await click(btn(h, 'Edit'))
    await click(h.querySelector('.q3x-tidy-rowbtn'))
    const name = h.querySelector<HTMLTextAreaElement>('textarea[aria-label="Item name"]')!
    expect(name.value).toBe(LONG)
    expect(h.querySelector('input[type="date"]')).toBeTruthy()
  })

  it('switching to Classic and back keeps every bill and writes nothing but the setting', async () => {
    const db = await seeded()
    const before = await dataStores(db)
    const h = await mount(db)
    await click(tab(h, 'Settings'))
    await click([...h.querySelectorAll<HTMLElement>('.q3-menu-item')].find((b) => b.querySelector('.q3-menu-label')?.textContent === 'Themes'))
    const chip = (t: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('section[aria-label="Layout"] button')].find((b) => b.textContent === t)
    await click(chip('Classic'))
    expect(document.documentElement.dataset.layout).toBe('classic')
    expect(h.querySelector('.q3-nav')).toBeTruthy()
    await click(chip('Tidy tabs'))
    expect(document.documentElement.dataset.layout).toBe('tidy')
    await click(tab(h, 'Home'))
    expect(h.querySelector('.q3x-tidy-list')?.textContent).toContain('Beta Stores')
    expect(await dataStores(db)).toBe(before)
  })
})

describe('tidy css and sources', () => {
  const dir = resolve(__dirname, '..', 'ui', 'layouts', 'tidy')
  const css = readFileSync(resolve(dir, 'tidy.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!.trim() }))
  it('no ellipsis, no nowrap on names, titles, details or labels; no raw colours', () => {
    expect(rules.length).toBeGreaterThan(20)
    for (const r of rules) expect(r.body, r.selector).not.toMatch(/text-overflow\s*:\s*ellipsis/)
    for (const r of rules.filter((x) => /(title|name|party|sub|text|note|label|row)/.test(x.selector))) expect(r.body, r.selector).not.toMatch(/white-space\s*:\s*nowrap/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })
  it('touch targets use the touch token and the name box grows (wraps)', () => {
    for (const sel of ['.q3x-input', '.q3x-tidy-row', '.q3x-tidy-tab']) expect(rules.find((r) => r.selector === sel)?.body, sel).toMatch(/min-height\s*:\s*var\(--(touch-min|nav-height)\)/)
    expect(rules.find((r) => r.selector === '.q3x-grow')?.body).toMatch(/overflow-wrap\s*:\s*anywhere/)
  })
  it('the editor never imports from main / electron', () => {
    for (const f of ['TidyEditor.tsx', 'TidyBillView.tsx', 'TidyShell.tsx']) expect(readFileSync(resolve(dir, f), 'utf8')).not.toMatch(/from '[^']*(\/main\/|electron|better-sqlite3)/)
  })
})
