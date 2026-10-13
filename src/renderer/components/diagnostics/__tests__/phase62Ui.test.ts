// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdatesSection } from '../../settings/UpdatesSection'
import { UpdateBanner } from '../../layout/UpdateBanner'
import { useUpdateStore, restartToUpdate } from '../../../stores/updateStore'
import { useBillStore } from '../../../stores/billStore'
import { useGuardStore } from '../../../stores/guardStore'
import { initialUpdateState, type UpdateState } from '@shared/updater'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const ready: UpdateState = { ...initialUpdateState('1.0.0'), phase: 'ready', version: '1.1.0', percent: 100 }
const state = vi.fn(async () => ({ ok: true as const, data: ready }))
const check = vi.fn(async () => ({ ok: true as const, data: ready }))
const install = vi.fn(async () => ({ ok: true as const, data: {} }))
const setBusy = vi.fn(async () => ({ ok: true as const, data: {} }))
const setConfig = vi.fn(async () => ({ ok: true as const, data: ready }))

beforeEach(() => {
  vi.clearAllMocks()
  state.mockResolvedValue({ ok: true as const, data: ready })
  ;(window as unknown as { quot3: unknown }).quot3 = { updates: { state, check, install, setBusy, setConfig } }
  useUpdateStore.setState({ state: ready, loaded: true, error: '', busy: false })
  useGuardStore.setState({ open: false, saved: false, busy: false, pending: null })
  useBillStore.setState({ billId: null, dirty: false })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }

describe('Phase 62 - renderer', () => {
  it('banner shows only when an update is ready; with an unsaved bill it says it will wait', async () => {
    useUpdateStore.setState({ state: { ...ready, phase: 'idle' } })
    await act(async () => { root.render(createElement(UpdateBanner)) })
    expect(host.querySelector('[data-testid="update-banner"]')).toBeNull()
    useUpdateStore.setState({ state: ready })
    useBillStore.setState({ billId: 'b1', dirty: true })
    await flush()
    expect(host.textContent).toContain('open bill is saved')
  })

  it('Restart to update on a clean bill installs; on an unsaved bill the guard opens and nothing is installed', async () => {
    restartToUpdate()
    await flush()
    expect(install).toHaveBeenCalledTimes(1)
    install.mockClear()
    useBillStore.setState({ billId: 'b1', dirty: true, poNumber: 'Q3-0001' })
    restartToUpdate()
    await flush()
    expect(useGuardStore.getState().open).toBe(true)
    expect(install).not.toHaveBeenCalled()
  })

  it('Updates section: Check for updates, channel, address save', async () => {
    const none = { ...ready, phase: 'none' as const }
    state.mockResolvedValue({ ok: true as const, data: none })
    useUpdateStore.setState({ state: none })
    await act(async () => { root.render(createElement(UpdatesSection)) })
    await flush()
    expect(host.textContent).toContain('up to date')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check for updates')!
    await act(async () => { btn.click() })
    expect(check).toHaveBeenCalledTimes(1)
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save address')!
    await act(async () => { save.click() })
    expect(setConfig).toHaveBeenCalledWith({ feedUrl: '' })
  })

  it('a refused address shows its reason', async () => {
    setConfig.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'The update address must start with https://.' } } as never)
    state.mockResolvedValue({ ok: true as const, data: { ...ready, phase: 'none' as const } })
    useUpdateStore.setState({ state: { ...ready, phase: 'none' } })
    await act(async () => { root.render(createElement(UpdatesSection)) })
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save address')!
    await act(async () => { save.click() })
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('https://')
  })
})
