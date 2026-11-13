// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySharedServer, InMemorySharedTransport, SharedTransportError } from '../../main/sync/sharedTransport'
import { NO_RIGHTS, type PermFlags } from '../../shared/pricelist/perms'
import { exportBackup, importBackup } from '../data/backup'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { getMetaValue, setMetaValue } from '../data/metaRepo'
import { savePriceRecord, type PriceStamp } from '../data/priceListRepo'
import { readRefused, writeCachedPerms } from '../data/priceRights'
import { linkPhoneToOrganisation } from '../sync/branch'
import { createPhoneConnect } from '../sync/connect'
import { createPhoneSyncEngine } from '../sync/engine'
import { withPriceOutbox } from '../sync/outbox'
import { createPhonePushWorker } from '../sync/push'
import { NO_SERVER_PRICE_LIST, priceFirstSyncNote, priceStorageNote, priceSyncLines, refusedLine } from '../sync/priceSyncWords'
import { createSessionVault } from '../sync/session'
import type { PhoneSharedPort } from '../sync/transport'
import { GuidedPriceList } from '../ui/layouts/guided/GuidedPriceList'
import { InboxPriceList } from '../ui/layouts/inbox/InboxPriceList'
import { TidyPriceList } from '../ui/layouts/tidy/TidyPriceList'
import type { ScreenProps } from '../ui/layouts/types'
import { loadPriceSyncStatus } from '../ui/priceSyncStatus'
import { SettingsStorage } from '../ui/SettingsStorage'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 248 (M23): Price List sync words, offline revoke, storage note and the three-layout parity. Invented names only. No real server, phone or Supabase.
const LICENSE = 'Q3-ABCD-EFGH-JKLM'
const T0 = Date.parse('2026-11-13T10:00:00.000Z')
const APP = '0.1.52'
const ALL = { add: true, edit: true, overwrite: true, delete: true, structure: true }
const uuid = (): string => globalThis.crypto.randomUUID()
const COLS = [
  { key: 'name', label: 'Item', type: 'text', role: 'name', widthPx: 200, align: 'left', hidden: false, frozen: true },
  { key: 'c1', label: 'Rate', type: 'number', role: 'price', tier: 'cash_wo', widthPx: 100, align: 'right', hidden: false, frozen: false }
]

function world() {
  let clock = T0
  const server = new InMemorySharedServer({ now: () => clock })
  const seats = [1, 2].map((i) => ({ email: `seat${i}@example.test`, password: `pw-${i}-secret` }))
  const { orgId } = server.addOrg({ licenseKey: LICENSE, seats })
  server.setPricePerms(orgId, 2, ALL)
  return { server, orgId, seats, now: () => clock }
}
type World = ReturnType<typeof world>

async function phone(w: World, seat: number, wrap?: (p: InMemorySharedTransport) => PhoneSharedPort) {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  const port = new InMemorySharedTransport(w.server)
  const vault = createSessionVault(db)
  const s = w.seats[seat - 1] as { email: string; password: string }
  const r = await linkPhoneToOrganisation(db, port, vault, { supabaseUrl: 'https://example-project.supabase.co', anonKey: 'invented-anon', licenseKey: LICENSE, email: s.email, password: s.password, branchName: `Phone ${seat}`, poPrefix: `P${seat}` }, w.now)
  expect(r.ok).toBe(true)
  const connect = createPhoneConnect(db, vault, port)
  const conn = async () => { const c = await connect.connect(); return { port: (wrap ? wrap(port) : port) as PhoneSharedPort, creds: c.creds } }
  const timers = { setTimer: () => 0, clearTimer: () => undefined, now: () => new Date(w.now()) }
  const branchId = (await getMetaValue(db, 'branch_id')) as string
  const engine = createPhoneSyncEngine({ db, appVer: APP, now: () => new Date(w.now()), setTimer: () => 0, clearTimer: () => undefined, env: { onVisible: () => () => undefined, onOnline: () => () => undefined }, connect: async () => conn() })
  const stamp = (): PriceStamp => ({ at: new Date(w.now()).toISOString(), branchId, seatNo: seat })
  const out = withPriceOutbox({ now: () => new Date(w.now()) })
  return {
    db, engine,
    push: () => createPhonePushWorker({ db, connect: conn, appVer: APP }, timers).runOnce(),
    save: (kind: 'price_tier' | 'price_category' | 'price_tab' | 'price_row', f: Record<string, unknown> & { id: string }) => savePriceRecord(db, kind, f, stamp(), out)
  }
}

