// @vitest-environment jsdom
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
import { getSetting } from '../data/settingsRepo'
import { withOutbox } from '../sync/outbox'
import { planLayoutChange } from '../ui/layouts/layoutRegistry'

// Phase 189 - switching layouts changes the setting and NOTHING else. Since Phase 192 the real `tidy` layout is registered and used here.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const App = AppRaw as FC<AppProps>
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')

async function seeded(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  const input: SaveBillInput = { bill: { id: 'b1', party: { name: 'Alpha Traders', phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-21', rows: [row('steel pipe', '2', '50')] } }
  await saveBillWithParty(db, input, { ...withOutbox({ now: NOW }), now: NOW })
  return db
}
/** Every store except `settings`, as JSON: bills, parties, drafts, outbox, meta and the rest. */
async function dataStores(db: PhoneDb): Promise<string> {
  const out: Record<string, unknown> = {}
  for (const name of STORE_NAMES) if (name !== 'settings') out[name] = await getAllRecords(db, name as StoreName)
  return JSON.stringify(out)
}

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; delete document.documentElement.dataset.layout })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(db: PhoneDb, layout?: AppProps['services'] extends infer S ? (S extends { layout?: infer L } ? L : never) : never): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(App, { services: { db, now: NOW, engine: null, layout }, backEnv: null })) })
  await settle(120)
  return host
}
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const nav = (h: HTMLElement, label: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('.q3-nav-item')].find((b) => b.textContent === label)
const themesPage = async (h: HTMLElement): Promise<void> => {
  await click(nav(h, 'Settings'))
  await click([...h.querySelectorAll<HTMLElement>('.q3-menu-item')].find((b) => b.querySelector('.q3-menu-label')?.textContent === 'Themes'))
}
const chip = (h: HTMLElement, label: string): HTMLButtonElement | undefined => [...h.querySelectorAll<HTMLButtonElement>('section[aria-label="Layout"] button')].find((b) => b.textContent === label)

describe('layout switch', () => {
  it('Settings > Themes lists the built layouts (Classic, Tidy tabs, Guided flow, Bills inbox) with the plain sentence', async () => {
    const h = await mount(await seeded()); await themesPage(h)
    const section = h.querySelector('section[aria-label="Layout"]')!
    expect(section).toBeTruthy()
    expect([...section.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Classic', 'Tidy tabs', 'Guided flow', 'Bills inbox'])
    expect(section.textContent).toMatch(/Classic is today/)
    expect(chip(h, 'Classic')!.getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.layout).toBe('classic')
  })

  it('a change applies at once and is remembered, and writes nothing but the setting', async () => {
    const db = await seeded()
    const before = await dataStores(db)
    const h = await mount(db); await themesPage(h)
    expect([...h.querySelectorAll('section[aria-label="Layout"] button')].map((b) => b.textContent)).toEqual(['Classic', 'Tidy tabs', 'Guided flow', 'Bills inbox'])
    await click(chip(h, 'Tidy tabs'))
    expect(chip(h, 'Tidy tabs')!.getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.dataset.layout).toBe('tidy')
    expect(await getSetting(db, 'ui.layout')).toBe('tidy')
    expect(await dataStores(db)).toBe(before) // bills, parties, drafts, outbox, meta: identical
    expect(h.querySelector('h1')?.textContent).toBe('Themes') // the page is kept (the classic Settings page is drawn inside the tidy shell)
    await click(chip(h, 'Classic'))
    expect(await getSetting(db, 'ui.layout')).toBe('classic')
    expect(await dataStores(db)).toBe(before)
  })

  it('a saved layout that is not built (or unknown) starts as classic', async () => {
    const db = await seeded()
    const h = await mount(db, 'wide' as never); await themesPage(h)
    expect(document.documentElement.dataset.layout).toBe('classic')
    expect(chip(h, 'Classic')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('with an unsaved bill the change is held until the guard is answered', () => {
    const plan = planLayoutChange({ current: 'classic', next: 'tidy', hasUnsaved: true, route: 'settings' })
    expect(plan.action).toBe('hold')
    expect(planLayoutChange({ current: 'classic', next: 'tidy', hasUnsaved: false, route: 'settings' }).action).toBe('apply')
  })

  it('the page is kept when the new layout has it, otherwise Home', () => {
    expect(planLayoutChange({ current: 'classic', next: 'tidy', hasUnsaved: false, route: 'billview' }).keepRoute).toBe(true)
    expect(planLayoutChange({ current: 'classic', next: 'tidy', hasUnsaved: false, route: 'create' }).keepRoute).toBe(true)
    expect(planLayoutChange({ current: 'classic', next: 'tidy', hasUnsaved: false, route: 'home' }).keepRoute).toBe(true)
  })
})
