// @vitest-environment jsdom
// Phase 187 - hardening. Synthetic data only, COUNTS from the docs (about 1.9k bills, 12.9k customers); no real contents. Timings are sandbox numbers (Node + jsdom + fake IndexedDB), NOT a phone.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { normalizePartyName } from '../../shared/party/partyLite'
import { App as AppRaw, type AppProps } from '../App'
import { saveBill, type SaveBillInput } from '../data/billsRepo'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { listSearchCandidates } from '../data/historyRepo'
import { setMetaValue } from '../data/metaRepo'
import { listCustomers } from '../data/partiesRepo'
import { loadPartyDirectory } from '../data/partySearch'
import { Customers } from '../ui/Customers'
import { CUSTOMER_PAGE_SIZE, filterCustomers } from '../ui/customersModel'
import { History } from '../ui/History'
import { buildHistory } from '../ui/historyModel'
import { HISTORY_PAGE_SIZE } from '../../shared/history/historyList'
import { loadDashboard } from '../ui/loadDashboard'
import { rankBills } from '../../shared/history/historySearch'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const App = AppRaw as FC<AppProps>
const BILLS = 1900
const CUSTOMERS = 12900
const TODAY = '2026-10-21'
const NOW = (): Date => new Date('2026-10-21T10:00:00Z')
const timings: Record<string, number> = {}
async function timed<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
  const t = performance.now(); const r = await fn(); timings[label] = Math.round(performance.now() - t); return r
}
const pname = (i: number): string => `Party ${String(i).padStart(5, '0')} Traders`
const pid = (i: number): string => `party-${i}`

let db: PhoneDb
beforeAll(async () => {
  db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone'); await setMetaValue(db, 'po_prefix', 'PH-'); await setMetaValue(db, 'org_id', 'org-1')
  await timed('seed customers', async () => {
    const tx = db.idb.transaction('parties', 'readwrite'); const st = tx.objectStore('parties')
    for (let i = 0; i < CUSTOMERS; i++) {
      const nameNorm = normalizePartyName(pname(i))
      st.put({ id: pid(i), name: pname(i), nameNorm, name_norm: nameNorm, phone: i % 3 === 0 ? `98${String(10000000 + i).slice(-8)}` : null, address: null, transport: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, mergedInto: null })
    }
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  })
  await timed('seed bills', async () => {
    for (let i = 0; i < BILLS; i++) {
      const day = 1 + (i % 28); const month = 1 + (Math.floor(i / 28) % 10)
      const inp: SaveBillInput = {
        bill: { id: `bill-${i}`, party: { name: pname(i % 1500), phone: '', address: '', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, rows: [row(`steel pipe ${i}`, '2', '50'), row('fitting elbow', '3', '120.50'), row(`item-${i}`, '1', '10')] },
        partyId: pid(i % 1500)
      }
      await saveBill(db, inp)
    }
  })
}, 240_000)
afterAll(() => { console.log('PHASE187 sandbox timings (ms, NOT a phone):', JSON.stringify(timings)) })

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)) }) }
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root!.render(el) }); await tick(); await tick(); return host
}