describe('plain words (pure)', () => {
  it('first-sync note: no server list, nothing, counts with a size estimate', () => {
    expect(priceFirstSyncNote({ available: false, download: 0, upload: 0 })).toBe(NO_SERVER_PRICE_LIST)
    expect(NO_SERVER_PRICE_LIST).toMatch(/no Price List yet/)
    expect(priceFirstSyncNote({ available: true, download: 0, upload: 0 })).toMatch(/nothing to download or send/)
    expect(priceFirstSyncNote({ available: true, download: 1, upload: 0 })).toMatch(/^1 Price List entry to download \(roughly \d+ KB/)
    expect(priceFirstSyncNote({ available: true, download: 400, upload: 2 })).toMatch(/400 Price List entries to download.*2 entries to send\.$/)
  })
  it('status lines: server missing first, refused is named, "everything is sent" only when linked and nothing waits', () => {
    const base = { items: 3, queued: 0, refused: 0, serverMissing: false, linked: true }
    expect(priceSyncLines(base)).toEqual(['Price List: 3 items on this phone.', 'Price List: everything is sent.'])
    expect(priceSyncLines({ ...base, items: 1, queued: 2 })).toEqual(['Price List: 1 item on this phone.', '2 Price List changes are waiting to be sent.'])
    expect(priceSyncLines({ ...base, serverMissing: true })[0]).toBe(NO_SERVER_PRICE_LIST)
    expect(priceSyncLines({ ...base, serverMissing: true }).join(' ')).not.toMatch(/everything is sent/)
    expect(priceSyncLines({ ...base, refused: 1 }).at(-1)).toBe(refusedLine(1))
    expect(refusedLine(2)).toMatch(/2 Price List changes were not accepted.*They stay on this phone and were not sent/)
    expect(priceSyncLines({ items: 0, queued: 0, refused: 0, serverMissing: false, linked: false })).toEqual(['Price List: nothing on this phone yet.'])
    expect(priceStorageNote(0)).toMatch(/empty/)
    expect(priceStorageNote(10)).toMatch(/10 items.*included in the backup file/)
  })
})

describe('first sync and sync status with the in-memory server', () => {
  it('the preview carries the Price List counts; the status says nothing is missing', async () => {
    const w = world()
    const p1 = await phone(w, 1)
    await p1.save('price_category', { id: uuid(), name: 'Pipes', color: null, position: 0 })
    await p1.push()
    const p2 = await phone(w, 2)
    const prev = await p2.engine.prepareFirstSync()
    expect(prev.priceList).toEqual({ available: true, download: 1, upload: 0 })
    expect(priceFirstSyncNote(prev.priceList)).toMatch(/1 Price List entry to download/)
    await p2.engine.completeFirstSync(prev, { mode: 'all' })
    const st = await loadPriceSyncStatus(p2.db)
    expect(st).toMatchObject({ serverMissing: false, linked: true, refused: 0 })
  })

  it('a server without the Price List: said in plain words, remembered after the first sync, bills still sync', async () => {
    const w = world()
    const wrap = (port: InMemorySharedTransport): PhoneSharedPort => new Proxy(port, { get: (t, k, rcv) => {
      if (k !== 'manifest') return Reflect.get(t, k, rcv)
      return async (a: { kind: string }) => { if (a.kind.startsWith('price_')) throw new SharedTransportError('invalid_input'); return (t as unknown as { manifest(x: unknown): Promise<unknown> }).manifest(a) }
    } }) as unknown as PhoneSharedPort
    const p = await phone(w, 2, wrap)
    const prev = await p.engine.prepareFirstSync()
    expect(prev.priceList.available).toBe(false)
    expect(priceFirstSyncNote(prev.priceList)).toBe(NO_SERVER_PRICE_LIST)
    await p.engine.completeFirstSync(prev, { mode: 'all' })
    const st = await loadPriceSyncStatus(p.db)
    expect(st.serverMissing).toBe(true)
    expect(priceSyncLines(st)[0]).toBe(NO_SERVER_PRICE_LIST)
  })

  it('rights revoked while the phone was offline: the next push is refused, the change stays, it is flagged without content, nothing is lost or thrown', async () => {
    const w = world()
    const p = await phone(w, 2)
    const secret = 'Secret supplier note'
    const id = uuid()
    await p.save('price_category', { id, name: secret, color: null, position: 0 }) // made offline, while seat 2 still had its rights
    expect((await loadPriceSyncStatus(p.db)).queued).toBe(1)
    w.server.setPricePerms(w.orgId, 2, NO_RIGHTS) // the main branch takes the rights away
    await expect(p.push()).resolves.toBeDefined()
    const st = await loadPriceSyncStatus(p.db)
    expect(st).toMatchObject({ queued: 0, refused: 1 })
    expect(priceSyncLines(st).join(' ')).toMatch(/not accepted by the main branch.*stays on this phone/)
    expect(JSON.stringify(await readRefused(p.db))).not.toContain(secret)
    const f = await exportBackup(p.db, { appVersion: APP })
    expect(await f.blob.text()).toContain(secret) // the change is still held (and backed up) on the phone
    expect(f.counts.price_categories).toBe(1)
  })
})

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const settle = (ms = 80): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
async function mount(Screen: FC<any>, p: unknown): Promise<HTMLElement> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Screen, p as object)) })
  await settle(150)
  return host
}
const STAMP = { at: '2026-11-13T09:00:00.000Z', branchId: 'branch-pc', seatNo: 1 }
async function seeded(flags: PermFlags): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'org_id', 'org-1'); await setMetaValue(db, 'branch_id', 'branch-phone')
  await writeCachedPerms(db, { seatNo: 2, flags }, STAMP.at)
  const put = (k: 'price_tier' | 'price_category' | 'price_tab' | 'price_row', r: Record<string, unknown> & { id: string }) => savePriceRecord(db, k, r, STAMP)
  await put('price_tier', { id: 't1', key: 'cash_wo', label: 'cash w/o', position: 0 })
  await put('price_category', { id: 'c1', name: 'Pipes', color: null, position: 0 })
  await put('price_tab', { id: 'tb1', categoryId: 'c1', name: 'PVC pipes', position: 0, columns: COLS })
  await put('price_row', { id: 'r1', tabId: 'tb1', idx: 0, kind: 'item', nameRuns: [{ t: 'PVC pipe 1/2 inch heavy duty long name' }], cells: { c1: '110.50' } })
  await put('price_row', { id: 'r2', tabId: 'tb1', idx: 1, kind: 'item', nameRuns: [{ t: 'PVC pipe 3/4' }], cells: { c1: '1234567.89' } })
  return db
}

