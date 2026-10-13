import type { Quot3Bridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Injected by the preload script (contextBridge). The renderer's only door to main. */
    quot3: Quot3Bridge
  }
}

export {}
