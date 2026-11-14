// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { PRICELIST_DEFAULTS, PRICELIST_KEYS } from '../../shared/pricelist/settings'
import { getAllRecords, openPhoneDb, STORE_NAMES, type PhoneDb, type StoreName } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { savePriceRecord, type PriceStamp } from '../data/priceListRepo'
import { SETTING_DEFAULTS, setSetting } from '../data/settingsRepo'
import { GuidedPriceList } from '../ui/layouts/guided/GuidedPriceList'
import { InboxPriceList } from '../ui/layouts/inbox/InboxPriceList'
import { TidyPriceList } from '../ui/layouts/tidy/TidyPriceList'
import { layoutHasRoute, planLayoutChange } from '../ui/layouts/layoutRegistry'
import type { ScreenProps } from '../ui/layouts/types'
import { PriceListEntry } from '../ui/kit/PriceListParts'
import { loadPriceList } from '../ui/kit/priceListLoad'
import {
  EMPTY_CELL, EMPTY_TITLE, PHONE_EDIT_LATER, buildPriceData, coerceRuns, emptyState, phoneRights, priceNotices, resolveHits, searchAll, tabView, tabsOf
} from '../ui/kit/priceListModel'
import type { PriceCategoryRec, PriceRowRec, PriceTabRec, PriceTierRec } from '../../shared/sync/priceListRecords'

// Phase 245 (M23): the phone Price List, browse + search, read only. Invented names only. jsdom only: the real phone look, touch and sync are NOT checked.
;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AT = '2026-11-13T10:00:00.000Z'
const STAMP: PriceStamp = { at: AT, branchId: 'branch-pc', seatNo: 1 }
const LONG = 'Heavy duty galvanised steel water pipe with threaded sockets and a very long extra description that must never be cut short'

const col = (key: string, label: string, role: string, tier?: string) => ({ key, label, type: role === 'price' ? 'number' : 'text', role, ...(tier ? { tier } : {}), widthPx: 100, align: role === 'price' ? 'right' : 'left', hidden: false, frozen: false })
const NAME_COL = col('name', 'Item', 'name')
const COLS_A = [NAME_COL, col('c1', 'cash w/o', 'price', 'cash_wo'), col('c2', 'Retail', 'price', 'cash_gst'), col('c3', 'Pack', 'other')]
const COLS_B = [NAME_COL, col('c1', 'Rate', 'price', 'cash_wo')]

