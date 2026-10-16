import { describe, expect, it } from 'vitest'
import { BACKGROUND_DEFAULTS, BACKGROUND_KEYS, confirmCloseAction, HIDDEN_ARG, readBackgroundSettings, secondInstanceAction, shouldStartHidden, trayMenuModel, windowAllClosedAction } from '../background'
import { SETTING_DEFAULTS, SETTING_KEY_RE } from '../settings'

describe('background settings', () => {
  it('both switches are valid setting keys and OFF by default', () => {
    for (const k of Object.values(BACKGROUND_KEYS)) { expect(SETTING_KEY_RE.test(k)).toBe(true); expect(SETTING_DEFAULTS[k]).toBe(false); expect(BACKGROUND_DEFAULTS[k]).toBe(false) }
    expect(readBackgroundSettings(SETTING_DEFAULTS as Record<string, unknown>)).toEqual({ startWithWindows: false, keepRunning: false })
  })
  it('only a real true turns a switch on', () => {
    expect(readBackgroundSettings({ [BACKGROUND_KEYS.keepRunning]: true })).toEqual({ startWithWindows: false, keepRunning: true })
    expect(readBackgroundSettings({ [BACKGROUND_KEYS.startWithWindows]: 'yes', [BACKGROUND_KEYS.keepRunning]: 1 })).toEqual({ startWithWindows: false, keepRunning: false })
  })
})

describe('backgroundPolicy', () => {
  it('starts hidden only on Windows, with --hidden, and while keep-running is on', () => {
    const base = { argv: ['Quot3.exe', HIDDEN_ARG], keepRunning: true, platform: 'win32' }
    expect(shouldStartHidden(base)).toBe(true)
    expect(shouldStartHidden({ ...base, keepRunning: false })).toBe(false)
    expect(shouldStartHidden({ ...base, argv: ['Quot3.exe'] })).toBe(false)
    expect(shouldStartHidden({ ...base, platform: 'linux' })).toBe(false)
  })
  it('window-all-closed: quits as before unless keep-running; explicit quit / update install always quit', () => {
    expect(windowAllClosedAction({ keepRunning: false, quitting: false })).toBe('quit')
    expect(windowAllClosedAction({ keepRunning: true, quitting: false })).toBe('stay')
    expect(windowAllClosedAction({ keepRunning: true, quitting: true })).toBe('quit')
  })
  it('after the unsaved guard: hide the last window only with keep-running; extra windows close; explicit quit quits', () => {
    expect(confirmCloseAction({ keepRunning: false, explicitQuit: false, windowCount: 1 })).toBe('quit')
    expect(confirmCloseAction({ keepRunning: true, explicitQuit: false, windowCount: 1 })).toBe('hide-window')
    expect(confirmCloseAction({ keepRunning: true, explicitQuit: false, windowCount: 2 })).toBe('close-window')
    expect(confirmCloseAction({ keepRunning: false, explicitQuit: false, windowCount: 2 })).toBe('close-window')
    expect(confirmCloseAction({ keepRunning: true, explicitQuit: true, windowCount: 1 })).toBe('quit')
    expect(confirmCloseAction({ keepRunning: true, explicitQuit: true, windowCount: 3 })).toBe('quit')
  })
  it('a second launch shows the hidden window first', () => {
    expect(secondInstanceAction({ windowCount: 1, hiddenCount: 1 })).toBe('show-hidden')
    expect(secondInstanceAction({ windowCount: 1, hiddenCount: 0 })).toBe('open-new')
    expect(secondInstanceAction({ windowCount: 0, hiddenCount: 0 })).toBe('open-first')
  })
  it('tray menu: Open / Pause or Resume (only while watching is on) / Quit', () => {
    expect(trayMenuModel({ watchOn: false, paused: false }).items.map((i) => i.id)).toEqual(['open', 'quit'])
    expect(trayMenuModel({ watchOn: true, paused: false }).items.map((i) => i.label)).toEqual(['Open Quot3', 'Pause watching', 'Quit Quot3'])
    const p = trayMenuModel({ watchOn: true, paused: true })
    expect(p.items[1]).toEqual({ id: 'pause', label: 'Resume watching' })
    expect(p.tooltip).toMatch(/paused/)
  })
})
