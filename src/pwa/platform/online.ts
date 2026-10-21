/** Phase 186 - online / offline state for the offline note. Browser facts only; the bills never depend on it (IndexedDB is the real store). */
export interface OnlineEnv {
  readonly navigator?: { readonly onLine?: boolean }
  addEventListener?(type: 'online' | 'offline', fn: () => void): void
  removeEventListener?(type: 'online' | 'offline', fn: () => void): void
}

/** Unknown counts as online: a wrong "offline" note is worse than none. */
export function isOnline(env: OnlineEnv): boolean {
  return env.navigator?.onLine !== false
}

/** Calls `cb` with the new state on every change. Returns the stop function. */
export function watchOnline(env: OnlineEnv, cb: (online: boolean) => void): () => void {
  const up = (): void => cb(true)
  const down = (): void => cb(false)
  env.addEventListener?.('online', up)
  env.addEventListener?.('offline', down)
  return () => {
    env.removeEventListener?.('online', up)
    env.removeEventListener?.('offline', down)
  }
}

export const OFFLINE_NOTE = 'Offline. Your bills are on this phone and can still be made and edited. They will sync when you are back online.'
