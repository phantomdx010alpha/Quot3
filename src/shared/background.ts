/**
 * Phase 161 - background mode rules (pure; no Electron / Node / DOM). MILESTONE15_DESIGN 3.7.
 * Both switches are OFF by default. "Keep running" is what makes hiding, the tray and a hidden start possible: without it the app
 * behaves exactly as before (closing the last window quits). Windows only; the app runs only while someone is signed in.
 */
export const BACKGROUND_KEYS = { startWithWindows: 'background.startWithWindows', keepRunning: 'background.keepRunning' } as const
export const BACKGROUND_DEFAULTS: Readonly<Record<string, unknown>> = { [BACKGROUND_KEYS.startWithWindows]: false, [BACKGROUND_KEYS.keepRunning]: false }
/** Argument the login item starts Quot3 with: the window stays hidden (only honoured while "keep running" is on, else nobody could reach the app). */
export const HIDDEN_ARG = '--hidden'

export interface BackgroundSettings { startWithWindows: boolean; keepRunning: boolean }

/** Tolerant read of the stored values (anything but `true` is off). */
export function readBackgroundSettings(all: Record<string, unknown>): BackgroundSettings {
  return { startWithWindows: all[BACKGROUND_KEYS.startWithWindows] === true, keepRunning: all[BACKGROUND_KEYS.keepRunning] === true }
}

/** Start with no visible window: only for the login-item start AND only while keep-running (the tray is then the way back in). */
export function shouldStartHidden(i: { argv: readonly string[]; keepRunning: boolean; platform: string }): boolean {
  return i.platform === 'win32' && i.keepRunning && i.argv.includes(HIDDEN_ARG)
}

/** `window-all-closed`: stay alive only while keep-running, and never while the app is really quitting (explicit Quit, update install). */
export function windowAllClosedAction(i: { keepRunning: boolean; quitting: boolean }): 'quit' | 'stay' {
  return i.keepRunning && !i.quitting ? 'stay' : 'quit'
}

/**
 * What to do once the unsaved-changes guard has said the window may go (`app:confirmQuit`).
 * explicit Quit / update install -> quit; another window is open -> close just this one; last window + keep-running -> hide it; else quit.
 */
export function confirmCloseAction(i: { keepRunning: boolean; explicitQuit: boolean; windowCount: number }): 'quit' | 'close-window' | 'hide-window' {
  if (i.explicitQuit) return 'quit'
  if (i.windowCount > 1) return 'close-window'
  return i.keepRunning ? 'hide-window' : 'quit'
}

/** A second launch: bring back the hidden window if there is one, otherwise open one more window (Phase 154). */
export function secondInstanceAction(i: { windowCount: number; hiddenCount: number }): 'show-hidden' | 'open-new' | 'open-first' {
  if (i.hiddenCount > 0) return 'show-hidden'
  return i.windowCount === 0 ? 'open-first' : 'open-new'
}

export type TrayItemId = 'open' | 'pause' | 'quit'
export interface TrayMenuModel { tooltip: string; items: Array<{ id: TrayItemId; label: string }> }

/** The tray menu: Open / Pause (or Resume) watching / Quit. The pause entry is left out while the watcher is switched off. */
export function trayMenuModel(i: { watchOn: boolean; paused: boolean }): TrayMenuModel {
  const items: TrayMenuModel['items'] = [{ id: 'open', label: 'Open Quot3' }]
  if (i.watchOn) items.push({ id: 'pause', label: i.paused ? 'Resume watching' : 'Pause watching' })
  items.push({ id: 'quit', label: 'Quit Quot3' })
  return { tooltip: i.watchOn && i.paused ? 'Quot3 (watching paused)' : 'Quot3', items }
}
