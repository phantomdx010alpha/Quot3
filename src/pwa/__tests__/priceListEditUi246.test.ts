// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { NO_RIGHTS, type PermFlags } from '../../shared/pricelist/perms'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { savePriceRecord } from '../data/priceListRepo'
import { writeCachedPerms } from '../data/priceRights'
import { listPending } from '../sync/outbox'
import { GuidedPriceList } from '../ui/layouts/guided/GuidedPriceList'
import { InboxPriceList } from '../ui/layouts/inbox/InboxPriceList'
import { TidyPriceList } from '../ui/layouts/tidy/TidyPriceList'
import type { ScreenProps } from '../ui/layouts/types'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 246 (M23): the phone Price List edit controls in jsdom. Invented names only. The real phone look, touch and sync are NOT checked here.
const STAMP = { at: '2026-11-13T09:00:00.000Z', branchId: 'branch-pc', seatNo: 1 }
const COLS = [
  { key: 'name', label: 'Item', type: 'text', role: 'name', widthPx: 200, align: 'left', hidden: false, frozen: true },
  { key: 'c1', label: 'Rate', type: 'number', role: 'price', tier: 'cash_wo', widthPx: 100, align: 'right', hidden: false, frozen: false }
]
async function seeded(flags: PermFlags | null): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'org_id', 'org-1'); await setMetaValue(db, 'branch_id', 'branch-phone')
  if (flags) await writeCachedPerms(db, { seatNo: 2, flags }, STAMP.at)
  const put = (k: 'price_tier' | 'price_category' | 'price_tab' | 'price_row', r: Record<string, unknown> & { id: string }) => savePriceRecord(db, k, r, STAMP)
  await put('price_tier', { id: 't1', key: 'cash_wo', label: 'cash w/o', position: 0 })
  await put('price_category', { id: 'c1', name: 'Pipes', color: null, position: 0 })
  await put('price_tab', { id: 'tb1', categoryId: 'c1', name: 'PVC pipes', position: 0, columns: COLS })
  await put('price_row', { id: 'r1', tabId: 'tb1', idx: 0, kind: 'item', nameRuns: [{ t: 'PVC pipe 1/2' }], cells: { c1: '110' } })
  await put('price_row', { id: 'r2', tabId: 'tb1', idx: 1, kind: 'item', nameRuns: [{ t: 'PVC pipe 3/4' }], cells: {} })
  return db
}

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const settle = (ms = 80): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(Screen: FC<ScreenProps>, p: ScreenProps): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Screen, p)) })
  await settle(150)
  return host
}
const btns = (h: ParentNode, text: string): HTMLButtonElement[] => [...h.querySelectorAll<HTMLButtonElement>('button')].filter((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').startsWith(text))
const click = async (el: Element | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
const typeInto = async (el: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  await settle(30)
}
const pendingPrice = async (db: PhoneDb) => (await listPending(db)).filter((p) => p.kind.startsWith('price_'))

describe('edit controls on the phone Price List', () => {
  it('a seat with only `edit`: Edit is on; the filled price is off with the plain-words reason; an empty price can be filled; one save = one queued change and the push is kicked', async () => {
    const db = await seeded({ ...NO_RIGHTS, edit: true })
    let kicked = 0
    const h = await mount(TidyPriceList as FC<ScreenProps>, { db, onNavigate: () => undefined, onChanged: () => { kicked++ } })
    expect(btns(h, 'Edit').length).toBe(2)
    expect(btns(h, 'Edit').every((b) => !b.disabled)).toBe(true)
    expect(btns(h, 'Add item')[0]!.disabled).toBe(true) // no `add`
    expect(btns(h, 'Add item')[0]!.title).toMatch(/not allowed.*Add new items/s)
    await click(btns(h, 'Edit')[0])
    const price = h.querySelector<HTMLInputElement>('#pl-r1-c1')!
    expect(price.disabled).toBe(true) // 110 is filled: changing it needs `overwrite`
    expect(price.title).toMatch(/Change existing prices/)
    expect(btns(h, 'Delete')[0]!.disabled).toBe(true)
    await click(btns(h, 'Cancel')[0])
    await click(btns(h, 'Edit')[1])
    const empty = h.querySelector<HTMLInputElement>('#pl-r2-c1')!
    expect(empty.disabled).toBe(false)
    await typeInto(empty, '45.50')
    await click(btns(h, 'Save')[0])
    expect(h.querySelector('[data-testid="price-edit-note"]')?.textContent).toContain('Saved')
    const p = await pendingPrice(db)
    expect(p.length).toBe(1)
    expect(p[0]).toMatchObject({ kind: 'price_row', op: 'upsert' })
    expect(kicked).toBe(1)
    await settle(300)
    expect(h.textContent).toContain('45.5') // the list was read again
  })

  it('no rights: every Edit / Add / structure control is off, nothing can be typed into, and the read-only line is shown', async () => {
    const db = await seeded(NO_RIGHTS)
    const h = await mount(GuidedPriceList as FC<ScreenProps>, { db, onNavigate: () => undefined })
    expect(h.textContent).toContain('Read only')
    const open = [...h.querySelectorAll<HTMLInputElement>('input:not([type="search"])')].filter((i) => !i.disabled)
    expect(open.length).toBe(0)
    expect(btns(h, 'Add category')[0]!.disabled).toBe(true)
    expect(await pendingPrice(db)).toHaveLength(0)
  })

  it('a phone with no sync has full rights but no branch: it says so in plain words and queues nothing', async () => {
    const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
    const put = (k: 'price_category' | 'price_tab' | 'price_row', r: Record<string, unknown> & { id: string }) => savePriceRecord(db, k, r, STAMP)
    await put('price_category', { id: 'c1', name: 'Pipes', color: null, position: 0 })
    await put('price_tab', { id: 'tb1', categoryId: 'c1', name: 'PVC pipes', position: 0, columns: COLS })
    await put('price_row', { id: 'r1', tabId: 'tb1', idx: 0, kind: 'item', nameRuns: [{ t: 'PVC pipe 1/2' }], cells: { c1: '110' } })
    const h = await mount(InboxPriceList as FC<ScreenProps>, { db, onNavigate: () => undefined })
    await click(btns(h, 'PVC pipes')[0])
    await click(btns(h, 'Edit')[0])
    await typeInto(h.querySelector<HTMLInputElement>('#pl-n-r1')!, 'Renamed')
    await click(btns(h, 'Save')[0])
    expect(h.querySelector('[data-testid="price-edit-note"]')?.textContent).toMatch(/Sign this phone in/)
    expect(await pendingPrice(db)).toHaveLength(0)
  })
})
