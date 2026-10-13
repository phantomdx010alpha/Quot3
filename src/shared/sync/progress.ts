/**
 * Phase 89 - send / receive progress (LEGACY_IMPORT_SPEC section 9, SYNC_POSTBOX_SPEC section 10).
 * `done` / `total` count changes (bills), not bytes. `total` is the number known when the run began, raised when more turn up;
 * `done` never passes `total`. `active: false` is the closing event of a run (the bar disappears).
 */
export type ProgressDirection = 'send' | 'receive'
export interface SyncProgress { direction: ProgressDirection; done: number; total: number; active: boolean }

/** A bar is only worth showing for more than a couple of changes. */
export const PROGRESS_MIN_TOTAL = 3

export function progressLabel(p: Pick<SyncProgress, 'direction' | 'done' | 'total'>): string {
  const d = Math.max(0, Math.min(p.done, p.total))
  return `${p.direction === 'send' ? 'Sending' : 'Receiving'} ${d} of ${p.total}`
}

export function progressPercent(p: Pick<SyncProgress, 'done' | 'total'>): number {
  if (p.total <= 0) return 0
  return Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)))
}

export const isProgress = (v: unknown): v is SyncProgress => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (o.direction === 'send' || o.direction === 'receive') && Number.isFinite(o.done) && Number.isFinite(o.total) && typeof o.active === 'boolean'
}

/** Keeps the numbers of ONE run consistent and emits only when something changed. */
export function createProgressTracker(direction: ProgressDirection, emit: (p: SyncProgress) => void) {
  let done = 0, total = 0, on = false
  const send = (active: boolean): void => { emit({ direction, done: Math.min(done, total), total, active }) }
  return {
    /** `known` = how many changes are waiting when the run starts. Nothing is emitted for an empty run. */
    begin(known: number): void { done = 0; total = Math.max(0, Math.trunc(known)); on = total > 0; if (on) send(true) },
    /** `n` more changes finished; `knownTotal` (optional) corrects the total when more turned up. */
    advance(n: number, knownTotal?: number): void {
      if (n <= 0 && knownTotal === undefined) return
      done += Math.max(0, n)
      if (knownTotal !== undefined) total = Math.max(total, Math.trunc(knownTotal))
      total = Math.max(total, done)
      if (!on && total > 0) on = true
      if (on) send(true)
    },
    end(): void { if (on) { on = false; send(false) } }
  }
}
