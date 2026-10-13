// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdatesSection } from '../UpdatesSection'
import { UpdateBanner } from '../../layout/UpdateBanner'
import { restartToUpdate, useUpdateStore } from '../../../stores/updateStore'
import { useBillStore } from '../../../stores/billStore'
import { useGuardStore } from '../../../stores/guardStore'
import { initialUpdateState, type UpdateState } from '@shared/updater'
import type { VersionList } from '@shared/rollback'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const idle: UpdateState = { ...initialUpdateState('0.1.4'), phase: 'none' }
const list: VersionList = {
  currentVersion: '0.1.4', pinned: '', fetchedAt: '2026-10-13T10:00:00Z',
  entries: [
    { version: '0.2.0', schema: 9, prerelease: false, publishedAt: '2026-10-12T10:00:00Z', current: false, allowed: true, why: '' },
    { version: '0.1.4', schema: 8, prerelease: false, publishedAt: '2026-10-11T10:00:00Z', current: true, allowed: false, why: '' },
    { version: '0.1.2', schema: 8, prerelease: false, publishedAt: '2026-10-09T10:00:00Z', current: false, allowed: true, why: '' }
  ]
}
const ok = <T,>(data: T) => ({ ok: true as const, data })
const api = {
  state: vi.fn(async () => ok(idle)), check: vi.fn(async () => ok(idle)), install: vi.fn(async () => ok({})), setBusy: vi.fn(async () => ok({})),
  setConfig: vi.fn(async () => ok(idle)), listVersions: vi.fn(async () => ok(list)), chooseVersion: vi.fn(async () => ok(idle)),
  installRollback: vi.fn(async () => ok({})), backToLatest: vi.fn(async () => ok(idle))
}
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
const button = (label: string | RegExp, within: ParentNode = document): HTMLButtonElement =>
  [...within.querySelectorAll('button')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''))) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  api.state.mockResolvedValue(ok(idle)); api.listVersions.mockResolvedValue(ok(list))
  ;(window as unknown as { quot3: unknown }).quot3 = { updates: api }
  useUpdateStore.setState({ state: idle, loaded: true, error: '', busy: false, versions: null, versionsLoading: false, versionsError: '' })
  useGuardStore.setState({ open: false, saved: false, busy: false, pending: null })
  useBillStore.setState({ billId: null, dirty: false })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('0.1.5 - Settings > Updates > Choose app version', () => {
  it('opens the list: the installed version and blocked versions cannot be picked, the reason is shown', async () => {
    const blocked: VersionList = { ...list, entries: [...list.entries, { version: '0.1.3', schema: 8, prerelease: false, publishedAt: '', current: false, allowed: false, why: 'Your bills were saved in a newer format than version 0.1.3 understands.' }] }
    api.listVersions.mockResolvedValue(ok(blocked))
    await act(async () => { root.render(createElement(UpdatesSection)) })
    expect(host.querySelector('[data-testid="version-0.1.2"]')).toBeNull() // closed until asked
    await act(async () => { button('Choose app version').click() })
    await flush()
    expect(api.listVersions).toHaveBeenCalledTimes(1)
    expect((host.querySelector('[data-testid="version-0.1.4"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.querySelector('[data-testid="version-0.1.4"]')!.textContent).toContain('Installed now')
    expect((host.querySelector('[data-testid="version-0.1.3"]') as HTMLButtonElement).disabled).toBe(true)
    expect(host.textContent).toContain('newer format than version 0.1.3')
    expect((host.querySelector('[data-testid="version-0.1.2"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('picking a version asks in plain words first; Cancel changes nothing, Continue downloads it', async () => {
    await act(async () => { root.render(createElement(UpdatesSection)) })
    await act(async () => { button('Choose app version').click() })
    await flush()
    await act(async () => { (host.querySelector('[data-testid="version-0.1.2"]') as HTMLButtonElement).click() })
    expect(document.body.textContent).toContain('This replaces 0.1.4 with 0.1.2. Your bills are kept. A backup is made first.')
    await act(async () => { button('Cancel').click() })
    expect(api.chooseVersion).not.toHaveBeenCalled()
    await act(async () => { (host.querySelector('[data-testid="version-0.1.2"]') as HTMLButtonElement).click() })
    await act(async () => { button('Continue').click() })
    expect(api.chooseVersion).toHaveBeenCalledWith('0.1.2')
  })

  it('a refused choice shows its reason and a list failure shows a sentence with Try again', async () => {
    api.chooseVersion.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'Going back would leave Quot3 unable to save bills, so it is blocked.' } } as never)
    await act(async () => { root.render(createElement(UpdatesSection)) })
    await act(async () => { button('Choose app version').click() })
    await flush()
    await act(async () => { (host.querySelector('[data-testid="version-0.2.0"]') as HTMLButtonElement).click() })
    await act(async () => { button('Continue').click() })
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('unable to save bills')

    api.listVersions.mockResolvedValueOnce({ ok: false, error: { code: 'IO_ERROR', message: 'GitHub is limiting requests right now. Try again in about an hour.' } } as never)
    await act(async () => { await useUpdateStore.getState().loadVersions(true) })
    await flush()
    expect(host.textContent).toContain('GitHub is limiting requests')
    await act(async () => { button('Try again').click() })
    expect(api.listVersions).toHaveBeenLastCalledWith(true)
  })

  it('pinned: the state is shown and Back to latest is offered', async () => {
    const pinned = { ...idle, currentVersion: '0.1.2', pinned: '0.1.2', auto: false }
    api.state.mockResolvedValue(ok(pinned)) // the section reloads the state from main when it opens
    useUpdateStore.setState({ state: pinned })
    await act(async () => { root.render(createElement(UpdatesSection)) })
    expect(host.querySelector('[data-testid="pinned-note"]')?.textContent).toContain('stay on version 0.1.2')
    await act(async () => { button('Back to latest').click() })
    expect(api.backToLatest).toHaveBeenCalledTimes(1)
  })

  it('a downloaded older version restarts through installRollback (backup first), never the normal install', async () => {
    const readyBack = { ...idle, phase: 'ready' as const, mode: 'rollback' as const, version: '0.1.2', percent: 100 }
    api.state.mockResolvedValue(ok(readyBack))
    useUpdateStore.setState({ state: readyBack })
    await act(async () => { root.render(createElement(UpdatesSection)) })
    expect(button('Restart to go back to 0.1.2')).toBeTruthy()
    expect(host.textContent).toContain('A backup is made first')
    restartToUpdate()
    await flush()
    expect(api.installRollback).toHaveBeenCalledTimes(1)
    expect(api.install).not.toHaveBeenCalled()
    // an unsaved bill: the guard opens, nothing is installed
    api.installRollback.mockClear()
    useBillStore.setState({ billId: 'b1', dirty: true, poNumber: 'Q3-0001' })
    restartToUpdate()
    await flush()
    expect(useGuardStore.getState().open).toBe(true)
    expect(api.installRollback).not.toHaveBeenCalled()
  })

  it('the banner says "go back" for a chosen older version', async () => {
    useUpdateStore.setState({ state: { ...idle, phase: 'ready', mode: 'rollback', version: '0.1.2', percent: 100 } })
    await act(async () => { root.render(createElement(UpdateBanner)) })
    expect(button('Restart to go back')).toBeTruthy()
  })
})
