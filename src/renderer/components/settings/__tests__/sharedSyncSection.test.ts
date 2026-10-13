// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedLicenseStatus } from '@shared/sync/license'
import { SHARED_MESSAGES } from '@shared/sync/license'
import type { SharedSyncBridge, SharedUiError } from '@shared/sync/sharedUi'
import { SyncSection } from '../SyncSection'
import { useSharedSyncStore } from '../../../stores/sharedSyncStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Phase 139 - the Sync v2 screen over a fake bridge. No network, no Electron. */
const OFF: SharedLicenseStatus = { state: 'not_activated', secretsAvailable: true, readOnly: false, host: '', licenseHint: '', emailHint: '', orgId: '', seatNo: null, registered: null, branches: [], activatedAt: '', link: { state: 'unchecked', at: '', message: '' } }
const ON: SharedLicenseStatus = { ...OFF, state: 'activated', host: 'abc.supabase.co', licenseHint: 'Q3-****-****-JKLM', emailHint: 's***@example.com', seatNo: 1, registered: { branchId: 'b1', name: 'Main shop', poPrefix: 'MN-' }, activatedAt: '2026-10-13T05:00:00.000Z' }
const SECRETS = ['SuperSecret#9', 'eyJanon', 'Q3-ABCD-EFGH-JKLM']

let root: Root | undefined
let host: HTMLDivElement
let fail: SharedUiError | undefined
let bridge: SharedSyncBridge
let nameFree: boolean

const FILLED = { supabaseUrl: 'https://abcdefghij.supabase.co', anonKey: 'eyJanon.' + 'a'.repeat(60) + '.' + 'b'.repeat(40), licenseKey: 'Q3-ABCD-EFGH-JKLM', email: 's1@example.com', password: 'SuperSecret#9', branchName: 'Main shop', poPrefix: 'MN-' }

function setValue(el: HTMLInputElement, v: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const field = (label: string): HTMLInputElement => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent?.startsWith(label))
  return host.querySelector<HTMLInputElement>(`#${l!.getAttribute('for')}`)!
}
const button = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement
const flush = async (ms = 0): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
async function fill(over: Partial<typeof FILLED> = {}): Promise<void> {
  const v = { ...FILLED, ...over }
  await act(async () => {
    setValue(field('Supabase project URL'), v.supabaseUrl); setValue(field('Anon (public) key'), v.anonKey); setValue(field('License key'), v.licenseKey)
    setValue(field('Login e-mail'), v.email); setValue(field('Login password'), v.password); setValue(field('Branch name'), v.branchName); setValue(field('PO prefix'), v.poPrefix)
  })
  await flush(500)
}

beforeEach(() => {
  vi.useFakeTimers()
  fail = undefined; nameFree = true
  let status = OFF
  bridge = {
    status: vi.fn(async () => ({ ok: true as const, data: status })),
    activate: vi.fn(async () => { if (fail) return { ok: false as const, error: fail }; status = ON; return { ok: true as const, data: ON } }),
    deactivate: vi.fn(async () => { status = OFF; return { ok: true as const, data: OFF } }),
    branchNameFree: vi.fn(async () => ({ ok: true as const, data: { free: nameFree } })),
    renameBranch: vi.fn(async (i: { name: string }) => { if (fail) return { ok: false as const, error: fail }; status = { ...ON, registered: { ...ON.registered!, name: i.name } }; return { ok: true as const, data: status } }),
    listBranches: vi.fn(async () => ({ ok: true as const, data: [{ branchId: 'b1', name: 'Main shop', poPrefix: 'MN-', deviceName: 'Counter PC', lastSeenAt: null, isThis: true }, { branchId: 'b2', name: 'Mysore', poPrefix: 'MY-', deviceName: '', lastSeenAt: null, isThis: false }] })),
    compare: vi.fn(async () => ({ ok: true as const, data: { state: 'done' as const, upload: 1, download: 2, conflict: 0, skip: 5 } }))
  }
  ;(window as unknown as { quot3: unknown }).quot3 = { syncShared: bridge }
  useSharedSyncStore.setState({ status: null, branches: [], busy: false, error: '', notice: '', routed: null, nameState: 'idle', nameFor: '', compareNote: '' })
  host = document.createElement('div'); document.body.appendChild(host)
})
afterEach(() => { act(() => { root?.unmount() }); root = undefined; host.remove(); delete (window as unknown as { quot3?: unknown }).quot3; vi.useRealTimers() })

async function mount(): Promise<void> {
  root = createRoot(host)
  await act(async () => { root!.render(createElement(SyncSection)) })
  await flush()
}

