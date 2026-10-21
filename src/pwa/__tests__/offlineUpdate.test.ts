// @vitest-environment jsdom
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { act, createElement, type FC } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App as AppRaw, type AppProps } from '../App'
import { openPhoneDb, putRecord, type PhoneDb } from '../data/db'
import { setMetaValue } from '../data/metaRepo'
import { browserMarkerStore, checkDataCleared, DATA_MARKER_KEY, type MarkerStore } from '../platform/clearedData'
import { createInstallController, type BeforeInstallPromptLike, type InstallEnv } from '../platform/installPrompt'
import { isOnline, watchOnline } from '../platform/online'
import { describeSaveFailure, isQuotaError, isStorageNearlyFull } from '../platform/storageErrors'
import { canApplyUpdate, registerServiceWorker, shouldCheckForUpdate, updateBannerModel, UPDATE_CHECK_MS, type UpdateHandle } from '../platform/swUpdate'
import { loadVersionGate, versionGateMessage } from '../ui/versionGate'

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = IDBKeyRange
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const App = AppRaw as FC<AppProps>

let root: Root | null = null
afterEach(() => { if (root) act(() => root!.unmount()); root = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); localStorage.clear() })
const tick = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 25)) }) }
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  const host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root!.render(el) })
  await tick()
  return host
}
async function freshDb(): Promise<PhoneDb> { return openPhoneDb({ factory: new IDBFactory(), writer: { held: true } }) }

describe('update-wait rule', () => {
  it('reload is allowed only with no unsaved bill, and the banner says why not', () => {
    expect(canApplyUpdate({ hasUnsavedWork: false })).toBe(true)
    expect(updateBannerModel({ hasUnsavedWork: false })).toEqual({ text: 'New version available.', canReload: true })
    const m = updateBannerModel({ hasUnsavedWork: true })
    expect(m.canReload).toBe(false)
    expect(m.text).toMatch(/save or discard/i)
  })
  it('the check runs at start, then at most once per interval', () => {
    expect(shouldCheckForUpdate(null, 1000)).toBe(true)
    expect(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MS - 1)).toBe(false)
    expect(shouldCheckForUpdate(1000, 1000 + UPDATE_CHECK_MS)).toBe(true)
  })
  it('apply asks the guard again at the tap and does nothing when it says no', async () => {
    const posted: unknown[] = []
    const waiting = { postMessage: (m: unknown) => posted.push(m) }
    const reg = { waiting, installing: null, addEventListener: () => undefined, update: vi.fn(async () => undefined) }
    vi.stubGlobal('navigator', { serviceWorker: { controller: {}, register: async () => reg, addEventListener: () => undefined } })
    let handle: UpdateHandle | null = null
    const checkNow = await registerServiceWorker((h) => { handle = h })
    expect(handle).not.toBeNull()
    expect(handle!.apply(() => false)).toBe(false)
    expect(posted).toEqual([])
    expect(handle!.apply(() => true)).toBe(true)
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }])
    await checkNow!()
    expect(reg.update).toHaveBeenCalledTimes(1)
  })
  it('a failed registration or a failed update check never throws', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { register: async () => { throw new Error('offline') } } })
    expect(await registerServiceWorker(() => undefined)).toBeNull()
    const reg = { waiting: null, installing: null, addEventListener: () => undefined, update: async () => { throw new Error('offline') } }
    vi.stubGlobal('navigator', { serviceWorker: { controller: {}, register: async () => reg } })
    const fn = await registerServiceWorker(() => undefined)
    await expect(fn!()).resolves.toBeUndefined()
  })
})

describe('version gate', () => {
  it('words the count; nothing waiting means no note', () => {
    expect(versionGateMessage({ total: 0, bills: 0 })).toBeNull()
    expect(versionGateMessage({ total: 1, bills: 1 })).toBe('Update the app to see 1 bill.')
    expect(versionGateMessage({ total: 5, bills: 3 })).toBe('Update the app to see 3 bills.')
    expect(versionGateMessage({ total: 2, bills: 0 })).toBe('Update the app to see 2 newer records.')
  })
  it('reads the aside store and leaves the records untouched', async () => {
    const db = await freshDb()
    expect(await loadVersionGate(db)).toBeNull()
    for (const [i, kind] of ['bill', 'bill', 'party'].entries()) {
      await putRecord(db, 'sync_aside', { kind, rec_id: `r${i}`, version: 2, min_reader_ver: 99, payload_json: '{}', seen_at: '2026-10-21T00:00:00Z' })
    }
    expect(await loadVersionGate(db)).toBe('Update the app to see 2 bills.')
    expect(await loadVersionGate(db)).toBe('Update the app to see 2 bills.')
  })
})

describe('offline', () => {
  it('unknown counts as online; watch reports changes and stops', () => {
    expect(isOnline({})).toBe(true)
    expect(isOnline({ navigator: { onLine: false } })).toBe(false)
    const target = new EventTarget()
    const env = { navigator: { onLine: true }, addEventListener: (t: string, f: () => void) => target.addEventListener(t, f), removeEventListener: (t: string, f: () => void) => target.removeEventListener(t, f) }
    const seen: boolean[] = []
    const stop = watchOnline(env as never, (o) => seen.push(o))
    target.dispatchEvent(new Event('offline')); target.dispatchEvent(new Event('online'))
    stop()
    target.dispatchEvent(new Event('offline'))
    expect(seen).toEqual([false, true])
  })
  it('the app shows the offline note and removes it when back online', async () => {
    const db = await freshDb()
    await setMetaValue(db, 'branch_id', 'b1')
    const host = await render(createElement(App, { services: { db, theme: 'navy-ember' }, backEnv: null }))
    expect(host.textContent).not.toMatch(/Offline\./)
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    expect(host.textContent).toMatch(/Offline\. Your bills are on this phone/)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(host.textContent).not.toMatch(/Offline\./)
  })
})