async function seeded(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  const put = (kind: 'price_tier' | 'price_category' | 'price_tab' | 'price_row', rec: Record<string, unknown> & { id: string }) => savePriceRecord(db, kind, rec, STAMP)
  await put('price_tier', { id: 't1', key: 'cash_wo', label: 'cash w/o', position: 0 })
  await put('price_tier', { id: 't2', key: 'cash_gst', label: 'cash+GST', position: 1 })
  await put('price_category', { id: 'c-pipes', name: 'Pipes', color: null, position: 0 })
  await put('price_category', { id: 'c-fit', name: 'Fittings', color: 'url(javascript:alert(1))', position: 1 })
  await put('price_tab', { id: 'tb-pvc', categoryId: 'c-pipes', name: 'PVC pipes', position: 0, columns: COLS_A })
  await put('price_tab', { id: 'tb-gi', categoryId: 'c-pipes', name: 'GI pipes', position: 1, columns: COLS_B })
  await put('price_tab', { id: 'tb-elb', categoryId: 'c-fit', name: 'Elbows', position: 0, columns: COLS_B })
  await put('price_row', { id: 'r0', tabId: 'tb-pvc', idx: 0, kind: 'section', nameRuns: [{ t: 'BIG PANNA' }], cells: {} })
  await put('price_row', { id: 'r1', tabId: 'tb-pvc', idx: 1, kind: 'item', nameRuns: [{ t: 'PVC pipe 1/2 ', b: 1 }, { t: 'heavy', r: 1 }], cells: { c1: '110', c2: '1250.5', c3: '6 m' } })
  await put('price_row', { id: 'r2', tabId: 'tb-pvc', idx: 2, kind: 'item', nameRuns: [{ t: 'PVC pipe 3/4' }], cells: { c1: '150' } })
  await put('price_row', { id: 'r3', tabId: 'tb-pvc', idx: 3, kind: 'item', nameRuns: [{ t: LONG }], cells: { c1: '99999.25' } })
  await put('price_row', { id: 'r4', tabId: 'tb-gi', idx: 0, kind: 'item', nameRuns: [{ t: 'GI pipe 1/2' }], cells: { c1: '210' } })
  await put('price_row', { id: 'r5', tabId: 'tb-gi', idx: 1, kind: 'item', nameRuns: [{ t: 'GI pipe no price' }], cells: {} })
  await put('price_row', { id: 'r6', tabId: 'tb-elb', idx: 0, kind: 'item', nameRuns: [{ t: 'PVC elbow 1/2' }], cells: { c1: '12' } })
  return db
}
const emptyDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
async function snapshot(db: PhoneDb): Promise<string> {
  const out: Record<string, unknown> = {}
  for (const n of STORE_NAMES) out[n] = await getAllRecords(db, n as StoreName)
  return JSON.stringify(out)
}

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const settle = (ms = 60): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const props = (db: PhoneDb, extra: Partial<ScreenProps> = {}): ScreenProps => ({ db, onNavigate: () => undefined, ...extra })
async function mount(Screen: FC<ScreenProps>, p: ScreenProps): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Screen, p)) })
  await settle(120)
  return host
}
const btn = (h: ParentNode, text: string): HTMLElement | undefined => [...h.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.startsWith(text))
const click = async (el: Element | null | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const typeInto = async (el: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await settle(20)
}
const search = (h: HTMLElement): HTMLInputElement => h.querySelector<HTMLInputElement>('input[type="search"]')!
const names = (h: HTMLElement): string[] => [...h.querySelectorAll('.q3x-pl-item-name')].map((n) => n.textContent ?? '')

const SCREENS: [string, FC<ScreenProps>][] = [['tidy', TidyPriceList as FC<ScreenProps>], ['guided', GuidedPriceList as FC<ScreenProps>], ['inbox', InboxPriceList as FC<ScreenProps>]]

// ---- the read model ----------------------------------------------------------------------------------------------------------------

describe('read model', () => {
  it('turns stored records into shared types: live only, tab columns kept, name column first, junk runs dropped', async () => {
    const loaded = await loadPriceList(await seeded())
    const d = loaded.data
    expect(d.categories.map((c) => c.name)).toEqual(['Pipes', 'Fittings'])
    expect(d.categories.every((c) => c.color === null)).toBe(true) // a record's colour text is data and never reaches the screen
    expect(tabsOf(d, 'c-pipes').map((t) => t.name)).toEqual(['PVC pipes', 'GI pipes'])
    expect(d.tabs[0]!.columns[0]!.role).toBe('name')
    expect(d.rows['tb-pvc']!.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
    expect(coerceRuns([{ t: 'a', b: 1 }, null, 5, { t: 7 }, { t: '' }, { t: 'b', r: true }])).toEqual([{ t: 'a', b: 1 }, { t: 'b', r: 1 }])
    expect(coerceRuns('x')).toEqual([])
  })

  it('shows a tab with ITS OWN columns: labelled prices, tier words only when they add something, a dash for a missing price, "no price" cue', async () => {
    const d = (await loadPriceList(await seeded())).data
    const pvc = tabView(d.tabs.find((t) => t.id === 'tb-pvc')!, d.rows['tb-pvc']!, d.tiers)
    expect(pvc.columns.map((c) => c.label)).toEqual(['Item', 'cash w/o', 'Retail', 'Pack'])
    const r1 = pvc.rows.find((r) => r.id === 'r1')!
    expect(r1.name).toBe('PVC pipe 1/2 heavy')
    expect(r1.runs).toEqual([{ t: 'PVC pipe 1/2 ', b: 1 }, { t: 'heavy', r: 1 }])
    expect(r1.cells.map((c) => [c.label, c.tier, c.text])).toEqual([['cash w/o', '', '110'], ['Retail', 'cash+GST', '1,250.5'], ['Pack', '', '6 m']])
    expect(pvc.rows.find((r) => r.id === 'r0')!.cells).toEqual([]) // a section row is a divider
    const r2 = pvc.rows.find((r) => r.id === 'r2')!
    expect(r2.cells.find((c) => c.key === 'c2')!.text).toBe('') // drawn as EMPTY_CELL
    expect(EMPTY_CELL).not.toBe('')
    const gi = tabView(d.tabs.find((t) => t.id === 'tb-gi')!, d.rows['tb-gi']!, d.tiers)
    expect(gi.rows.find((r) => r.id === 'r5')!.noPrice).toBe(true)
    expect(gi.rows.find((r) => r.id === 'r4')!.noPrice).toBe(false)
    // amounts are decimal strings and stay exactly as stored (grouping only, nothing rounded)
    expect(pvc.rows.find((r) => r.id === 'r3')!.cells[0]!.text).toBe('99,999.25')
  })

  it('search: shared deterministic search over every tab, two letters minimum, every word must match, name matches first', async () => {
    const d = (await loadPriceList(await seeded())).data
    expect(searchAll(d, 'p')).toEqual([])
    expect(searchAll(d, '  ')).toEqual([])
    const hits = resolveHits(d, searchAll(d, 'pvc 1/2'))
    expect(hits.map((h) => h.row.name)).toEqual(['PVC pipe 1/2 heavy', 'PVC elbow 1/2'])
    expect(hits.map((h) => h.path)).toEqual(['Pipes > PVC pipes', 'Fittings > Elbows'])
    expect(searchAll(d, 'PVC 3/4').length).toBe(1) // protected sizes: 1/2 never answers 3/4
    expect(searchAll(d, '210').map((h) => h.rowId)).toEqual(['r4']) // a price is found too
    expect(searchAll(d, 'nothing like this')).toEqual([])
  })

  it('rights: no sync = full rights; linked = stored flags or none; reading is always allowed; the Phase 245 "not yet" line is gone in Phase 246', () => {
    expect(phoneRights(false, null)).toEqual({ add: true, edit: true, overwrite: true, delete: true, structure: true })
    expect(phoneRights(true, null)).toEqual({ add: false, edit: false, overwrite: false, delete: false, structure: false })
    expect(phoneRights(true, { add: true, edit: 'yes' })).toEqual({ add: true, edit: false, overwrite: false, delete: false, structure: false })
    expect(priceNotices(phoneRights(true, null)).join(' ')).toMatch(/^Read only/)
    expect(priceNotices(phoneRights(false, null))).toEqual([])
    const part = priceNotices(phoneRights(true, { add: true }))
    expect(part.join(' ')).not.toContain(PHONE_EDIT_LATER)
    expect(part.length).toBe(1)
  })

  it('empty state: not synced yet, switched off, everything deleted; sync words are passed through', () => {
    const sync = { tone: 'off' as const, text: 'Sync not set up', detail: 'Sign in under Settings to share bills with your other computers.' }
    const a = emptyState({ enabled: true, linked: false, anyRecords: false, sync })
    expect(a.title).toBe(EMPTY_TITLE)
    expect(a.body).toMatch(/not signed in/)
    expect(a.syncLine).toBe('Sync not set up \u00b7 Sign in under Settings to share bills with your other computers.')
    expect(emptyState({ enabled: true, linked: true, anyRecords: false, sync: null })).toMatchObject({ title: EMPTY_TITLE, syncLine: '' })
    expect(emptyState({ enabled: false, linked: true, anyRecords: true, sync }).title).toBe('Price List is switched off')
    expect(emptyState({ enabled: true, linked: true, anyRecords: true, sync }).title).toBe('The Price List is empty')
  })

  it('a hostile record (wrong shapes) does not throw', () => {
    const d = buildPriceData({
      tiers: [{ id: 't', key: 'k', label: 'K', position: 0 } as PriceTierRec],
      categories: [{ id: 'c', name: 'C', color: null, position: 0 } as unknown as PriceCategoryRec],
      tabs: [{ id: 'tb', categoryId: 'c', name: 'T', position: 0, columns: [{ nope: 1 }, 'x', null] } as unknown as PriceTabRec],
      rows: { tb: [{ id: 'r', tabId: 'tb', idx: 0, kind: 'item', nameRuns: 'bad', cells: { a: 5, b: 'ok' } } as unknown as PriceRowRec] },
      anyRecords: true
    })
    expect(tabView(d.tabs[0]!, d.rows.tb!, d.tiers).rows[0]!.name).toBe('')
  })
})

describe('settings mirror', () => {
  it('the pricelist.* keys the phone reads equal the shared defaults', () => {
    const keys = [PRICELIST_KEYS.enabled, PRICELIST_KEYS.mode, PRICELIST_KEYS.formatTier, PRICELIST_KEYS.strictness, PRICELIST_KEYS.maxSuggestions, PRICELIST_KEYS.markAutoFilled, PRICELIST_KEYS.fillName, PRICELIST_KEYS.excludedTabs]
    for (const k of keys) expect((SETTING_DEFAULTS as unknown as Record<string, unknown>)[k], k).toEqual(PRICELIST_DEFAULTS[k])
    expect(SETTING_DEFAULTS['pricelist.seatFlags']).toBeNull()
  })
})

// ---- the loader never writes -------------------------------------------------------------------------------------------------------

describe('loader', () => {
  it('reads without writing anything (no record, no outbox row changes)', async () => {
    const db = await seeded()
    const before = await snapshot(db)
    await loadPriceList(db)
    expect(await snapshot(db)).toBe(before)
  })
})

// ---- the three layouts --------------------------------------------------------------------------------------------------------------

describe('three layouts show the same data', () => {
  it('search "pvc 1/2" gives the same items and prices in tidy, guided and inbox', async () => {
    const seen: string[][] = []
    for (const [, Screen] of SCREENS) {
      const h = await mount(Screen, props(await seeded()))
      expect(search(h)).toBeTruthy()
      await typeInto(search(h), 'pvc 1/2')
      seen.push(names(h))
      expect(h.textContent).toContain('Pipes > PVC pipes')
      expect(h.textContent).toContain('cash w/o')
      expect(h.textContent).toContain('1,250.5')
      expect(h.textContent).toContain('Retail (cash+GST)')
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
    expect(seen[0]).toEqual(['PVC pipe 1/2 heavy', 'PVC elbow 1/2'])
    expect(seen[1]).toEqual(seen[0])
    expect(seen[2]).toEqual(seen[0])
  })

  it('tidy: first category and tab open at once, rows with their own columns, a section divider, long names whole, other tab and category on a tap', async () => {
    const h = await mount(TidyPriceList as FC<ScreenProps>, props(await seeded()))
    expect(names(h)).toEqual(['PVC pipe 1/2 heavy', 'PVC pipe 3/4', LONG])
    expect(h.querySelector('[data-testid="price-section"] .q3x-pl-section-name')!.textContent).toBe('BIG PANNA')
    expect(h.querySelector('.q3-run-b')!.textContent).toBe('PVC pipe 1/2 ')
    await click(btn(h, 'GI pipes'))
    expect(names(h)).toEqual(['GI pipe 1/2', 'GI pipe no price'])
    expect(h.textContent).toContain('No price')
    await click(btn(h, 'Fittings'))
    expect(names(h)).toEqual(['PVC elbow 1/2'])
  })

  it('guided: category, then tab, then prices, and the in-screen Back steps up', async () => {
    const h = await mount(GuidedPriceList as FC<ScreenProps>, props(await seeded()))
    expect(h.textContent).toContain('Step 1 of 3')
    expect(names(h)).toEqual([])
    await click(btn(h, 'Pipes'))
    expect(h.textContent).toContain('Step 2 of 3')
    await click(btn(h, 'PVC pipes'))
    expect(h.textContent).toContain('Step 3 of 3')
    expect(names(h)).toContain(LONG)
    await click(btn(h, 'Back to tabs'))
    expect(h.textContent).toContain('Step 2 of 3')
    await click(btn(h, 'Back to categories'))
    expect(h.textContent).toContain('Step 1 of 3')
  })

  it('inbox: every tab listed under its category, a tap opens it, Back to all tabs returns', async () => {
    const h = await mount(InboxPriceList as FC<ScreenProps>, props(await seeded()))
    expect([...h.querySelectorAll('.q3x-pl-group-title')].map((n) => n.textContent)).toEqual(['Pipes', 'Fittings'])
    await click(btn(h, 'Elbows'))
    expect(names(h)).toEqual(['PVC elbow 1/2'])
    await click(btn(h, 'Back to all tabs'))
    expect(btn(h, 'Elbows')).toBeTruthy()
  })

  it('a long name and a large amount are in the page whole (nothing cut)', async () => {
    for (const [, Screen] of SCREENS) {
      const h = await mount(Screen, props(await seeded()))
      await typeInto(search(h), 'galvanised')
      expect(names(h)).toEqual([LONG])
      expect(h.textContent).toContain('99,999.25')
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
  })

  it('empty phone: "Price List not on this phone yet" with the sync state in plain words, in every layout', async () => {
    const sync = { tone: 'off' as const, text: 'Sync not set up', detail: 'Sign in under Settings to share bills with your other computers.' }
    for (const [, Screen] of SCREENS) {
      const h = await mount(Screen, props(await emptyDb(), { dashboard: { view: { sync } as never, error: null } }))
      expect(h.textContent).toContain('Price List not on this phone yet')
      expect(h.textContent).toContain('Sync: Sync not set up')
      expect(search(h)).toBeNull()
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
  })

  it('a linked phone with no cached flags says Read only and every edit control is disabled; a phone with no sync has full rights (Phase 246)', async () => {
    const linked = await seeded()
    await setMetaValue(linked, 'org_id', 'org-1'); await setMetaValue(linked, 'branch_id', 'branch-phone')
    const a = await mount(TidyPriceList as FC<ScreenProps>, props(linked))
    expect(a.textContent).toContain('Read only')
    const open = [...a.querySelectorAll('input:not([type="search"]), textarea, [contenteditable="true"]')].filter((el) => !(el as HTMLInputElement).disabled)
    expect(open.length).toBe(0)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const b = await mount(TidyPriceList as FC<ScreenProps>, props(await seeded()))
    expect(b.textContent).not.toContain(PHONE_EDIT_LATER)
    expect(b.textContent).not.toContain('Read only')
  })

  it('switched off (pricelist.enabled false): the screen says so and the Dashboard entry is hidden', async () => {
    const db = await seeded()
    await setSetting(db, 'pricelist.enabled', false)
    const h = await mount(TidyPriceList as FC<ScreenProps>, props(db))
    expect(h.textContent).toContain('Price List is switched off')
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(PriceListEntry, { db, onOpen: () => undefined })) })
    await settle()
    expect(host.querySelector('button')).toBeNull()
  })
})

describe('Dashboard entry and layout registry', () => {
  it('the entry opens the Price List', async () => {
    let opened = 0
    const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await act(async () => { root!.render(createElement(PriceListEntry, { db: await seeded(), onOpen: () => { opened++ } })) })
    await settle()
    await click(btn(host, 'Price List'))
    expect(opened).toBe(1)
  })

  it('Classic has no Price List screen: a switch to Classic from there goes Home; the new layouts have it', () => {
    expect(layoutHasRoute('classic', 'pricelist')).toBe(false)
    for (const id of ['tidy', 'guided', 'inbox'] as const) expect(layoutHasRoute(id, 'pricelist')).toBe(true)
    expect(planLayoutChange({ current: 'tidy', next: 'classic', hasUnsaved: false, route: 'pricelist' })).toMatchObject({ action: 'apply', layout: 'classic', keepRoute: false })
    expect(planLayoutChange({ current: 'tidy', next: 'inbox', hasUnsaved: false, route: 'pricelist' })).toMatchObject({ action: 'apply', layout: 'inbox', keepRoute: true })
  })
})

// ---- the wrap rule on the new files ---------------------------------------------------------------------------------------------------

const ui = (...p: string[]): string => resolve(__dirname, '..', 'ui', ...p)
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = strip(readFileSync(ui('kit', 'pricelist.css'), 'utf8'))
interface Rule { selector: string; body: string }
const RULES: Rule[] = [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!.trim() }))
const decl = (r: Rule, prop: string): string | undefined => new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(r.body)?.[1]?.trim()

