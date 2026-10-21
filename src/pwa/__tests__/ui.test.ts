// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createElement, act, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { activeTab, canGoBack, createRouter, currentRoute, goBack, navigate, navigateTab, TAB_ROUTES } from '../router'
import { installBackGuard, type BackEnv } from '../platform/backButton'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { getSetting } from '../data/settingsRepo'
import { saveBill, type SaveBillInput } from '../data/billsRepo'
import { buildDashboardView, describeSync, localIsoDate } from '../ui/dashboardModel'
import { loadDashboard } from '../ui/loadDashboard'
import type { EngineStatus } from '../sync/engine'
import { App, type AppProps } from '../App'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 9, 21, 12, 0, 0) // local noon, 21 Oct 2026

/** `readOnly` simulates a second tab: the database is prepared while writable, then the lock is lost. */
async function freshDb(readOnly = false): Promise<PhoneDb> {
  const writer = { held: true }
  const db = await openPhoneDb({ factory: new IDBFactory(), writer })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  if (readOnly) writer.held = false
  return db
}

let n = 0
const bill = (name: string, date: string, qty: string, rate: string): SaveBillInput => ({
  bill: { id: `b-${++n}`, party: { name, phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: date, rows: [row('widget', qty, rate)] }
})

async function seed(db: PhoneDb): Promise<void> {
  await saveBill(db, bill('Alpha', '2026-10-21', '1', '10'))
  await saveBill(db, bill('Beta', '2026-10-21', '1', '20'))
  await saveBill(db, bill('Gamma', '2026-10-05', '3', '1000'))
  await saveBill(db, bill('Delta', '2026-09-30', '1', '999')) // last month: not in the month total
}

describe('router: Dashboard is the root', () => {
  it('Back from every tab goes to the Dashboard, and never behind it', () => {
    for (const tab of TAB_ROUTES) {
      const r = navigateTab(createRouter('home'), tab)
      expect(currentRoute(r).name).toBe(tab)
      const back = goBack(r)
      expect(currentRoute(back).name).toBe('home')
      expect(canGoBack(back)).toBe(false)
      expect(goBack(back)).toBe(back)
    }
  })
  it('switching tabs does not pile up a history', () => {
    let r = navigateTab(createRouter('home'), 'history')
    r = navigateTab(r, 'customers')
    r = navigateTab(r, 'settings')
    expect(r.stack.map((x) => x.name)).toEqual(['home', 'settings'])
    expect(navigateTab(r, 'settings')).toBe(r)
    expect(navigateTab(r, 'home').stack).toEqual([{ name: 'home' }])
  })
  it('a pushed page keeps its parent tab lit and Back returns to it', () => {
    const r = navigate(navigateTab(createRouter('home'), 'settings'), 'about')
    expect(activeTab(r)).toBe('settings')
    expect(currentRoute(goBack(r)).name).toBe('settings')
  })
})

describe('system Back guard', () => {
  function fakeEnv() {
    let pop: (() => void) | null = null
    const log: string[] = []
    const env: BackEnv = { pushSentinel: () => log.push('push'), exit: () => log.push('exit'), onPop: (fn) => { pop = fn; return () => { pop = null } } }
    return { env, log, press: () => pop?.() }
  }
  it('steps back when it can, leaves at the root, and a blocked leave keeps the page', () => {
    const f = fakeEnv()
    let canStep = true
    let blocked = false
    installBackGuard(f.env, { handleBack: () => (blocked ? true : canStep ? ((canStep = false), true) : false) })
    expect(f.log).toEqual(['push'])
    f.press() // stepped back: sentinel restored
    expect(f.log).toEqual(['push', 'push'])
    f.press() // at the Dashboard: Back goes through
    expect(f.log).toEqual(['push', 'push', 'exit'])
    blocked = true
    f.press() // unsaved work: stays, sentinel restored
    expect(f.log.slice(-1)).toEqual(['push'])
  })
})

describe('Dashboard model', () => {
  it('sums today and the month from the cached totals (decimal strings) and ignores other months', async () => {
    const db = await freshDb()
    await seed(db)
    const v = await loadDashboard(db, NOW)
    expect(v.today).toEqual({ date: '2026-10-21', count: 2, total: '₹30.00' })
    expect(v.month).toEqual({ month: '2026-10', count: 3, total: '₹3,030.00' })
    expect(v.billCount).toBe(4)
    expect(v.recent.map((r) => r.partyName)).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta'])
    expect(v.recent[0]).toMatchObject({ poNumber: 'PH-0002', total: '₹20.00' })
  })
  it('trashed bills do not count and the list is capped at eight', async () => {
    const db = await freshDb()
    for (let i = 0; i < 10; i++) await saveBill(db, bill(`P${i}`, '2026-10-21', '1', '10'))
    const v = await loadDashboard(db, NOW)
    expect(v.recent).toHaveLength(8)
    expect(v.billCount).toBe(10)
    expect(v.today.total).toBe('₹100.00')
  })
  it('an empty phone reads as zero, with no backup nag', async () => {
    const db = await freshDb()
    const v = await loadDashboard(db, NOW)
    expect(v.today).toMatchObject({ count: 0, total: '₹0.00' })
    expect(v.recent).toEqual([])
    expect(v.backup).toEqual({ text: 'No backup yet', tone: 'ok', note: '' })
  })
  it('asks for a backup when bills exist and none was ever exported, and when the last one is old', async () => {
    const db = await freshDb()
    await seed(db)
    expect((await loadDashboard(db, NOW)).backup).toMatchObject({ tone: 'warn', note: 'Export a backup in Settings.' })
    await setMetaValue(db, 'last_export_at', new Date(2026, 9, 1, 9, 0).toISOString())
    const old = (await loadDashboard(db, NOW)).backup
    expect(old.tone).toBe('warn')
    expect(old.note).toMatch(/20 days ago/)
    await setMetaValue(db, 'last_export_at', new Date(2026, 9, 21, 9, 5).toISOString())
    expect((await loadDashboard(db, NOW)).backup).toEqual({ text: 'Today 09:05', tone: 'ok', note: '' })
  })
  it('localIsoDate uses the local calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('sync line', () => {
  const linked = { org_id: 'o', branch_id: 'b', branch_name: 'Phone' }
  const engine = (over: Partial<EngineStatus> = {}): EngineStatus => ({
    state: 'running',
    push: { consecutiveFailures: 0 }, pull: { consecutiveFailures: 0 },
    doorbell: {}, outbox: { pending: 0, failed: 0 }, aside: { total: 0, bills: 0 }, deferredBills: 0, clockOffsetMs: 0, clockWarning: null,
    ...over
  } as unknown as EngineStatus)
  it('not signed in, linked without engine, synced, waiting, aside, unreachable, read-only', () => {
    expect(describeSync({ org_id: null, branch_id: null, branch_name: null }, null, true)).toMatchObject({ tone: 'off', text: 'Sync not set up' })
    expect(describeSync(linked, null, true)).toMatchObject({ tone: 'off', text: 'Branch Phone' })
    expect(describeSync(linked, engine(), true)).toMatchObject({ tone: 'ok', text: 'Branch Phone · synced', detail: '' })
    expect(describeSync(linked, engine({ outbox: { pending: 2, failed: 1 } }), true).detail).toBe('3 waiting to send')
    expect(describeSync(linked, engine({ aside: { total: 4, bills: 3 } }), true).detail).toBe('Update the app to see 3 bills')
    expect(describeSync(linked, engine({ pull: { consecutiveFailures: 2 } as EngineStatus['pull'] }), true)).toMatchObject({ tone: 'warn', text: 'Branch Phone · sync server unreachable' })
    expect(describeSync(linked, engine(), false).text).toBe('Open in another tab')
  })
})

describe('App (jsdom)', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

  async function mount(db: PhoneDb | null, backEnv: BackEnv | null = null, error?: string): Promise<HTMLElement> {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => { root?.render(createElement(App as FC<AppProps>, { services: { db, now: () => NOW, error, engine: null }, backEnv })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    return host
  }
  const click = async (el: Element | null | undefined): Promise<void> => {
    expect(el).toBeTruthy()
    await act(async () => { (el as HTMLElement).click() })
  }
  const nav = (h: HTMLElement, label: string): HTMLButtonElement | undefined =>
    [...h.querySelectorAll<HTMLButtonElement>('.q3-nav-item')].find((b) => b.textContent === label)
  const title = (h: HTMLElement): string => h.querySelector('h1')?.textContent ?? ''

  it('shows the Dashboard from fixtures with five nav tabs and Home active', async () => {
    const db = await freshDb()
    await seed(db)
    const h = await mount(db)
    expect(h.querySelectorAll('.q3-nav-item')).toHaveLength(5)
    expect(nav(h, 'Home')?.getAttribute('aria-current')).toBe('page')
    expect(h.querySelector('[data-testid="tile-today"]')?.textContent).toContain('₹30.00')
    expect(h.querySelector('[data-testid="tile-month"]')?.textContent).toContain('₹3,030.00')
    expect(h.querySelectorAll('.q3-li')).toHaveLength(4)
    expect(h.querySelector('[data-testid="sync-line"]')?.textContent).toContain('Sync not set up')
    expect(h.querySelector('[data-testid="backup-line"]')?.textContent).toContain('No backup yet')
    expect(h.querySelector('button[aria-label="Back"]')).toBeNull()
  })

  it('every tab is reachable, and the top Back button returns each one to the Dashboard', async () => {
    const h = await mount(await freshDb())
    for (const [label, heading] of [['History', 'History'], ['New', 'New bill'], ['Customers', 'Customers'], ['Settings', 'Settings']] as const) {
      await click(nav(h, label))
      expect(title(h)).toBe(heading)
      expect(nav(h, label)?.getAttribute('aria-current')).toBe('page')
      await click(h.querySelector('button[aria-label="Back"]'))
      expect(title(h)).toBe('Quot3')
      expect(h.querySelector('button[aria-label="Back"]')).toBeNull()
    }
  })

  it('About opens from Settings, keeps Settings lit, and Back goes to Settings then the Dashboard', async () => {
    const h = await mount(await freshDb())
    await click(nav(h, 'Settings'))
    await click([...h.querySelectorAll('button')].find((b) => b.textContent === 'About'))
    expect(title(h)).toBe('About')
    expect(nav(h, 'Settings')?.getAttribute('aria-current')).toBe('page')
    await click(h.querySelector('button[aria-label="Back"]'))
    expect(title(h)).toBe('Settings')
    await click(h.querySelector('button[aria-label="Back"]'))
    expect(title(h)).toBe('Quot3')
  })

  it('the light theme is applied and saved; a read-only tab still switches the look but writes nothing', async () => {
    const db = await freshDb()
    const h = await mount(db)
    await click(nav(h, 'Settings'))
    await click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Light'))
    expect(document.documentElement.dataset.theme).toBe('light')
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(await getSetting(db, 'theme.name')).toBe('light')

    act(() => root?.unmount()); host?.remove()
    const ro = await freshDb(true)
    const h2 = await mount(ro)
    await click(nav(h2, 'Settings'))
    await click([...h2.querySelectorAll('button')].find((b) => b.textContent === 'Navy'))
    expect(document.documentElement.dataset.theme).toBe('navy-ember')
    expect(await getSetting(ro, 'theme.name')).toBe('navy-ember') // default, nothing was written
  })

  it('a read-only tab says so on the Dashboard; a database failure shows its message', async () => {
    const h = await mount(await freshDb(true))
    expect(h.querySelector('[data-testid="sync-line"]')?.textContent).toContain('Open in another tab')
    act(() => root?.unmount()); host?.remove()
    const h2 = await mount(null, null, 'Close the other Quot3 tab or window, then try again.')
    expect(h2.querySelector('[role="alert"]')?.textContent).toContain('Close the other Quot3 tab')
  })

  it('system Back from a tab goes to the Dashboard; from the Dashboard it leaves', async () => {
    let pop: (() => void) | null = null
    const log: string[] = []
    const env: BackEnv = { pushSentinel: () => log.push('push'), exit: () => log.push('exit'), onPop: (fn) => { pop = fn; return () => undefined } }
    const h = await mount(await freshDb(), env)
    await click(nav(h, 'History'))
    await act(async () => { pop?.() })
    expect(title(h)).toBe('Quot3')
    await act(async () => { pop?.() })
    expect(log.at(-1)).toBe('exit')
  })
})
