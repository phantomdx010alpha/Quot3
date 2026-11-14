/**
 * Phase 264 - silent adopt at start (API_CONTRACTS.md M24-J). One background attempt after start-up so a PC that already signs in to its
 * company is recognised by the master without the person doing anything. It never blocks start (scheduled, not awaited), never throws,
 * retries only after a real failure (offline / server), and logs one redacted line.
 */
import type { MasterService } from './masterService'
import { redactSecrets } from '../../../shared/master/redact'

export const ADOPT_FIRST_DELAY_MS = 8_000
export const ADOPT_RETRY_DELAYS_MS: readonly number[] = [60_000, 300_000, 1_800_000]

export interface SilentAdoptDeps {
  master: Pick<MasterService, 'status' | 'adopt'>
  sharedActive(): boolean
  schedule(fn: () => void, ms: number): () => void
  log: { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void }
  firstDelayMs?: number
  retryDelaysMs?: readonly number[]
}

export function startSilentAdopt(deps: SilentAdoptDeps): { cancel(): void } {
  const delays = deps.retryDelaysMs ?? ADOPT_RETRY_DELAYS_MS
  let cancelled = false
  let cancelTimer: (() => void) | null = null

  const plan = (ms: number, n: number): void => {
    if (cancelled) return
    cancelTimer = deps.schedule(() => { void attempt(n) }, ms)
  }

  async function attempt(n: number): Promise<void> {
    if (cancelled) return
    let failed = false
    let code = ''
    try {
      const st = deps.master.status()
      if (!st.configured || st.linked || !deps.sharedActive()) return
      const out = await deps.master.adopt()
      if (out.adopted) { deps.log.info('master adopt', redactSecrets({ outcome: 'adopted' })); return }
      if (out.error) { failed = true; code = out.error.code }
    } catch {
      failed = true
      code = 'Q3M99'
    }
    if (!failed) return
    const next = delays[n]
    try { deps.log.warn('master adopt', redactSecrets({ outcome: 'failed', code, retry: next !== undefined })) } catch { /* logging never breaks start */ }
    if (next !== undefined) plan(next, n + 1)
  }

  plan(deps.firstDelayMs ?? ADOPT_FIRST_DELAY_MS, 0)
  return { cancel: () => { cancelled = true; cancelTimer?.() } }
}