describe('install prompt', () => {
  function fakeEnv(standalone = false) {
    const t = new EventTarget()
    const env: InstallEnv = { addEventListener: (n, f) => t.addEventListener(n, f), removeEventListener: (n, f) => t.removeEventListener(n, f), isStandalone: () => standalone }
    return { t, env }
  }
  const promptEvent = (outcome: 'accepted' | 'dismissed') => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & BeforeInstallPromptLike
    ;(e as { prompt: () => Promise<void> }).prompt = vi.fn(async () => undefined)
    ;(e as { userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }).userChoice = Promise.resolve({ outcome })
    return e
  }
  it('keeps the event, prompts once, and installed state follows the choice', async () => {
    const { t, env } = fakeEnv()
    const c = createInstallController(env)
    expect(c.canInstall()).toBe(false)
    expect(await c.prompt()).toBe('unavailable')
    const ev = promptEvent('accepted')
    t.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(c.canInstall()).toBe(true)
    expect(await c.prompt()).toBe('accepted')
    expect(c.installed()).toBe(true)
    expect(c.canInstall()).toBe(false)
    expect(await c.prompt()).toBe('unavailable')
  })
  it('a dismissed prompt is not installed; appinstalled and standalone both mean installed', async () => {
    const a = fakeEnv(); const c = createInstallController(a.env)
    a.t.dispatchEvent(promptEvent('dismissed'))
    expect(await c.prompt()).toBe('dismissed'); expect(c.installed()).toBe(false)
    const b = fakeEnv(); const d = createInstallController(b.env)
    b.t.dispatchEvent(promptEvent('dismissed')); b.t.dispatchEvent(new Event('appinstalled'))
    expect(d.installed()).toBe(true); expect(d.canInstall()).toBe(false)
    const s = fakeEnv(true); const e = createInstallController(s.env)
    s.t.dispatchEvent(promptEvent('accepted'))
    expect(e.installed()).toBe(true); expect(e.canInstall()).toBe(false)
  })
})

describe('storage full or cleared', () => {
  it('recognises quota errors and gives plain advice; other errors keep their text', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true)
    expect(isQuotaError({ code: 22 })).toBe(true)
    expect(isQuotaError(new Error('disk is full'))).toBe(true)
    expect(isQuotaError(new Error('boom'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(describeSaveFailure({ name: 'QuotaExceededError' })).toMatch(/Nothing was saved/)
    expect(describeSaveFailure(new Error('boom'))).toBe('Could not save: boom')
  })
  it('nearly full needs known figures', () => {
    expect(isStorageNearlyFull(96, 100)).toBe(true)
    expect(isStorageNearlyFull(50, 100)).toBe(false)
    expect(isStorageNearlyFull(null, 100)).toBe(false)
    expect(isStorageNearlyFull(10, 0)).toBe(false)
  })
  const mem = (): MarkerStore & { v: string | null } => { const m = { v: null as string | null, get: () => m.v, set: () => { m.v = '1' } }; return m }
  it('cleared = marker present but nothing left and not linked', () => {
    const m = mem()
    expect(checkDataCleared({ bills: 0, customers: 0, linked: false }, m)).toBe('ok') // first run
    expect(checkDataCleared({ bills: 1, customers: 0, linked: false }, m)).toBe('ok') // marker set
    expect(m.v).toBe('1')
    expect(checkDataCleared({ bills: 0, customers: 0, linked: false }, m)).toBe('cleared')
    expect(checkDataCleared({ bills: 0, customers: 0, linked: true }, m)).toBe('ok')
    expect(checkDataCleared({ bills: 0, customers: 0, linked: false }, null)).toBe('ok')
  })
  it('the browser marker holds only the word 1, never bill data', () => {
    const s = browserMarkerStore()!
    s.set()
    expect(localStorage.getItem(DATA_MARKER_KEY)).toBe('1')
    expect(localStorage.length).toBe(1)
  })
  it('the app warns when the data was cleared', async () => {
    localStorage.setItem(DATA_MARKER_KEY, '1')
    const db = await freshDb()
    const host = await render(createElement(App, { services: { db, theme: 'navy-ember' }, backEnv: null }))
    expect(host.textContent).toMatch(/may have cleared it/)
  })
  it('a version gate note shows in the app and no note without waiting records', async () => {
    const db = await freshDb()
    await setMetaValue(db, 'branch_id', 'b1')
    let host = await render(createElement(App, { services: { db, theme: 'navy-ember' }, backEnv: null }))
    expect(host.textContent).not.toMatch(/Update the app to see/)
    act(() => root!.unmount()); root = null; document.body.innerHTML = ''
    await putRecord(db, 'sync_aside', { kind: 'bill', rec_id: 'x', version: 3, min_reader_ver: 99, payload_json: '{}', seen_at: '2026-10-21T00:00:00Z' })
    host = await render(createElement(App, { services: { db, theme: 'navy-ember' }, backEnv: null }))
    expect(host.textContent).toMatch(/Update the app to see 1 bill\./)
  })
})
