import type { Logger } from '../logger'
import { DOORBELL_DEBOUNCE_MS, deliveryText, doorbellReconnectMs, type DeliveryMode } from '../../shared/sync/pull'
import type { SharedStoreTransport } from './sharedTransport'

/**
 * Phase 138 - the Realtime doorbell (docs/SYNC_SHARED_STORE_SPEC.md section 10). Main process only.
 *
 * The doorbell carries NO data: a ring means "something changed, pull now". Rings that arrive within `DOORBELL_DEBOUNCE_MS` become ONE
 * `kick()` of the pull worker. The 60 s poll is NOT here: it is the pull worker's own timer (`pollMs: SHARED_POLL_MS`) and always runs, so
 * a dropped ring, a dead socket or a paused Realtime costs at most a minute. When the connection drops (or cannot be made) this service
 * says "Checking every minute" and tries again after 2 s, 4 s, 8 s ... (never more than 5 minutes); when it is back it says "Live" and
 * kicks once, because rings may have been missed while it was down. It never throws and never touches the renderer.
 */
export interface DoorbellDeps {
  connect: () => Promise<{ transport: SharedStoreTransport }>
  /** The organisation to listen to, or null while not activated (nothing is subscribed then). */
  orgId: () => string | null
  /** `pull.kick` (the pull worker coalesces and runs soon). */
  kick: () => void
  log: Pick<Logger, 'info' | 'warn'>
  /** Told whenever the delivery mode changes. */
  onMode?: (mode: DeliveryMode) => void
}

export interface DoorbellOptions {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  now?: () => Date
}

export interface DoorbellStatus {
  mode: DeliveryMode
  /** "Live" or "Checking every minute". */
  text: string
  started: boolean
  /** Failed or dropped connections in a row (0 while live). */
  reconnectAttempts: number
  rings: number
  kicks: number
  lastRingAt: string | null
}

export interface Doorbell {
  start(): void
  stop(): void
  status(): DoorbellStatus
}

export function createDoorbell(deps: DoorbellDeps, opts: DoorbellOptions = {}): Doorbell {
  const setTimer = opts.setTimer ?? ((fn, ms) => { const h = setTimeout(fn, ms); h.unref?.(); return h })
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const now = opts.now ?? (() => new Date())
  let started = false
  let mode: DeliveryMode = 'polling'
  let generation = 0
  let off: (() => void) | null = null
  let debounce: unknown = null
  let retry: unknown = null
  let attempts = 0
  let rings = 0, kicks = 0
  let lastRingAt: string | null = null

  const setMode = (m: DeliveryMode): void => {
    if (m === mode) return
    mode = m
    try { deps.onMode?.(m) } catch { /* a listener never breaks the doorbell */ }
  }
  const safeKick = (): void => { kicks++; try { deps.kick() } catch (e) { deps.log.warn('Doorbell: the pull could not be started', { error: e instanceof Error ? e.message : 'unknown' }) } }

  function ring(gen: number): void {
    if (gen !== generation || !started) return
    rings++
    lastRingAt = now().toISOString()
    if (debounce !== null) return // already waiting: this ring joins the pull that is about to start
    debounce = setTimer(() => { debounce = null; if (started) safeKick() }, DOORBELL_DEBOUNCE_MS)
  }

  function scheduleRetry(): void {
    if (!started || retry !== null) return
    const wait = doorbellReconnectMs(attempts)
    attempts++
    retry = setTimer(() => { retry = null; connectNow() }, wait)
  }

  function live(gen: number, isLive: boolean): void {
    if (gen !== generation || !started) return
    if (isLive) {
      if (retry !== null) { clearTimer(retry); retry = null }
      const wasDown = mode !== 'live'
      attempts = 0
      setMode('live')
      if (wasDown) { deps.log.info('Doorbell: live'); safeKick() } // rings may have been missed while it was down
    } else {
      setMode('polling')
      scheduleRetry()
    }
  }

  function dropSubscription(): void {
    generation++ // everything the old subscription says from now on is ignored
    const o = off
    off = null
    try { o?.() } catch { /* already gone */ }
  }

  function connectNow(): void {
    if (!started) return
    dropSubscription()
    const gen = generation
    const org = deps.orgId()
    if (org === null) { setMode('polling'); scheduleRetry(); return }
    deps.connect().then(({ transport }) => {
      if (gen !== generation || !started) return
      off = transport.subscribeDoorbell({ orgId: org }, () => ring(gen), (isLive) => live(gen, isLive))
    }).catch((e: unknown) => {
      if (gen !== generation || !started) return
      deps.log.warn('Doorbell: could not connect, polling instead', { error: e instanceof Error ? e.message : 'unknown' })
      setMode('polling')
      scheduleRetry()
    })
  }

  return {
    start() {
      if (started) return
      started = true
      attempts = 0
      connectNow()
    },
    stop() {
      started = false
      if (debounce !== null) clearTimer(debounce)
      if (retry !== null) clearTimer(retry)
      debounce = retry = null
      dropSubscription()
      setMode('polling')
    },
    status: () => ({ mode, text: deliveryText(mode), started, reconnectAttempts: attempts, rings, kicks, lastRingAt })
  }
}
