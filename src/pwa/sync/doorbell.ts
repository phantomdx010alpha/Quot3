import { DOORBELL_DEBOUNCE_MS, deliveryText, doorbellReconnectMs, type DeliveryMode } from '../../shared/sync/pull'
import type { PhoneSharedPort } from './transport'

/**
 * Phase 179 - the Realtime doorbell while the page is open (docs/SYNC_SHARED_STORE_SPEC.md section 10; port of the desktop doorbell).
 *
 * The doorbell carries NO data: a ring means "something changed, pull now". Rings within `DOORBELL_DEBOUNCE_MS` become ONE `kick()` of the pull
 * worker. The 60 s poll is NOT here: it is the pull worker's own timer and always runs, so a dropped ring or a dead socket costs at most a minute.
 * When the connection drops (or cannot be made) the mode is "Checking every minute" and a new attempt follows after 2 s, 4 s, 8 s ... (never more than
 * 5 minutes); when it is back the mode is "Live" and one kick follows, because rings may have been missed. A phone browser puts the socket to sleep in
 * the background: nothing here promises background sync. It never throws.
 */
export interface PhoneDoorbellDeps {
  connect: () => Promise<{ port: Pick<PhoneSharedPort, 'subscribeDoorbell'> }>
  /** The organisation to listen to, or null while not signed in (nothing is subscribed then). */
  orgId: () => string | null
  /** The pull worker's `kick`. */
  kick: () => void
  onMode?: (mode: DeliveryMode) => void
}

export interface PhoneDoorbellOptions {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  now?: () => Date
}

export interface DoorbellStatus { mode: DeliveryMode; text: string; started: boolean; reconnectAttempts: number; rings: number; kicks: number; lastRingAt: string | null }
export interface PhoneDoorbell { start(): void; stop(): void; status(): DoorbellStatus }

export function createPhoneDoorbell(deps: PhoneDoorbellDeps, opts: PhoneDoorbellOptions = {}): PhoneDoorbell {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
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

  const setMode = (m: DeliveryMode): void => { if (m === mode) return; mode = m; try { deps.onMode?.(m) } catch { /* a listener never breaks the doorbell */ } }
  const safeKick = (): void => { kicks++; try { deps.kick() } catch { /* the pull worker coalesces; a failure here is never fatal */ } }

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
      if (wasDown) safeKick() // rings may have been missed while it was down
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
    deps.connect().then(({ port }) => {
      if (gen !== generation || !started) return
      off = port.subscribeDoorbell({ orgId: org }, () => ring(gen), (isLive) => live(gen, isLive))
    }).catch(() => {
      if (gen !== generation || !started) return
      setMode('polling')
      scheduleRetry()
    })
  }

  return {
    start() { if (started) return; started = true; attempts = 0; connectNow() },
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
