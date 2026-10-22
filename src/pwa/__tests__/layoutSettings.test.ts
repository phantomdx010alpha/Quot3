// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { openPhoneDb, type PhoneDb } from '../data/db'
import { Settings } from '../ui/Settings'
import { plainHint, settingsWords } from '../ui/layouts/shared/SettingsWords'
import type { SyncAdmin } from '../ui/services'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Phase 195 - plain words and the Advanced fold exist only when `plain` is passed (new layouts); classic output stays as it was.
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = '' })
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await tick()
  return host
}
const freshDb = (): Promise<PhoneDb> => openPhoneDb({ factory: new IDBFactory(), writer: { held: true } })
const props = (db: PhoneDb, page: string | undefined, plain: boolean) => ({ db, version: '0.1.38', theme: 'navy-ember' as const, onTheme: () => undefined, page, plain, now: () => new Date('2026-10-21T10:00:00Z') })
const field = (el: HTMLElement, label: string): HTMLInputElement => el.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
const sync = { link: async () => ({ ok: false, code: 'OTHER', message: 'x' }), signOut: async () => undefined } as unknown as SyncAdmin

describe('Phase 195 - words helpers', () => {
  it('classic keeps today\'s words; plain renames through the map', () => {
    expect(settingsWords(false).t('Branch and sync')).toBe('Branch and sync')
    expect(settingsWords(undefined).t('PO prefix')).toBe('PO prefix')
    expect(settingsWords(true).t('Branch and sync')).toBe('Connect to your PC')
    expect(settingsWords(true).t('PO prefix')).toBe('Bill number letters')
    expect(settingsWords(true).t('Company')).toBe('Company')
    expect(plainHint(settingsWords(false), 'Sign in, PO prefix, share bills with your computers')).toContain('PO prefix')
    expect(plainHint(settingsWords(true), 'Sign in, PO prefix, share bills with your computers')).not.toContain('PO prefix')
  })
})

describe('Phase 195 - Settings in the new layouts', () => {
  it('home list: plain word in the new layout, today\'s word in classic', async () => {
    const db = await freshDb()
    const plain = await render(createElement(Settings, props(db, undefined, true)))
    expect(plain.textContent).toContain('Connect to your PC')
    expect(plain.textContent).not.toContain('Branch and sync')
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    const classic = await render(createElement(Settings, props(db, undefined, false)))
    expect(classic.textContent).toContain('Branch and sync')
    expect(classic.querySelector('details')).toBeNull()
  })

  it('sync page: Advanced fold is closed, holds the 3 technical fields, keeps typed values, other fields stay outside', async () => {
    const db = await freshDb()
    const el = await render(createElement(Settings, { ...props(db, 'sync', true), sync }))
    expect(el.textContent).toContain('Bill number letters')
    expect(el.textContent).not.toContain('PO prefix')
    const fold = el.querySelector('details.q3x-advanced') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')!.textContent).toBe('Advanced')
    for (const l of ['Supabase URL', 'Public (anon) key', 'License key']) expect(fold.contains(field(el, l))).toBe(true)
    for (const l of ['Seat email', 'Seat password', 'Branch name for this phone', 'Bill number letters']) { expect(field(el, l)).not.toBeNull(); expect(fold.contains(field(el, l))).toBe(false) }
    const url = field(el, 'Supabase URL')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(url, 'https://x.supabase.co')
      url.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')) })
    await act(async () => { fold.open = false; fold.dispatchEvent(new Event('toggle')) })
    expect(field(el, 'Supabase URL').value).toBe('https://x.supabase.co')
  })

  it('sync page in classic: no fold, today\'s labels', async () => {
    const db = await freshDb()
    const el = await render(createElement(Settings, { ...props(db, 'sync', false), sync }))
    expect(el.querySelector('details')).toBeNull()
    expect(field(el, 'PO prefix')).not.toBeNull()
    expect(el.textContent).toContain('Branch and sync')
  })

  it('storage page: "Last backup" in the new layout, "Last export" in classic', async () => {
    const db = await freshDb()
    let el = await render(createElement(Settings, props(db, 'storage', true)))
    expect(el.textContent).toContain('Last backup')
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    el = await render(createElement(Settings, props(db, 'storage', false)))
    expect(el.textContent).toContain('Last export')
  })
})