describe('wrap rule and tokens in the new Price List files', () => {
  it('no ellipsis, no hidden overflow, names / labels / notes / paths wrap, amounts never shrink', () => {
    expect(RULES.length).toBeGreaterThan(20)
    for (const r of RULES) expect(r.body, r.selector).not.toMatch(/text-overflow/)
    for (const r of RULES.filter((x) => /(name|label|text|title)/.test(x.selector))) {
      expect(decl(r, 'white-space'), r.selector).not.toBe('nowrap')
      expect(decl(r, 'overflow'), r.selector).not.toBe('hidden')
    }
    const amount = RULES.find((r) => r.selector === '.q3x-pl-amount')!
    expect(decl(amount, 'flex')).toBe('none')
    expect(amount.body).not.toMatch(/overflow\s*:\s*hidden/)
    const itemName = RULES.find((r) => r.selector === '.q3x-pl-item-name')!
    expect(decl(itemName, 'white-space')).toBe('normal')
    expect(decl(itemName, 'overflow-wrap')).toBe('anywhere')
  })

  it('every selector is .q3x-pl- and no raw colour is used (tokens only)', () => {
    for (const r of RULES) for (const sel of r.selector.split(',')) expect(sel.trim(), sel).toMatch(/^\.q3x-pl-/)
    expect(CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(CSS).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })

  it('no truncation helper, no ellipsis character and no emoji in the new sources', () => {
    const files = [['kit', 'priceListModel.ts'], ['kit', 'priceListLoad.ts'], ['kit', 'usePriceList.ts'], ['kit', 'PriceListParts.tsx'], ['layouts', 'tidy', 'TidyPriceList.tsx'], ['layouts', 'guided', 'GuidedPriceList.tsx'], ['layouts', 'inbox', 'InboxPriceList.tsx']]
    for (const f of files) {
      const src = readFileSync(ui(...f), 'utf8')
      expect(src, f.join('/')).not.toMatch(/sliceGraphemes|truncate|ellipsis|\.slice\(0,|\u2026/i)
      expect(src, f.join('/')).not.toMatch(/\p{Extended_Pictographic}/u)
      expect(src, f.join('/')).not.toMatch(/from '(electron|better-sqlite3)'|src\/main|\.\.\/main\//)
      expect(src, f.join('/')).not.toMatch(/savePriceRecord|softDeletePrice|withPriceOutbox/) // read only
    }
  })
})

// ---- Phase 253 (M24): the prices of an item are stacked one under another ----------------------------------------------------------
describe('stacked price columns (Phase 253)', () => {
  it('CSS: the cells list is a column, each cell is label-left / amount-right, nothing is side by side or cut', () => {
    const cells = RULES.find((r) => r.selector === '.q3x-pl-cells')!
    expect(decl(cells, 'flex-direction')).toBe('column')
    expect(decl(cells, 'flex-wrap')).not.toBe('wrap')
    const cell = RULES.find((r) => r.selector === '.q3x-pl-cell')!
    expect(decl(cell, 'justify-content')).toBe('space-between')
    expect(decl(cell, 'width')).toBe('100%')
    const value = RULES.find((r) => r.selector === '.q3x-pl-cell-value')!
    expect(decl(value, 'text-align')).toBe('right')
    const field = RULES.find((r) => r.selector === '.q3x-pl-editor .q3x-pl-field')!
    expect(decl(field, 'justify-content')).toBe('space-between') // the edit fields follow the same label-left / box-right line
    expect(decl(RULES.find((r) => r.selector === '.q3x-pl-field-input')!, 'min-height')).toBe('var(--touch-min)') // touch target kept
  })

  it('all three layouts draw every price as its own labelled line, in the same order with the same amounts', async () => {
    const seen: string[][] = []
    for (const [, Screen] of SCREENS) {
      const h = await mount(Screen, props(await seeded()))
      expect(search(h)).toBeTruthy()
      await typeInto(search(h), 'pvc pipe 1/2')
      const first = h.querySelector('[data-testid="price-row"]')!
      const lists = first.querySelectorAll('dl.q3x-pl-cells')
      expect(lists.length).toBe(1) // ONE list holding the lines, not several columns
      const lines = [...lists[0]!.querySelectorAll(':scope > .q3x-pl-cell')]
      expect(lines.length).toBe(3)
      for (const l of lines) { expect(l.children.length).toBe(2); expect(l.children[0]!.tagName).toBe('DT'); expect(l.children[1]!.tagName).toBe('DD') }
      seen.push(lines.map((l) => `${l.children[0]!.textContent}=${l.children[1]!.textContent}`))
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
    expect(seen[0]).toEqual(['cash w/o=110', 'Retail (cash+GST)=1,250.5', 'Pack=6 m'])
    expect(seen[1]).toEqual(seen[0])
    expect(seen[2]).toEqual(seen[0])
  })
})
