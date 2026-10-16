// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyWatchSection } from '../LegacyWatchSection'
import { useLegacyWatchStore } from '../../../stores/legacyWatchStore'
import { emptyCounts, type LegacyWatchStatus } from '@shared/legacyWatch/watchConfig'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base: LegacyWatchStatus = { state: 'off', enabled: false, paused: false, folderLabel: '', intervalSeconds: 120, lastScanAt: null, filesSeen: 0, lastCounts: emptyCounts(), totals: emptyCounts(), waiting: 0, syncOn: false, message: null }
let store: Record<string, unknown>
let status: LegacyWatchStatus
let host: HTMLElement
let root: Root
let api: { settings: Record<string, ReturnType<typeof vi.fn>>; legacyWatch: Record<string, ReturnType<typeof vi.fn>> }

const flush = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
const show = async (): Promise<void> => { await act(async () => { root.render(createElement(LegacyWatchSection)) }); await flush(); await flush() }
const box = (text: string): HTMLInputElement => [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(text))!.querySelector('input')!
const btn = (text: string): HTMLButtonElement => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const click = async (el: Element): Promise<void> => { await act(async () => { (el as HTMLElement).click() }); await flush() }

beforeEach(() => {
  store = {}
  status = { ...base }
  api = {
    settings: {
      getAll: vi.fn(async () => ({ ok: true, data: { ...store } })),
      set: vi.fn(async (k: string, v: unknown) => { store[k] = v; return { ok: true, data: {} } })
    },
    legacyWatch: {
      status: vi.fn(async () => ({ ok: true, data: status })),
      scanNow: vi.fn(async () => ({ ok: true, data: { ...status, lastScanAt: '2026-10-16T10:00:00.000Z' } })),
      pause: vi.fn(async (p: boolean) => ({ ok: true, data: { ...status, paused: p } })),
      pickFolder: vi.fn(async () => { store['legacyWatch.folder'] = 'D:\\synthetic\\bills'; status = { ...status, folderLabel: 'bills' }; return { ok: true, data: status } })
    }
  }
  ;(window as unknown as { quot3: unknown }).quot3 = api
  useLegacyWatchStore.setState({ loaded: false, status: null, error: '', busy: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); delete (window as unknown as { quot3?: unknown }).quot3 })

describe('Phase 162 - Background and legacy watch section', () => {
  it('starts with everything off and a plain status line', async () => {
    await show()
    expect(box('Start Quot3 when I sign in').checked).toBe(false)
    expect(box('Keep running in the background').checked).toBe(false)
    expect(box('Watch the legacy folder').checked).toBe(false)
    expect(host.querySelector('[data-testid="lw-status"]')!.textContent).toContain('Watching is off.')
    expect(host.querySelector('[data-testid="lw-status"]')!.textContent).toContain('Sync is off.')
    expect(btn('Scan now').disabled).toBe(true)
  })

  it('the toggles save their own keys; the watch switch refreshes the status', async () => {
    await show()
    await click(box('Start Quot3 when I sign in'))
    await click(box('Keep running in the background'))
    await click(box('Watch the legacy folder'))
    expect(api.settings['set']).toHaveBeenCalledWith('background.startWithWindows', true)
    expect(api.settings['set']).toHaveBeenCalledWith('background.keepRunning', true)
    expect(api.settings['set']).toHaveBeenCalledWith('legacyWatch.enabled', true)
    expect(box('Keep running in the background').checked).toBe(true)
    expect(box('Watch the legacy folder').checked).toBe(true)
  })

  it('Choose folder shows only the last segment; a cancel changes nothing; Scan now then works', async () => {
    store['legacyWatch.enabled'] = true
    await show()
    api.legacyWatch['pickFolder']!.mockResolvedValueOnce({ ok: true, data: null })
    await click(btn('Choose folder'))
    expect(host.querySelector('[data-testid="lw-folder"]')!.textContent).toBe('No folder chosen yet.')
    await click(btn('Choose folder'))
    expect(host.querySelector('[data-testid="lw-folder"]')!.textContent).toBe('Folder: bills')
    expect(host.textContent).not.toContain('synthetic')
    await click(btn('Scan now'))
    expect(api.legacyWatch['scanNow']).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-testid="lw-status"]')!.textContent).toContain('Last scan:')
  })

  it('Pause / Resume call the bridge', async () => {
    store['legacyWatch.enabled'] = true
    await show()
    await click(btn('Pause watching'))
    expect(api.legacyWatch['pause']).toHaveBeenCalledWith(true)
  })

  it('the interval saves on leaving the box; a value out of range is refused in plain words and not saved', async () => {
    await show()
    const input = [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Check the folder again'))!.parentElement!.querySelector('input')!
    const setVal = async (v: string): Promise<void> => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
    await setVal('5')
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush()
    expect(api.settings['set']).not.toHaveBeenCalled()
    expect(host.querySelector('[role=alert]')!.textContent).toContain('30 to 3600')
    await setVal('300')
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }); await flush()
    expect(api.settings['set']).toHaveBeenCalledWith('legacyWatch.intervalSeconds', 300)
  })

  it('shows counts, the waiting note and a plain problem message from the service; a refused scan shows its reason', async () => {
    store['legacyWatch.enabled'] = true; store['legacyWatch.folder'] = 'D:\\synthetic\\bills'
    status = { ...base, state: 'folder_missing', enabled: true, folderLabel: 'bills', syncOn: true, waiting: 2, message: 'The legacy folder cannot be reached.', totals: { ...emptyCounts(), imported: 3, updated: 1, duplicate: 2, older: 1, review: 4 } }
    await show()
    const t = host.querySelector('[data-testid="lw-status"]')!.textContent!
    expect(t).toContain('3 imported, 1 updated, 3 skipped, 4 need review')
    expect(t).toContain('2 file(s) are still being written')
    expect(t).toContain('The legacy folder cannot be reached.')
    expect(t).not.toContain('Sync is off')
    api.legacyWatch['scanNow']!.mockResolvedValueOnce({ ok: false, error: { code: 'VALIDATION', message: 'Turn watching on and choose the legacy folder first.' } })
    await click(btn('Scan now'))
    expect([...host.querySelectorAll('[role=alert]')].map((e) => e.textContent)).toContain('Turn watching on and choose the legacy folder first.')
  })
})

describe('Phase 163 - badge count in the section store', () => {
  it('refreshCount stores the waiting number and tolerates a bridge without the channel', async () => {
    api.legacyWatch['reviewCount'] = vi.fn(async () => ({ ok: true, data: { count: 4 } }))
    await act(async () => { await useLegacyWatchStore.getState().refreshCount() })
    expect(useLegacyWatchStore.getState().reviewCount).toBe(4)
    delete api.legacyWatch['reviewCount']
    await act(async () => { await useLegacyWatchStore.getState().refreshCount() })
    expect(useLegacyWatchStore.getState().reviewCount).toBe(4)
  })
})
