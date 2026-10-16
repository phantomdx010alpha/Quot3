import { describe, expect, it, vi } from 'vitest'
import { createBackgroundService, type BackgroundPorts } from '../backgroundService'
import { BACKGROUND_KEYS, HIDDEN_ARG, type TrayItemId, type TrayMenuModel } from '../../../shared/background'
import type { LegacyWatchStatus } from '../../../shared/legacyWatch/watchConfig'
import { emptyCounts } from '../../../shared/legacyWatch/watchConfig'

const st = (o: Partial<LegacyWatchStatus> = {}): LegacyWatchStatus => ({ state: 'watching', enabled: true, paused: false, folderLabel: 'Legacy', intervalSeconds: 120, lastScanAt: null, filesSeen: 0, lastCounts: emptyCounts(), totals: emptyCounts(), waiting: 0, syncOn: false, message: null, ...o })

function mk(initial: Record<string, unknown> = {}, supported = true) {
  const v: Record<string, unknown> = { ...initial }
  let paused = false
  let wake: (() => void) | null = null
  let actions: ((id: TrayItemId) => void) | null = null
  const models: TrayMenuModel[] = []
  const ports: BackgroundPorts = {
    setOpenAtLogin: vi.fn(),
    showTray: vi.fn((m, a) => { models.push(m); actions = a }),
    hideTray: vi.fn(),
    onWake: vi.fn((cb) => { wake = cb; return () => { wake = null } })
  }
  const watch = { scan: vi.fn(async () => st()), status: vi.fn(() => st({ paused })), setPaused: vi.fn((p: boolean) => { paused = p; return st({ paused }) }) }
  const openWindow = vi.fn(); const quit = vi.fn()
  const svc = createBackgroundService({ settings: { getAll: () => ({ ...v }) }, ports, watch, openWindow, quit, loginItemSupported: supported })
  return { svc, v, ports, watch, openWindow, quit, models, act: (id: TrayItemId) => actions?.(id), wake: () => wake?.() }
}

describe('backgroundService', () => {
  it('with the defaults (all OFF) it creates no tray and changes no login item for a fresh install', () => {
    const m = mk()
    m.svc.start()
    expect(m.ports.showTray).not.toHaveBeenCalled()
    expect(m.ports.setOpenAtLogin).toHaveBeenCalledWith(false, []) // makes sure no stale login item stays
    expect(m.svc.settings()).toEqual({ startWithWindows: false, keepRunning: false })
  })

  it('start with Windows registers the login item with --hidden once, and removes it when switched off', () => {
    const m = mk({ [BACKGROUND_KEYS.startWithWindows]: true })
    m.svc.start()
    m.svc.apply()
    expect(m.ports.setOpenAtLogin).toHaveBeenCalledTimes(1)
    expect(m.ports.setOpenAtLogin).toHaveBeenCalledWith(true, [HIDDEN_ARG])
    m.v[BACKGROUND_KEYS.startWithWindows] = false
    m.svc.apply()
    expect(m.ports.setOpenAtLogin).toHaveBeenLastCalledWith(false, [])
  })

  it('does not touch the login item when unsupported (dev run)', () => {
    const m = mk({ [BACKGROUND_KEYS.startWithWindows]: true }, false)
    m.svc.start()
    expect(m.ports.setOpenAtLogin).not.toHaveBeenCalled()
  })

  it('keep-running shows the tray; switching off hides it', () => {
    const m = mk({ [BACKGROUND_KEYS.keepRunning]: true })
    m.svc.start()
    expect(m.ports.showTray).toHaveBeenCalledTimes(1)
    m.v[BACKGROUND_KEYS.keepRunning] = false
    m.svc.apply()
    expect(m.ports.hideTray).toHaveBeenCalledTimes(1)
    m.svc.apply()
    expect(m.ports.hideTray).toHaveBeenCalledTimes(1)
  })

  it('tray Open / Quit call the app; Pause toggles the watcher and rebuilds the menu', () => {
    const m = mk({ [BACKGROUND_KEYS.keepRunning]: true })
    m.svc.start()
    m.act('open'); expect(m.openWindow).toHaveBeenCalled()
    m.act('quit'); expect(m.quit).toHaveBeenCalled()
    m.act('pause')
    expect(m.watch.setPaused).toHaveBeenCalledWith(true)
    expect(m.models.at(-1)!.items[1]!.label).toBe('Resume watching')
    m.act('pause')
    expect(m.watch.setPaused).toHaveBeenLastCalledWith(false)
    expect(m.models.at(-1)!.items[1]!.label).toBe('Pause watching')
  })

  it('wake / unlock triggers a watcher rescan, even without keep-running; stop unhooks it', () => {
    const m = mk()
    m.svc.start()
    m.wake()
    expect(m.watch.scan).toHaveBeenCalledTimes(1)
    m.svc.stop()
    m.wake()
    expect(m.watch.scan).toHaveBeenCalledTimes(1)
  })

  it('a failing port never throws out of apply', () => {
    const m = mk({ [BACKGROUND_KEYS.keepRunning]: true })
    ;(m.ports.showTray as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('no tray') })
    expect(() => m.svc.start()).not.toThrow()
  })
})
