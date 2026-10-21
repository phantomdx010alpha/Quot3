/** Service-worker registration and the "New version, reload" rule (Phase 174).
 *  Code is never swapped while a bill is unsaved: `canApplyUpdate` is the one gate (Phase 182+ feeds it the real unsaved flag). */
export function canApplyUpdate(state: { readonly hasUnsavedWork: boolean }): boolean {
  return !state.hasUnsavedWork
}

export interface UpdateHandle {
  /** Tells the waiting worker to take over, then the page reloads once it controls.
   *  Phase 186: `canApply` is asked again at the moment of the tap; false = nothing happens and `apply` returns false (an unsaved bill is never lost to a reload). */
  apply(canApply?: () => boolean): boolean
}

/** Phase 186: how often an open app asks the server for a newer service worker, and the pure rule for "is it time". */
export const UPDATE_CHECK_MS = 60 * 60 * 1000
export function shouldCheckForUpdate(lastCheckMs: number | null, nowMs: number, everyMs: number = UPDATE_CHECK_MS): boolean {
  return lastCheckMs === null || nowMs - lastCheckMs >= everyMs
}

/** What the update banner shows. Waiting for a save is stated plainly; Reload is only enabled when it is safe. */
export function updateBannerModel(state: { readonly hasUnsavedWork: boolean }): { text: string; canReload: boolean } {
  return canApplyUpdate(state)
    ? { text: 'New version available.', canReload: true }
    : { text: 'New version available. Save or discard the open bill, then reload.', canReload: false }
}

/** Registers `/sw.js`. Calls `onUpdateReady` when a new version is installed and waiting. Never throws. */
export async function registerServiceWorker(onUpdateReady: (handle: UpdateHandle) => void): Promise<(() => Promise<void>) | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    const announce = (worker: ServiceWorker): void =>
      onUpdateReady({
        apply: (canApply) => {
          if (canApply && !canApply()) return false
          let reloaded = false
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) return
            reloaded = true
            window.location.reload()
          })
          worker.postMessage({ type: 'SKIP_WAITING' })
          return true
        }
      })
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) announce(installing)
      })
    })
    // Returns the "look for a newer version now" action (offline or a server error is simply ignored).
    return async () => { try { await reg.update() } catch { /* offline */ } }
  } catch {
    // Offline shell is a convenience; a failed registration must never break the app.
    return null
  }
}
