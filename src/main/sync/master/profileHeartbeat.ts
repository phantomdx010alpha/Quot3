/**
 * Phase 270 - the company profile refresh (API_CONTRACTS.md M24-P). One heartbeat shortly after start, then one every few hours: the master
 * service's `heartbeat()` downloads the company profile when `profile_version` moved and hands it to the profile port. Scheduled, never
 * awaited by start-up, never throws; does nothing unless the master is configured and this PC is linked. Offline = the last stored default stays.
 */
import type { MasterService } from './masterService'
import { redactSecrets } from '../../../shared/master/redact'

export const PROFILE_FIRST_DELAY_MS = 15_000
export const PROFILE_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface ProfileHeartbeatDeps {
  master: Pick<MasterService, 'status' | 'heartbeat'>
  schedule(fn: () => void, ms: number): () => void
  log: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  firstDelayMs?: number
  intervalMs?: number
}

export function startProfileHeartbeat(deps: ProfileHeartbeatDeps): { cancel(): void; runNow(): Promise<void> } {
  let cancelled = false
  let cancelTimer: (() => void) | null = null

  async function runNow(): Promise<void> {
    if (cancelled) return
    try {
      const st = deps.master.status()
      if (!st.configured || !st.linked) return
      const out = await deps.master.heartbeat()
      if (out.ok) { if (out.profileApplied) deps.log.info('master profile', redactSecrets({ outcome: 'updated' })) }
      else deps.log.warn('master profile', redactSecrets({ outcome: 'failed', code: out.code }))
    } catch {
      try { deps.log.warn('master profile', redactSecrets({ outcome: 'failed', code: 'Q3M99' })) } catch { /* logging never breaks start */ }
    }
  }

  const plan = (ms: number): void => {
    if (cancelled) return
    cancelTimer = deps.schedule(() => { void runNow().finally(() => plan(deps.intervalMs ?? PROFILE_INTERVAL_MS)) }, ms)
  }
  plan(deps.firstDelayMs ?? PROFILE_FIRST_DELAY_MS)
  return { cancel: () => { cancelled = true; cancelTimer?.() }, runNow }
}
