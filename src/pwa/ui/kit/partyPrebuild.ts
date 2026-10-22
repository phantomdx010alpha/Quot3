/** Phase 191 [A] - build the party directory and its search index at start for the NEW layouts, in an idle moment, so the first autocomplete is not
 *  slow (about 270 ms in the Phase 187 numbers, sandbox). Classic is unchanged: `schedulePartyPrebuild` does nothing for it. */
import { loadPartyDirectory, type PartyDirectory } from '../../data/partySearch'
import type { PhoneDb } from '../../data/db'

export interface IdleEnv { request(cb: () => void): void }

export function browserIdle(): IdleEnv {
  return {
    request: (cb) => {
      const w = globalThis as { requestIdleCallback?: (fn: () => void) => number }
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(cb)
      else setTimeout(cb, 200)
    }
  }
}

const cache = new WeakMap<PhoneDb, Promise<PartyDirectory>>()

/** Loads the directory at the next idle moment and warms the search index once. Cached per database. */
export function prebuildPartyDirectory(db: PhoneDb, idle: IdleEnv = browserIdle()): Promise<PartyDirectory> {
  const have = cache.get(db)
  if (have) return have
  const p = new Promise<PartyDirectory>((resolve, reject) => {
    idle.request(() => {
      loadPartyDirectory(db).then((dir) => {
        try { dir.search('a', 1) } catch { /* the index builds on the first real search instead */ }
        resolve(dir)
      }, reject)
    })
  })
  cache.set(db, p)
  return p
}

/** The directory started by `prebuildPartyDirectory` (so a layout's editor does not load its own), or null when none was scheduled. */
export function takePrebuiltDirectory(db: PhoneDb): Promise<PartyDirectory> | null {
  return cache.get(db) ?? null
}

/** Called once from `bootstrap.ts`: only a layout other than classic pre-builds. Never throws, never blocks start-up. */
export function schedulePartyPrebuild(db: PhoneDb, layout: string, idle?: IdleEnv): void {
  if (layout === 'classic') return
  void prebuildPartyDirectory(db, idle).catch(() => undefined)
}
