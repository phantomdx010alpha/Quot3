/** Single-writer lock (Phase 175; method from the Phase 173 spike section 8.2: Web Locks, BroadcastChannel fallback).
 *  Only one tab may write. A tab that does not get the lock is read-only (`held` false). The lock is released when the tab closes. */
export const WRITER_LOCK_NAME = 'quot3-phone-writer'

export interface WriterLock {
  /** True while this tab may write. Read at every write, so it can change. */
  readonly held: boolean
  readonly method: 'web-locks' | 'broadcast' | 'none'
  release(): void
}

export interface LockManagerLike {
  request(name: string, options: { ifAvailable: boolean }, cb: (lock: object | null) => Promise<void> | void): Promise<unknown>
}
export interface ChannelLike {
  postMessage(msg: unknown): void
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void
  close(): void
}
export interface WriterEnv {
  readonly locks?: LockManagerLike
  readonly createChannel?: (name: string) => ChannelLike
  /** How long the fallback waits for another tab to answer (ms). */
  readonly fallbackWaitMs?: number
}

export async function acquireWriterLock(env: WriterEnv): Promise<WriterLock> {
  if (env.locks) return acquireWithWebLocks(env.locks)
  if (env.createChannel) return acquireWithChannel(env.createChannel, env.fallbackWaitMs ?? 150)
  // No coordination primitive: the app is usable, but two tabs could write. The UI shows nothing; Standing gap for old browsers.
  return { held: true, method: 'none', release: () => {} }
}

function acquireWithWebLocks(locks: LockManagerLike): Promise<WriterLock> {
  return new Promise((resolve) => {
    let releaseFn: () => void = () => {}
    const state = { held: false }
    const lock: WriterLock = {
      get held() {
        return state.held
      },
      method: 'web-locks',
      release: () => {
        state.held = false
        releaseFn()
      }
    }
    void locks.request(WRITER_LOCK_NAME, { ifAvailable: true }, (granted) => {
      if (!granted) {
        resolve(lock)
        return
      }
      state.held = true
      resolve(lock)
      // Hold the lock until release() (or until the tab closes).
      return new Promise<void>((done) => {
        releaseFn = done
      })
    })
  })
}

function acquireWithChannel(create: (name: string) => ChannelLike, waitMs: number): Promise<WriterLock> {
  const ch = create(WRITER_LOCK_NAME)
  const state = { held: true }
  let answered = false
  ch.addEventListener('message', (ev) => {
    const m = ev.data
    if (m === 'who-writes' && state.held) ch.postMessage('i-write')
    else if (m === 'i-write') answered = true
  })
  ch.postMessage('who-writes')
  return new Promise((resolve) => {
    setTimeout(() => {
      if (answered) state.held = false
      resolve({
        get held() {
          return state.held
        },
        method: 'broadcast',
        release: () => {
          state.held = false
          ch.close()
        }
      })
    }, waitMs)
  })
}

/** The browser's real primitives, for the app (tests pass fakes instead). */
export function browserWriterEnv(): WriterEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const locks = (nav as unknown as { locks?: LockManagerLike } | undefined)?.locks
  if (locks) return { locks }
  if (typeof BroadcastChannel !== 'undefined') return { createChannel: (n) => new BroadcastChannel(n) as unknown as ChannelLike }
  return {}
}