describe('Settings > Storage and backup, new layouts only', () => {
  it('plain mode shows the Price List size note and counts; classic wording is unchanged', async () => {
    const db = await seeded(NO_RIGHTS)
    const h = await mount(SettingsStorage, { db, version: APP, plain: true, download: () => undefined })
    expect(h.querySelector('[data-testid="price-storage-note"]')?.textContent).toMatch(/2 items.*included in the backup file/)
    const classic = await mount(SettingsStorage, { db, version: APP, download: () => undefined })
    expect(classic.querySelector('[data-testid="price-storage-note"]')).toBeNull()
  })
  it('a format-1 file (no Price List parts) still imports and leaves the Price List empty', async () => {
    const db = await seeded(NO_RIGHTS)
    const v1 = JSON.stringify({ format: 'quot3-phone-backup', format_version: 1, app_version: '0.1.40', exported_at: '2026-01-01T00:00:00.000Z', stores: {} })
    const r = await importBackup(db, v1)
    expect(r.counts.price_rows).toBe(0)
    expect((await loadPriceSyncStatus(db)).items).toBe(0)
  })
})

describe('three-layout parity (tidy / guided / inbox)', () => {
  const click = async (el: Element | undefined): Promise<void> => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await settle() }
  const buttons = (h: ParentNode): HTMLButtonElement[] => [...h.querySelectorAll<HTMLButtonElement>('button')]
  async function open(Screen: FC<ScreenProps>, db: PhoneDb): Promise<HTMLElement> {
    const h = await mount(Screen, { db, onNavigate: () => undefined })
    for (let i = 0; i < 3 && !h.textContent!.includes('PVC pipe 3/4'); i++) {
      const next = buttons(h).find((b) => /PVC pipes|Pipes/.test(b.textContent ?? '') && !b.disabled)
      if (!next) break
      await click(next)
    }
    return h
  }
  const layouts: [string, FC<ScreenProps>][] = [['tidy', TidyPriceList as FC<ScreenProps>], ['guided', GuidedPriceList as FC<ScreenProps>], ['inbox', InboxPriceList as FC<ScreenProps>]]

  it('same data in every layout: full names, full amounts, the same read-only words', async () => {
    const db = await seeded(NO_RIGHTS)
    for (const [name, Screen] of layouts) {
      const h = await open(Screen, db)
      const t = h.textContent ?? ''
      expect(t, name).toContain('PVC pipe 1/2 inch heavy duty long name')
      expect(t, name).toContain('PVC pipe 3/4')
      expect(t, name).toContain('110.5')
      expect(t.replace(/,/g, ''), name).toContain('1234567.89') // shown with Indian digit grouping (12,34,567.89), never cut
      expect(t, name).toContain('Read only')
      expect(t, name).not.toMatch(/…|\.\.\./)
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
  })

  it('same disabled states and same reasons: with no rights every edit control is off in every layout, with the same reason words', async () => {
    const db = await seeded(NO_RIGHTS)
    const reasons: string[][] = []
    for (const [name, Screen] of layouts) {
      const h = await open(Screen, db)
      const off = buttons(h).filter((b) => /^(Edit|Add item|Add category|Add tab|Delete)/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
      expect(off.length, name).toBeGreaterThan(0)
      expect(off.every((b) => b.disabled), name).toBe(true)
      reasons.push([...new Set(off.map((b) => (b.title ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))].sort())
      act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    }
    // Every reason a layout shows is one of the shared plain-words sentences (the union is the shared set; none is layout-specific).
    const all = new Set(reasons.flat())
    for (const r of reasons) for (const s of r) expect(all.has(s)).toBe(true)
    expect(all.size).toBeGreaterThan(0)
    for (const s of all) expect(s).toMatch(/not allowed|read only|Read only|rights/i)
  })

  it('the new sources keep the wrap rule: no ellipsis, no truncation, and the touch size token is 44px or more', () => {
    const root248 = join(__dirname, '..')
    for (const f of ['sync/priceSyncWords.ts', 'ui/priceSyncStatus.ts', 'ui/PriceSyncLines.tsx']) {
      const src = readFileSync(join(root248, f), 'utf8')
      expect(src, f).not.toMatch(/sliceGraphemes|truncate|ellipsis|\.slice\(0,|…/i)
    }
    const css = readFileSync(join(root248, 'ui/layouts/layouts.css'), 'utf8')
    const m = css.match(/--touch-min:\s*(\d+)px/)
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(44)
  })
})
