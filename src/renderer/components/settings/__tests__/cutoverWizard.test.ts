// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedLicenseStatus } from '@shared/sync/license'
import type { CutoverBridge, CutoverStatus } from '@shared/sync/cutover'
import type { SharedSyncBridge } from '@shared/sync/sharedUi'
import { SyncSection } from '../SyncSection'
import { useCutoverStore } from '../../../stores/cutoverStore'
import { useSharedSyncStore } from '../../../stores/sharedSyncStore'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Phase 140 - the cutover wizard over fake bridges. No network, no Electron. */
const OFF: SharedLicenseStatus = { state: 'not_activated', secretsAvailable: true, readOnly: false, host: '', licenseHint: '', emailHint: '', orgId: '', seatNo: null, registered: null, branches: [], activatedAt: '', link: { state: 'unchecked', at: '', message: '' } }
const st = (step: CutoverStatus['step'], over: Partial<CutoverStatus> = {}): CutoverStatus => ({
  needed: step !== 'done', step, stepNo: step === 'backup' ? 1 : step === 'signin' ? 2 : step === 'compare' ? 3 : 4, stepCount: 4, backupFile: step === 'backup' ? '' : 'manual-1.db', v1Inert: step !== 'backup', v1LicenseHint: 'Q3-****-JKLM', ...over
})

let root: Root | undefined
let host: HTMLDivElement
let cur: CutoverStatus
let bridge: CutoverBridge
let beginFails: boolean

const button = (text: string): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined
const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }

beforeEach(() => {
  vi.useFakeTimers()
  beginFails = false; cur = st('backup')
  bridge = {
    status: vi.fn(async () => ({ ok: true as const, data: cur })),
    begin: vi.fn(async () => { if (beginFails) return { ok: false as const, error: { code: 'IO_ERROR', message: 'The safety backup could not be made, so nothing was changed.' } }; cur = st('signin'); return { ok: true as const, data: cur } }),
    compare: vi.fn(async () => { cur = st('unify'); return { ok: true as const, data: { status: cur, compare: { state: 'done' as const, upload: 761, download: 1166, conflict: 0, skip: 1927 } } } }),
    unify: vi.fn(async (i: { skip: boolean }) => { cur = st('done'); return { ok: true as const, data: { status: cur, merged: i.skip ? 0 : 4, billsMoved: i.skip ? 0 : 9 } } })
  }
  const shared = { status: vi.fn(async () => ({ ok: true as const, data: OFF })), listBranches: vi.fn(async () => ({ ok: true as const, data: [] })), branchNameFree: vi.fn(async () => ({ ok: true as const, data: { free: true } })) } as unknown as SharedSyncBridge
  ;(window as unknown as { quot3: unknown }).quot3 = { syncShared: shared, cutover: bridge }
  useCutoverStore.setState({ status: null, busy: false, error: '', note: '' })
  useSharedSyncStore.setState({ status: null, branches: [], busy: false, error: '', notice: '', routed: null, nameState: 'idle', nameFor: '', compareNote: '' })
  host = document.createElement('div'); document.body.appendChild(host)
})
afterEach(() => { act(() => { root?.unmount() }); root = undefined; host.remove(); delete (window as unknown as { quot3?: unknown }).quot3; vi.useRealTimers() })

async function mount(): Promise<void> {
  root = createRoot(host)
  await act(async () => { root!.render(createElement(SyncSection)) })
  await flush()
}
const click = async (text: string): Promise<void> => { await act(async () => { button(text)!.click() }); await flush() }

describe('Cutover wizard (Phase 140)', () => {
  it('a computer with the old sync starts on step 1, with the reason for the backup, and goes through all steps with its buttons', async () => {
    await mount()
    expect(host.textContent).toContain('Step 1 of 4')
    expect(host.textContent).toMatch(/no backups/i)
    expect(host.textContent?.toLowerCase()).not.toContain('passphrase')
    await click('Make backup and pause old sync')
    expect(bridge.begin).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Step 2 of 4')
    expect(host.textContent).toContain('manual-1.db')
    expect(host.querySelector('form[aria-label="Sign in to sync"]')).not.toBeNull() // step 2 is the normal sign-in screen
    cur = st('compare'); await act(async () => { await useCutoverStore.getState().load() }); await flush()
    expect(host.textContent).toContain('Step 3 of 4')
    await click('Compare and sync')
    expect(host.textContent).toContain('761 to send, 1166 to fetch')
    expect(host.textContent).toContain('Step 4 of 4')
    await click('Join same-name customers')
    expect(bridge.unify).toHaveBeenCalledWith({ skip: false })
    expect(host.textContent).toContain('Cutover finished')
    expect(host.textContent).toContain('Joined 4 same-name customers')
    await click('Close')
    expect(host.querySelector('form[aria-label="Sign in to sync"]')).not.toBeNull() // back to the normal screen
  })

  it('a failed backup shows its message and stays on step 1', async () => {
    beginFails = true
    await mount()
    await click('Make backup and pause old sync')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('nothing was changed')
    expect(host.textContent).toContain('Step 1 of 4')
  })

  it('the customer step can be skipped', async () => {
    cur = st('unify')
    await mount()
    await click('Skip this step')
    expect(bridge.unify).toHaveBeenCalledWith({ skip: true })
    expect(host.textContent).toContain('Cutover finished')
  })

  it('an interrupted wizard opens on the step main reports (resume)', async () => {
    cur = st('compare')
    await mount()
    expect(host.textContent).toContain('Step 3 of 4')
    expect(button('Compare and sync')).toBeDefined()
  })

  it('a computer that does not need the cutover goes straight to the normal sign-in screen', async () => {
    cur = st('backup', { needed: false })
    await mount()
    expect(host.textContent).not.toContain('Step 1 of 4')
    expect(host.querySelector('form[aria-label="Sign in to sync"]')).not.toBeNull()
  })

  it('without the cutover bridge the normal screen shows (nothing else changes)', async () => {
    ;(window as unknown as { quot3: { cutover?: unknown } }).quot3.cutover = undefined
    await mount()
    expect(host.textContent).not.toContain('Step 1 of 4')
  })
})
