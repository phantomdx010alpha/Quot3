// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import '../../shared/format'
import { row } from '../../shared/__fixtures__/bills'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { getBill, saveBill } from '../data/billsRepo'
import { getSetting, setSetting } from '../data/settingsRepo'
import { listPending } from '../sync/outbox'
import { SharePanel } from '../ui/SharePanel'
import type { ShareEnv } from '../share/shareSheet'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function freshDb(): Promise<PhoneDb> {
  const db = await openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
  await setMetaValue(db, 'branch_id', 'branch-phone')
  await setMetaValue(db, 'po_prefix', 'PH-')
  return db
}
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 15)) }) }
let root: ReturnType<typeof createRoot> | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })

async function mount(db: PhoneDb, id: string, extra: Partial<Parameters<typeof SharePanel>[0]> = {}): Promise<HTMLElement> {
  const bill = await getBill(db, id)
  const el = document.createElement('div'); document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => { root!.render(createElement(SharePanel, { db, bill, ...extra })) })
  await tick()
  return el
}
const btn = (el: HTMLElement, label: string): HTMLButtonElement => [...el.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement
const seed = async (db: PhoneDb): Promise<string> => (await saveBill(db, { bill: { id: 'b-1', party: { name: 'Alpha Traders', phone: '98450', address: 'Main Road', transport: '' }, formatId: 'non_gst', extraCols: [], paperOverride: null, billDate: '2026-10-21', rows: [row('steel pipe', '2', '50')] } })).id

describe('Phase 184 - SharePanel', () => {
  it('shows the saved defaults, remembers a new choice, and sharing leaves the bill, its revision and the sync outbox untouched', async () => {
    const db = await freshDb()
    const id = await seed(db)
    await setSetting(db, 'share.defaults', { style: 'rough', kind: 'pdf' })
    const pendingBefore = (await listPending(db)).length
    const revBefore = (await getBill(db, id)).revision
    const downloads: string[] = []
    const env: ShareEnv = { nav: undefined, makeFile: (b, n, m) => new File([b as BlobPart], n, { type: m }), download: (f) => downloads.push(f.name) }
    const made: string[] = []
    const el = await mount(db, id, { env, make: async (bill, choice) => { made.push(`${choice.style}/${choice.kind}`); return { bytes: new Uint8Array([1]), mime: 'application/pdf', fileName: `Quotation-${bill.poNumber}.pdf`, pages: 1, paper: 'A5' } } })
    expect(btn(el, 'Rough').getAttribute('aria-pressed')).toBe('true')
    expect(btn(el, 'PDF').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { btn(el, 'Professional').click() })
    await tick()
    expect(await getSetting(db, 'share.defaults')).toEqual({ style: 'professional', kind: 'pdf' })
    await act(async () => { btn(el, 'Share PDF').click() })
    await tick()
    expect(made).toEqual(['professional/pdf'])
    expect(downloads).toHaveLength(1)
    expect(el.textContent).toContain('Saved to your downloads')
    expect((await getBill(db, id)).revision).toBe(revBefore)
    expect((await listPending(db)).length).toBe(pendingBefore)
  })

  it('a render failure is shown in words and the panel stays usable', async () => {
    const db = await freshDb()
    const id = await seed(db)
    const el = await mount(db, id, { make: async () => { throw new Error('This bill is too long to share as one image. Share it as a PDF instead.') } })
    await act(async () => { btn(el, 'Share image').click() })
    await tick()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('too long')
    expect(btn(el, 'Share image').disabled).toBe(false)
  })

  it('Professional without a company name says so (a placeholder is printed); with one it does not', async () => {
    const db = await freshDb()
    const id = await seed(db)
    let el = await mount(db, id)
    expect(el.textContent).toContain('No company name yet')
    act(() => root!.unmount()); root = null
    await setSetting(db, 'company.profile', { name: 'Phone Co', phone: '', address: '', logoDataUrl: null })
    el = await mount(db, id)
    expect(el.textContent).not.toContain('No company name yet')
  })
})
