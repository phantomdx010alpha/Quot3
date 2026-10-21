/** Phone platform flags (Phase 174; contract: API_CONTRACTS.md, Milestone 17 section 1).
 *  Facts about the browser, not user settings. Every flag is false when the feature is missing. Desktop code never imports this. */
export const isPhone = true as const

export interface Capabilities {
  readonly persistentStorage: boolean
  readonly webShareFiles: boolean
  readonly webLocks: boolean
  readonly serviceWorker: boolean
  /** True when the browser can offer "install" (a `beforeinstallprompt` was seen) or the app already runs standalone. */
  readonly installable: boolean
}

/** The slice of the browser this module reads; a plain object in tests. */
export interface CapabilityEnv {
  readonly navigator?: {
    readonly storage?: { readonly persist?: unknown }
    readonly canShare?: unknown
    readonly share?: unknown
    readonly locks?: unknown
    readonly serviceWorker?: unknown
  }
  readonly installPromptSeen?: boolean
  readonly standalone?: boolean
}

/** Web Share with files needs `navigator.share` and `navigator.canShare`; whether a given file can be shared is checked at share time. */
export function detectCapabilities(env: CapabilityEnv): Capabilities {
  const n = env.navigator
  return {
    persistentStorage: typeof n?.storage?.persist === 'function',
    webShareFiles: typeof n?.canShare === 'function' && typeof n?.share === 'function',
    webLocks: n?.locks !== undefined && n.locks !== null,
    serviceWorker: n?.serviceWorker !== undefined && n.serviceWorker !== null,
    installable: env.installPromptSeen === true || env.standalone === true
  }
}

export function readBrowserEnv(installPromptSeen: boolean): CapabilityEnv {
  const standalone =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  return { navigator: typeof navigator === 'undefined' ? undefined : navigator, installPromptSeen, standalone }
}
