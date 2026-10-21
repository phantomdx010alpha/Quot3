/** Persistent-storage request and health read (Phase 175). Browser facts only; nothing here is "verified" off a real phone.
 *  Whether Android Chrome grants it (installed app vs browser tab) is a Standing gap. */
export interface StorageEnv {
  readonly storage?: {
    readonly persist?: () => Promise<boolean>
    readonly persisted?: () => Promise<boolean>
    readonly estimate?: () => Promise<{ usage?: number; quota?: number }>
  }
}

export interface StorageHealth {
  /** The browser has `navigator.storage.persist`. */
  readonly persistApiAvailable: boolean
  /** null = unknown (API missing or the call failed). */
  readonly persisted: boolean | null
  readonly usageBytes: number | null
  readonly quotaBytes: number | null
}

async function safe<T>(fn: (() => Promise<T>) | undefined): Promise<T | null> {
  if (!fn) return null
  try {
    return await fn()
  } catch {
    return null
  }
}

/** Asks the browser to keep our data. Never throws. Returns whether storage is persisted afterwards (false when unknown). */
export async function requestPersistence(env: StorageEnv): Promise<boolean> {
  const s = env.storage
  if (!s || typeof s.persist !== 'function') return false
  if ((await safe(s.persisted?.bind(s))) === true) return true
  return (await safe(s.persist.bind(s))) === true
}

export async function readStorageHealth(env: StorageEnv): Promise<StorageHealth> {
  const s = env.storage
  const est = await safe(s?.estimate?.bind(s))
  return {
    persistApiAvailable: typeof s?.persist === 'function',
    persisted: await safe(s?.persisted?.bind(s)),
    usageBytes: typeof est?.usage === 'number' ? est.usage : null,
    quotaBytes: typeof est?.quota === 'number' ? est.quota : null
  }
}

/** "12.3 MB" style text for Settings. */
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return 'unknown'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
