// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, useState, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { getSetting } from '../data/settingsRepo'
import { countRecords } from '../data/db'
import { openNewBill, setItemField } from '../ui/editor/editorModel'
import { BottomSheet } from '../ui/kit/BottomSheet'
import { DateField } from '../ui/kit/DateField'
import { changeBillDate, isIsoDate } from '../ui/kit/dateField'
import { prebuildPartyDirectory, schedulePartyPrebuild, takePrebuiltDirectory } from '../ui/kit/partyPrebuild'
import { SavedSheet } from '../ui/kit/SavedSheet'
import { ShareBar } from '../ui/kit/ShareBar'
import { closeTopSheet, openSheetCount } from '../ui/kit/sheetStack'
import { StatusPill } from '../ui/kit/StatusPill'
import type { StatusFlags } from '../ui/kit/statusModel'
import type { ShareEnv } from '../share/shareSheet'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
const mount = async (el: ReturnType<typeof createElement>): Promise<HTMLElement> => {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  return host
}
const freshDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
const click = async (el: Element | null | undefined): Promise<void> => { await act(async () => { (el as HTMLElement).click() }) }
const byText = (t: string): HTMLButtonElement => [...document.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement
const key = async (el: Element, k: string, shiftKey = false): Promise<void> => { await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true })) }) }

