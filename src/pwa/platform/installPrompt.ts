/** Phase 186 - the Android "install app" prompt. Chrome fires `beforeinstallprompt` once; we keep the event and offer an Install button
 *  (Settings and one dismissible banner). Whether Chrome offers it on the owner's phone is a Standing gap. */
export interface BeforeInstallPromptLike {
  preventDefault(): void
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

export interface InstallEnv {
  addEventListener(type: string, fn: (e: Event) => void): void
  removeEventListener(type: string, fn: (e: Event) => void): void
  /** Running as an installed app (display-mode standalone). */
  isStandalone(): boolean
}

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable'

export interface InstallController {
  /** An install prompt is waiting and the app is not installed yet. */
  canInstall(): boolean
  installed(): boolean
  prompt(): Promise<InstallResult>
  subscribe(fn: () => void): () => void
  stop(): void
}

export function createInstallController(env: InstallEnv): InstallController {
  let deferred: BeforeInstallPromptLike | null = null
  let installed = env.isStandalone()
  const subs = new Set<() => void>()
  const tell = (): void => subs.forEach((f) => f())
  const onPrompt = (e: Event): void => {
    e.preventDefault()
    if (installed) return
    deferred = e as unknown as BeforeInstallPromptLike
    tell()
  }
  const onInstalled = (): void => { installed = true; deferred = null; tell() }
  env.addEventListener('beforeinstallprompt', onPrompt)
  env.addEventListener('appinstalled', onInstalled)
  return {
    canInstall: () => deferred !== null && !installed,
    installed: () => installed,
    async prompt() {
      const ev = deferred
      if (!ev || installed) return 'unavailable'
      deferred = null // Chrome allows one prompt per event
      try {
        await ev.prompt()
        const c = await ev.userChoice
        if (c.outcome === 'accepted') { installed = true }
        tell()
        return c.outcome
      } catch {
        tell()
        return 'unavailable'
      }
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn) } },
    stop() {
      env.removeEventListener('beforeinstallprompt', onPrompt)
      env.removeEventListener('appinstalled', onInstalled)
      subs.clear()
    }
  }
}

export function browserInstallEnv(): InstallEnv | null {
  if (typeof window === 'undefined') return null
  return {
    addEventListener: (t, f) => window.addEventListener(t, f),
    removeEventListener: (t, f) => window.removeEventListener(t, f),
    isStandalone: () => typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  }
}