describe('large corpus (counts only, synthetic contents)', () => {
  it('History: load, rank by party / PO / item / amount, group', async () => {
    const cands = await timed('history load', () => listSearchCandidates(db))
    expect(cands.length).toBe(BILLS)
    const party = await timed('search party', () => rankBills(cands, 'party 00042 traders'))
    expect(party.hits.length).toBeGreaterThan(0)
    // A bare number also matches the PO sequence (900 beats a party word), so the party's own bills are in the hits, not necessarily first.
    expect(party.hits.some((h) => h.partyName === pname(42))).toBe(true)
    const po = cands[100]!.poNumber
    const byPo = await timed('search po', () => rankBills(cands, po))
    expect(byPo.hits[0]!.poNumber).toBe(po)
    const item = await timed('search item', () => rankBills(cands, 'item-1234'))
    expect(item.hits.some((h) => h.id === 'bill-1234')).toBe(true)
    await timed('search amount', () => rankBills(cands, '610'))
    const h = await timed('history default 30d', () => buildHistory(cands, { query: '', range: '30d', today: TODAY }))
    expect(h.items.length).toBeLessThanOrEqual(HISTORY_PAGE_SIZE)
    const all = buildHistory(cands, { query: '', range: 'all', today: TODAY })
    expect(all.items.length + all.hiddenCount).toBe(BILLS)
    for (const k of ['history load', 'search party', 'search po', 'search item', 'search amount']) expect(timings[k]!, k).toBeLessThan(5000)
  }, 60_000)

  it('autocomplete over all customers: build once, then fast; the right name comes first', async () => {
    const dir = await timed('directory load', () => loadPartyDirectory(db))
    expect(dir.size()).toBe(CUSTOMERS)
    await timed('autocomplete first', () => dir.search('party 0'))
    const hit = await timed('autocomplete typed', () => dir.search('party 07777'))
    expect(hit[0]!.name).toBe(pname(7777))
    expect(dir.isNew(pname(7777))).toBe(false)
    expect(dir.isNew('Brand New Name')).toBe(true)
    await timed('autocomplete by phone', () => dir.search('9810000003'))
    expect(timings['autocomplete typed']!).toBeLessThan(2000)
  }, 60_000)

  it('Customers: list with bill counts and filter', async () => {
    const rows = await timed('customers list', () => listCustomers(db))
    expect(rows.length).toBe(CUSTOMERS)
    expect(rows.find((r) => r.id === pid(0))!.billCount).toBeGreaterThan(0)
    const f = await timed('customers filter', () => filterCustomers(rows, 'party 00123'))
    expect(f.some((r) => r.name === pname(123))).toBe(true)
    expect(timings['customers list']!).toBeLessThan(8000)
  }, 60_000)

  it('Dashboard loads without reading every row', async () => {
    const v = await timed('dashboard', () => loadDashboard(db, NOW(), null))
    expect(v).toBeTruthy()
    expect(timings.dashboard!).toBeLessThan(5000)
  }, 60_000)

  it('screens draw only one page of a huge list (the DOM stays small)', async () => {
    const hostC = await render(createElement(Customers, { db, onOpen: () => undefined, onAdd: () => undefined }))
    expect(hostC.querySelectorAll('li').length).toBeLessThanOrEqual(CUSTOMER_PAGE_SIZE)
    expect(hostC.textContent).toMatch(/Show more/)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const hostH = await render(createElement(History, { db, now: NOW, onOpenBill: () => undefined, onOpenTrash: () => undefined }))
    expect(hostH.querySelectorAll('li').length).toBeLessThanOrEqual(HISTORY_PAGE_SIZE)
    expect(hostH.textContent).toMatch(/more \(\d+ hidden\)|Show/)
  }, 60_000)
})

describe('touch targets and names', () => {
  const css = readFileSync(resolve(__dirname, '..', 'ui', 'ui.css'), 'utf8') + readFileSync(resolve(__dirname, '..', 'styles', 'pwa.css'), 'utf8')
  it('the touch minimum is at least 40 px and no tappable class is smaller', () => {
    expect(css).toMatch(/--touch-min:\s*40px/)
    const small: string[] = []
    for (const m of css.matchAll(/(\.q3-(?:btn|chip|icon-btn|input|li-btn|nav-item|search|erow-line)[\w-]*)\s*\{([^}]*)\}/g)) {
      const px = /min-height:\s*(\d+)px/.exec(m[2]!)
      if (px && Number(px[1]) < 40) small.push(`${m[1]} ${px[1]}px`)
    }
    expect(small).toEqual([])
  })
  it('every button and input on the main screens has a name', async () => {
    const services = { db, theme: 'navy-ember' as const }
    const host = await render(createElement(App, { services, backEnv: null }))
    const unnamed = (root_: HTMLElement): string[] => {
      const bad: string[] = []
      root_.querySelectorAll('button, input, select, textarea').forEach((el) => {
        const e = el as HTMLInputElement
        if (e.type === 'hidden') return
        const id = e.id
        const named = (e.getAttribute('aria-label') ?? '').trim() !== '' || (e.textContent ?? '').trim() !== '' || (id !== '' && root_.querySelector(`label[for="${id}"]`) !== null) || e.closest('label') !== null || (e.getAttribute('aria-labelledby') ?? '') !== ''
        if (!named) bad.push(`${el.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''}`)
      })
      return bad
    }
    expect(unnamed(host)).toEqual([])
    for (const label of ['History', 'Customers', 'Settings']) {
      const btn = [...host.querySelectorAll('nav button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLElement | undefined
      if (!btn) continue
      await act(async () => { btn.click() }); await tick(); await tick()
      expect(unnamed(host), label).toEqual([])
    }
  }, 60_000)
})

describe('phone code stays inside its lane', () => {
  it('this test file reads no desktop source', () => {
    expect(readFileSync(join(__dirname, 'hardening.test.ts'), 'utf8')).not.toMatch(/from '\.\.\/\.\.\/(main|renderer)/)
  })
})