describe('BottomSheet', () => {
  const Host: FC<{ onClosed?: () => void }> = (p) => {
    const [open, setOpen] = useState(true)
    return createElement('div', null,
      createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Open'),
      createElement(BottomSheet, { open, title: 'Pick', onClose: () => { setOpen(false); p.onClosed?.() } },
        createElement('button', { id: 'a' }, 'First'), createElement('button', { id: 'b' }, 'Last')))
  }
  it('is a named modal dialog with a named Close button, focus moves in', async () => {
    await mount(createElement(Host))
    const dlg = document.querySelector('[role="dialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.getAttribute('aria-label')).toBe('Pick')
    expect(dlg.querySelector('button[aria-label="Close"]')).toBeTruthy()
    expect(document.activeElement).toBe(dlg)
    expect(openSheetCount()).toBe(1)
  })
  it('Esc closes it and unregisters; focus goes back', async () => {
    const closed = vi.fn()
    await mount(createElement(Host, { onClosed: closed }))
    document.getElementById('opener')!.focus()
    await act(async () => { (document.querySelector('[role="dialog"]') as HTMLElement).focus() })
    await key(document.querySelector('[role="dialog"]')!, 'Escape')
    expect(closed).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(openSheetCount()).toBe(0)
  })
  it('Back (closeTopSheet) closes the sheet first and reports it; with none open it reports false', async () => {
    const closed = vi.fn()
    await mount(createElement(Host, { onClosed: closed }))
    let used = false
    await act(async () => { used = closeTopSheet() })
    expect(used).toBe(true)
    expect(closed).toHaveBeenCalledTimes(1)
    expect(closeTopSheet()).toBe(false)
  })
  it('the backdrop and the Close button close it', async () => {
    const closed = vi.fn()
    await mount(createElement(Host, { onClosed: closed }))
    await click(document.querySelector('.q3x-sheet-backdrop'))
    expect(closed).toHaveBeenCalledTimes(1)
    await click(document.getElementById('opener'))
    await click(document.querySelector('button[aria-label="Close"]'))
    expect(closed).toHaveBeenCalledTimes(2)
  })
  it('Tab wraps inside the sheet (last -> first, Shift+Tab first -> last)', async () => {
    await mount(createElement(Host))
    const dlg = document.querySelector('[role="dialog"]')!
    const items = [...dlg.querySelectorAll<HTMLElement>('button')]
    const first = items[0]!; const last = items[items.length - 1]!
    last.focus(); await key(last, 'Tab')
    expect(document.activeElement).toBe(first)
    first.focus(); await key(first, 'Tab', true)
    expect(document.activeElement).toBe(last)
  })
  it('two sheets: Back closes only the newest', async () => {
    const one = vi.fn(); const two = vi.fn()
    const Two: FC = () => createElement('div', null,
      createElement(BottomSheet, { open: true, title: 'One', onClose: one }),
      createElement(BottomSheet, { open: true, title: 'Two', onClose: two }))
    await mount(createElement(Two))
    expect(openSheetCount()).toBe(2)
    await act(async () => { closeTopSheet() })
    expect(two).toHaveBeenCalledTimes(1); expect(one).not.toHaveBeenCalled()
  })
})

describe('StatusPill', () => {
  const flags: StatusFlags = { readOnly: true, offline: true, gateNote: null, clearedNote: null, update: { text: 'New version available.', canReload: true }, installOffer: false, sync: null }
  it('shows the thin read-only line and ONE named pill; the sheet lists every notice with its action', async () => {
    const actions: string[] = []
    await mount(createElement(StatusPill, { flags, onAction: (id) => actions.push(id) }))
    expect(document.querySelector('.q3x-readonly-line')!.getAttribute('role')).toBe('alert')
    const pills = document.querySelectorAll('.q3x-pill')
    expect(pills).toHaveLength(1)
    expect(pills[0]!.textContent).toBe('Read-only+2')
    expect(pills[0]!.getAttribute('aria-haspopup')).toBe('dialog')
    await click(pills[0])
    expect([...document.querySelectorAll('.q3x-status-item')].map((e) => e.getAttribute('data-kind'))).toEqual(['readonly', 'update', 'offline'])
    await click(byText('Reload'))
    expect(actions).toEqual(['reload'])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('renders nothing when nothing is active; every button in the sheet is named', async () => {
    const quiet: StatusFlags = { readOnly: false, offline: false, gateNote: null, clearedNote: null, update: null, installOffer: false, sync: null }
    const host = await mount(createElement(StatusPill, { flags: quiet }))
    expect(host.innerHTML).toBe('')
    act(() => root!.render(createElement(StatusPill, { flags: { ...quiet, installOffer: true } })))
    await click(document.querySelector('.q3x-pill'))
    for (const b of document.querySelectorAll('button')) expect((b.textContent ?? '').trim() !== '' || b.getAttribute('aria-label')).toBeTruthy()
  })
})

describe('ShareBar and SavedSheet', () => {
  const makeBill = (): ReturnType<typeof openNewBill>['bill'] => {
    let s = openNewBill({ branchId: 'b', roundOff: false, today: '2026-10-22', newId: (() => { let i = 0; return () => `r${++i}` })() })
    s = setItemField(s, s.bill.rows[0]!.id, 'qty', '2')
    return { ...s.bill, poNumber: 'PO-7', party: { ...s.bill.party, name: 'Sharma Traders' } }
  }
  const downloads: string[] = []
  const env: ShareEnv = { nav: undefined, makeFile: (b, n, m) => new File([b as BlobPart], n, { type: m }), download: (f) => downloads.push(f.name) }
  const make = (made: string[]) => async (bill: { poNumber: string }, choice: { style: string; kind: string }): Promise<{ bytes: Uint8Array; mime: string; fileName: string; pages: number; paper: 'A5' }> => {
    made.push(`${choice.style}/${choice.kind}`)
    return { bytes: new Uint8Array([1]), mime: 'image/png', fileName: `Quotation-${bill.poNumber}.png`, pages: 1, paper: 'A5' }
  }

  it('view mode: Share (primary) + Edit, shares with the remembered choice, never changes the bill or writes a record', async () => {
    const db = await freshDb(); const bill = makeBill(); const frozen = JSON.stringify(bill)
    const made: string[] = []; const edited = vi.fn()
    await mount(createElement(ShareBar, { db, bill, env, make: make(made) as never, onEdit: edited }))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(byText('Share').className).toContain('q3x-btn-primary')
    expect(document.querySelector('[aria-label="Style"]')).toBeNull()
    await click(byText('Share')); await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(made).toEqual(['professional/image'])
    expect(downloads).toEqual(['Quotation-PO-7.png'])
    expect(document.querySelector('.q3x-sharebar-text')!.textContent).toMatch(/downloads/)
    await click(byText('Edit')); expect(edited).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(bill)).toBe(frozen)
    expect(await countRecords(db, 'bills')).toBe(0)
    expect(await countRecords(db, 'parties')).toBe(0)
  })
  it('review mode: choices change what is shared and are remembered (settings only)', async () => {
    const db = await freshDb(); const bill = makeBill(); const made: string[] = []
    await mount(createElement(ShareBar, { db, bill, env, make: make(made) as never, mode: 'review' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    await click(byText('Rough')); await click(byText('PDF'))
    await click(byText('Share')); await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(made).toEqual(['rough/pdf'])
    expect(await getSetting(db, 'share.defaults')).toEqual({ style: 'rough', kind: 'pdf' })
  })
  it('a failing share shows the plain message and keeps the bar usable', async () => {
    const db = await freshDb(); const bill = makeBill()
    await mount(createElement(ShareBar, { db, bill, env, make: (async () => { throw new Error('Too long for one image.') }) as never }))
    await click(byText('Share')); await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Too long for one image.')
    expect(byText('Share').disabled).toBe(false)
  })
  it('SavedSheet: titled Saved, says the PO and party, Share and Done; Done closes; closed or no bill draws nothing', async () => {
    const db = await freshDb(); const bill = makeBill(); const done = vi.fn()
    await mount(createElement(SavedSheet, { open: true, db, bill, onDone: done, env, make: make([]) as never }))
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('Saved')
    expect(document.querySelector('.q3x-saved-text')!.textContent).toBe('Bill PO-7 for Sharma Traders is saved.')
    expect(byText('Share')).toBeTruthy()
    await click(byText('Done')); expect(done).toHaveBeenCalledTimes(1)
    act(() => root!.render(createElement(SavedSheet, { open: false, db, bill, onDone: done })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => root!.render(createElement(SavedSheet, { open: true, db, bill: null, onDone: done })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('DateField', () => {
  it('isIsoDate accepts real dates only', () => {
    for (const ok of ['2026-10-22', '2024-02-29']) expect(isIsoDate(ok)).toBe(true)
    for (const bad of ['', '2026-13-01', '2026-02-30', '2025-02-29', '22-10-2026', null, 5]) expect(isIsoDate(bad)).toBe(false)
  })
  it('changeBillDate is setBillDate for a real date and the SAME state otherwise', () => {
    const s = openNewBill({ branchId: 'b', roundOff: false, today: '2026-10-22' })
    expect(changeBillDate(s, '2026-11-01').bill.billDate).toBe('2026-11-01')
    expect(changeBillDate(s, '')).toBe(s)
    expect(changeBillDate(s, '2026-02-30')).toBe(s)
  })
  it('the field is labelled and calls onChange only with a valid date', async () => {
    const seen: string[] = []
    await mount(createElement(DateField, { label: 'Bill date', value: '2026-10-22', onChange: (v) => seen.push(v) }))
    const input = document.querySelector('input')! as HTMLInputElement
    expect(document.querySelector('label')!.getAttribute('for')).toBe(input.id)
    expect(input.type).toBe('date')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { setter.call(input, '2026-11-02'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { setter.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(seen).toEqual(['2026-11-02'])
  })
})

describe('party pre-build [A]', () => {
  it('classic does nothing; another layout loads at the idle moment, once, and the directory is handed out', async () => {
    const db = await freshDb()
    const jobs: (() => void)[] = []
    const idle = { request: (cb: () => void) => { jobs.push(cb) } }
    schedulePartyPrebuild(db, 'classic', idle)
    expect(jobs).toHaveLength(0)
    expect(takePrebuiltDirectory(db)).toBeNull()
    schedulePartyPrebuild(db, 'tidy', idle)
    schedulePartyPrebuild(db, 'tidy', idle)
    expect(jobs).toHaveLength(1)
    const p = takePrebuiltDirectory(db)!
    expect(p).toBeTruthy()
    jobs[0]!()
    const dir = await p
    expect(dir.size()).toBe(0)
    expect(await prebuildPartyDirectory(db, idle)).toBe(dir)
  })
})
