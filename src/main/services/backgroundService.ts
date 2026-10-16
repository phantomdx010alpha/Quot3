import { BACKGROUND_KEYS, HIDDEN_ARG, readBackgroundSettings, trayMenuModel, type BackgroundSettings, type TrayItemId, type TrayMenuModel } from '../../shared/background'
import type { LegacyWatchService } from './legacyWatchService'
import type { Logger } from '../logger'

/**
 * Phase 161 - background mode (MILESTONE15_DESIGN 3.7): the Windows login item, the tray icon and the wake rescan.
 * Electron specifics are behind `BackgroundPorts` (real ones in `backgroundElectron.ts`), so this is testable without Electron.
 * The close / quit decisions themselves are the pure functions in `shared/background.ts`, used by `main/index.ts`.
 */
export interface BackgroundPorts {
  /** Register / remove the Windows login item (started with `--hidden`). */
  setOpenAtLogin(open: boolean, args: string[]): void
  /** Create the tray icon or update its menu. `onAction` is called with the chosen entry. */
  showTray(model: TrayMenuModel, onAction: (id: TrayItemId) => void): void
  hideTray(): void
  /** Resume from sleep / unlock screen. Returns the unsubscribe function. */
  onWake(cb: () => void): () => void
}

export interface BackgroundDeps {
  settings: { getAll(): Record<string, unknown> }
  ports: BackgroundPorts
  watch: Pick<LegacyWatchService, 'scan' | 'status' | 'setPaused'>
  /** Bring a window to the front (a hidden one first; open one if none exists). */
  openWindow: () => void
  /** Explicit Quit from the tray (goes through the unsaved-changes guard, then really quits). */
  quit: () => void
  /** False in a dev run (it would register the dev Electron binary as a login item) and on other platforms. */
  loginItemSupported: boolean
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface BackgroundService {
  /** Apply the settings now and hook the wake events. Safe to call again. */
  start(): void
  /** Re-read the settings (call after `background.*` or `legacyWatch.*` changed): login item, tray, tray menu. */
  apply(): void
  stop(): void
  settings(): BackgroundSettings
}

export function createBackgroundService(deps: BackgroundDeps): BackgroundService {
  let loginApplied: boolean | null = null
  let trayShown = false
  let unwake: (() => void) | null = null

  const current = (): BackgroundSettings => readBackgroundSettings(deps.settings.getAll())

  const refreshTray = (): void => {
    const st = deps.watch.status()
    deps.ports.showTray(trayMenuModel({ watchOn: st.enabled && st.folderLabel !== '', paused: st.paused }), (id) => {
      if (id === 'open') deps.openWindow()
      else if (id === 'quit') deps.quit()
      else { deps.watch.setPaused(!deps.watch.status().paused); refreshTray() }
    })
  }

  function apply(): void {
    const s = current()
    try {
      if (deps.loginItemSupported && loginApplied !== s.startWithWindows) {
        deps.ports.setOpenAtLogin(s.startWithWindows, s.startWithWindows ? [HIDDEN_ARG] : [])
        loginApplied = s.startWithWindows
      }
    } catch (err) { deps.log?.warn('Could not change the Windows start-up setting', { err }) }
    try {
      if (s.keepRunning) { refreshTray(); trayShown = true } else if (trayShown) { deps.ports.hideTray(); trayShown = false }
    } catch (err) { deps.log?.warn('Could not update the tray icon', { err }) }
  }

  return {
    start() {
      apply()
      if (!unwake) unwake = deps.ports.onWake(() => { void deps.watch.scan().catch((err: unknown) => deps.log?.warn('Wake rescan failed', { err })) })
    },
    apply,
    stop() { unwake?.(); unwake = null; if (trayShown) { try { deps.ports.hideTray() } catch { /* closing */ } trayShown = false } },
    settings: current
  }
}

export { BACKGROUND_KEYS }
