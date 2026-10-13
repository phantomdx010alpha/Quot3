// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteChangeBanner } from '../RemoteChangeBanner'
import { useBillStore } from '../../../stores/billStore'
import { keepMine, startRemoteSync, useRemoteChangeStore } from '../../../stores/remoteChangeStore'
import type { HeldChange } from '@shared/sync/pull'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const change = (billId: string): HeldChange => ({ billId, poNumber: 'AAA-0001', fromBranch: 'br-a', fromBranchName: null, revision: 2, updatedAt: '2026-10-10T10:00:00.000Z', deleted: false })
let host: HTMLDivElement
let root: Root
let held: HeldChange[]
const setEditor = vi.fn(async () => ({ ok: true as const, data: { ok: true as const } }))
const resolveHeld = vi.fn(async (i: { billId: string; choice: string }) => { held = held.filter((h) => h.billId !== i.billId); return { ok: true as const, data: { done: true } } })
let listener: ((p: unknown) => void) | null = null

beforeEach(() => {
  held = []
  setEditor.mockClear(); resolveHeld.mockClear(); listener = null
  ;(window as unknown as { quot3: unknown }).quot3 = {
    sync: { setEditor, held: async () => ({ ok: true, data: held }), resolveHeld },
    on: (_c: string, cb: (p: unknown) => void) => { listener = cb; return () => { listener = null } }
  }
  useBillStore.setState({ billId: null })
  useRemoteChangeStore.setState({ held: [] })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('remote change banner (Phase 56)', () => {
  it('shows only for the bill that is open, and Keep mine asks main to drop the other version', async () => {
    await act(async () => { root.render(createElement(RemoteChangeBanner)) })
    expect(host.querySelector('[data-testid=remote-change-banner]')).toBeNull()
    useRemoteChangeStore.setState({ held: [change('other'), change('open-1')] })
    await act(async () => { useBillStore.setState({ billId: 'open-1' }) })
    const banner = host.querySelector('[data-testid=remote-change-banner]')!
    expect(banner.textContent).toContain('Changed on another branch')
    held = [change('open-1')]
    await act(async () => { expect(await keepMine()).toBe(true) })
    expect(resolveHeld).toHaveBeenCalledWith({ billId: 'open-1', choice: 'keep' })
    expect(host.querySelector('[data-testid=remote-change-banner]')).toBeNull()
  })

  it('startRemoteSync reports the open bill to main and reloads the held list on bills:remoteChanged', async () => {
    let stop = (): void => undefined
    await act(async () => { stop = startRemoteSync() })
    expect(setEditor).toHaveBeenLastCalledWith(null)
    await act(async () => { useBillStore.setState({ billId: 'b-9' }) })
    expect(setEditor).toHaveBeenLastCalledWith('b-9')
    held = [change('b-9')]
    await act(async () => { listener?.({ id: 'b-9', held: true }) })
    expect(useRemoteChangeStore.getState().held.map((h) => h.billId)).toEqual(['b-9'])
    stop()
    expect(listener).toBeNull()
  })
})