describe('Phase 139 - Sync v2 screen', () => {
  it('has no passphrase field and asks for e-mail, password, branch name and PO prefix', async () => {
    await mount()
    const labels = [...host.querySelectorAll('label')].map((l) => l.textContent ?? '')
    expect(labels.some((l) => /passphrase/i.test(l))).toBe(false)
    for (const l of ['Login e-mail', 'Login password', 'Branch name', 'PO prefix', 'License key']) expect(labels.some((x) => x.startsWith(l))).toBe(true)
    expect(field('Login password').type).toBe('password')
    expect(host.textContent).not.toMatch(/passphrase/i)
  })

  it('valid sign-in sends the normalised input once and never echoes a secret', async () => {
    await mount(); await fill()
    await act(async () => { button('Sign in').click() }); await flush()
    expect(bridge.activate).toHaveBeenCalledTimes(1)
    expect(bridge.activate).toHaveBeenCalledWith(expect.objectContaining({ email: 's1@example.com', branchName: 'Main shop', poPrefix: 'MN-', password: 'SuperSecret#9' }))
    expect(host.textContent).toMatch(/Signed in/)
    expect(host.textContent).toContain('Main shop (MN-)')
    for (const s of SECRETS) expect(host.innerHTML).not.toContain(s)
  })

  it('checks the branch name live and refuses a taken name without calling activate', async () => {
    nameFree = false
    await mount(); await fill()
    expect(bridge.branchNameFree).toHaveBeenCalled()
    expect(host.textContent).toMatch(/already uses this name/)
    await act(async () => { button('Sign in').click() }); await flush()
    expect(bridge.activate).not.toHaveBeenCalled()
  })

  it('shows the server refusal under the right field (name taken, prefix taken)', async () => {
    await mount(); await fill()
    fail = { code: 'VALIDATION', kind: 'name_taken', message: SHARED_MESSAGES.name_taken }
    await act(async () => { button('Sign in').click() }); await flush()
    expect(field('Branch name').getAttribute('aria-describedby') ?? '').toContain('err')
    expect(host.textContent).toContain(SHARED_MESSAGES.name_taken)
    fail = { code: 'VALIDATION', kind: 'prefix_taken', message: SHARED_MESSAGES.prefix_taken }
    await act(async () => { button('Sign in').click() }); await flush()
    expect(host.textContent).toContain(SHARED_MESSAGES.prefix_taken)
  })

  it('seat in use offers the takeover box and sends takeover on the next try', async () => {
    await mount(); await fill()
    fail = { code: 'VALIDATION', kind: 'seat_in_use', message: SHARED_MESSAGES.seat_in_use }
    await act(async () => { button('Sign in').click() }); await flush()
    const box = host.querySelector<HTMLInputElement>('input[type=checkbox]')!
    expect(box).toBeTruthy()
    fail = undefined
    await act(async () => { box.click() })
    await act(async () => { button('Sign in').click() }); await flush()
    expect(bridge.activate).toHaveBeenLastCalledWith(expect.objectContaining({ takeover: true }))
  })

  it('bad password shows under the password field; a paused server says paused', async () => {
    await mount(); await fill()
    fail = { code: 'AUTH_FAILED', kind: 'auth_failed', message: SHARED_MESSAGES.auth_failed }
    await act(async () => { button('Sign in').click() }); await flush()
    expect(host.textContent).toContain(SHARED_MESSAGES.auth_failed)
    expect(field('Login password').getAttribute('aria-describedby') ?? '').toContain('err')
    fail = { code: 'SERVER_PAUSED', kind: 'server_paused', message: SHARED_MESSAGES.server_paused }
    await act(async () => { button('Sign in').click() }); await flush()
    expect(host.textContent).toMatch(/paused/)
    expect(host.textContent).not.toMatch(/Could not reach/)
  })

  it('does not call the bridge for an invalid form and marks the fields', async () => {
    await mount()
    await act(async () => { button('Sign in').click() }); await flush()
    expect(bridge.activate).not.toHaveBeenCalled()
    expect(host.querySelectorAll('[role=alert]').length).toBeGreaterThan(3)
  })

  it('signed in: lists branches, renames with the uniqueness check, runs Compare and sync, signs out only after typing the word', async () => {
    await mount(); await fill()
    await act(async () => { button('Sign in').click() }); await flush()
    expect(host.textContent).toContain('Mysore')
    expect(host.textContent).toContain('(this one)')
    // rename: taken name is blocked, a free one goes through
    nameFree = false
    await act(async () => { setValue(field('Rename this branch'), 'Mysore') }); await flush(500)
    expect(button('Rename').disabled).toBe(true)
    nameFree = true
    await act(async () => { setValue(field('Rename this branch'), 'Mysore 2') }); await flush(500)
    await act(async () => { button('Rename').click() }); await flush()
    expect(bridge.renameBranch).toHaveBeenCalledWith({ name: 'Mysore 2' })
    // compare
    await act(async () => { button('Compare and sync').click() }); await flush()
    expect(bridge.compare).toHaveBeenCalledTimes(1)
    expect(host.textContent).toMatch(/1 to send, 2 to fetch/)
    // sign out needs the word
    await act(async () => { button('Sign out on this computer').click() }); await flush()
    const confirm = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Sign out') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(bridge.deactivate).not.toHaveBeenCalled()
  })

  it('without the v2 bridge the old v1 screen is kept (until Phase 140 wires it)', async () => {
    delete (window as unknown as { quot3?: unknown }).quot3
    ;(window as unknown as { quot3: unknown }).quot3 = {}
    root = createRoot(host)
    await act(async () => { root!.render(createElement(SyncSection)) })
    expect(host.querySelector('[aria-label="Sync sign-in"]')).toBeNull()
  })
})
