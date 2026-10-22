// @vitest-environment jsdom
import { createHash } from 'node:crypto'
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
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { saveBillWithParty } from '../data/partiesRepo'
import { withOutbox } from '../sync/outbox'

// Phase 189 - the classic lock. Milestone 18 adds new phone layouts; the CLASSIC UI must not change. Two locks:
//  1. SHA-256 pins of the four classic CSS files (a phase that must change one stops and asks the owner);
//  2. DOM snapshots of every classic screen and banner state on a fixed fake-IndexedDB fixture.
// NEVER edit the pins or the snapshot file without the owner's approval. The one approved snapshot change is the new
// "Layout" section on Settings > Themes (Phase 189).

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const App = AppRaw as FC<AppProps>
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')
const pwa = (...p: string[]): string => resolve(__dirname, '..', ...p)

const CSS_PINS: Record<string, string> = {
  'ui/ui.css': 'fcfe527043c9425d93614fc7bae0c1db00c25338d0b4b6e360d7f70e5e5a01cb',
  'ui/tokens.css': '00dd882522912cd661a5e7fe9d3c95db1c084078cfd19ac433d69cc40c887adc',
  'ui/themes.css': '7ea399276026c80a4610a7d98882acf737c6b06a151c317a94f4c1f3f5d00020',
  'styles/pwa.css': '2472a97818113eda078f914a2296ab0b5b1365462592842373b64a343113a948'
}

describe('classic CSS lock', () => {
  it.each(Object.entries(CSS_PINS))('%s is byte-for-byte unchanged', (file, hash) => {
    expect(createHash('sha256').update(readFileSync(pwa(...file.split('/')))).digest('hex')).toBe(hash)
  })
})

const bill = (id: string, name: string, phone: string): SaveBillInput => ({
  bill: { id, party: { name, phone, address: 'Main road', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-21', rows: [row('steel pipe', '2', '50')] }
})

async function fixtureDb(writer = true): Promise<PhoneDb> {
  const lock = { held: true }
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: lock })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  const opts = { ...withOutbox({ now: NOW }), now: NOW }
  await saveBillWithParty(db, bill('b-alpha', 'Alpha Traders', '9800000001'), opts)
  await saveBillWithParty(db, bill('b-beta', 'Beta Stores', '9800000002'), opts)
  lock.held = writer // read-only variant: seeded first, then another tab "takes" the lock
  return db
}

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(db: PhoneDb): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(App, { services: { db, now: NOW, engine: null }, backEnv: null })) })
  await settle(120)
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const nav = (h: HTMLElement, label: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('.q3-nav-item')].find((b) => b.textContent === label)
const menu = (h: HTMLElement, label: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('.q3-menu-item')].find((b) => b.querySelector('.q3-menu-label')?.textContent === label)
const withText = (h: HTMLElement, text: string): HTMLElement | null => {
  const hit = [...h.querySelectorAll<HTMLElement>('button, a, li, div')].find((e) => e.textContent?.includes(text) && e.closest('button'))
  return hit?.closest('button') ?? null
}
/** The page markup: classic only, so the snapshot is exactly what the phone draws today. */
const html = (h: HTMLElement): string => h.innerHTML

describe('classic DOM parity (layout = classic, the only layout)', () => {
  it('Home', async () => { expect(html(await mount(await fixtureDb()))).toMatchSnapshot() })
  it('History', async () => { const h = await mount(await fixtureDb()); await click(nav(h, 'History')); expect(html(h)).toMatchSnapshot() })
  it('Bill view', async () => {
    const h = await mount(await fixtureDb()); await click(nav(h, 'History')); await click(withText(h, 'Alpha Traders'))
    expect(html(h)).toMatchSnapshot()
  })
  it('Editor, new bill', async () => { const h = await mount(await fixtureDb()); await click(nav(h, 'New')); expect(html(h)).toMatchSnapshot() })
  it('Editor, edit bill', async () => {
    const h = await mount(await fixtureDb()); await click(nav(h, 'History')); await click(withText(h, 'Alpha Traders'))
    await click([...h.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Edit'))
    expect(html(h)).toMatchSnapshot()
  })
  it('Customers', async () => { const h = await mount(await fixtureDb()); await click(nav(h, 'Customers')); expect(html(h)).toMatchSnapshot() })
  it('Settings list', async () => { const h = await mount(await fixtureDb()); await click(nav(h, 'Settings')); expect(html(h)).toMatchSnapshot() })
  it.each(['Themes', 'Company', 'Branch and sync', 'Share defaults', 'Storage and backup', 'App lock', 'About Quot3'])('Settings page: %s', async (label) => {
    const h = await mount(await fixtureDb()); await click(nav(h, 'Settings')); await click(menu(h, label))
    expect(html(h)).toMatchSnapshot()
  })
  it('Unsaved bill prompt', async () => {
    const h = await mount(await fixtureDb()); await click(nav(h, 'New'))
    const input = h.querySelector<HTMLInputElement>('input[aria-label="Party name"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Zeta'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(nav(h, 'Home'))
    expect(h.querySelector('[role="dialog"]')).toBeTruthy()
    expect(html(h)).toMatchSnapshot()
  })
  it('Banner: read-only (another tab holds the lock)', async () => { expect(html(await mount(await fixtureDb(false)))).toMatchSnapshot() })
})
