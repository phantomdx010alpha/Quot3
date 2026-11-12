/**
 * Phase 230 (M22) - Settings > AI: the shapes the section reads and the plain-words text it shows (pure; no Electron / Node / DOM).
 * Nothing here touches money, bills or settings. MILESTONE22_DESIGN section 10.
 */
import type { AiStatus } from './aiStatus'

export type AiIndexState = 'off' | 'idle' | 'running' | 'paused' | 'error'

export interface AiIndexProgress { state: AiIndexState; total: number; done: number; pending: number; lastError?: string }

/** What `ai:admin` answers: the service status, the indexer progress and the cache size. Counts and names only, never a bill. */
export interface AiAdminState {
  status: AiStatus
  progress: AiIndexProgress
  /** Vectors stored for the current model. */
  vectors: number
  /** Total size of the installed model files in bytes; undefined when not installed. */
  modelBytes?: number
}

/** What the Delete / Rebuild actions answer. */
export interface AiAdminResult { ok: boolean; removed?: number }

export const AI_PRIVACY_LINE = 'Runs on this PC. Nothing leaves it.'

/** The master switch off, or any state the person should read in plain words. */
export function describeAiStatus(enabled: boolean, s: AiStatus): { label: string; detail: string } {
  if (!enabled) return { label: 'Off', detail: 'AI is switched off. Quot3 behaves exactly as it did without it.' }
  switch (s.state) {
    case 'notInstalled': return { label: 'Not installed', detail: s.reason ?? 'The AI model files are not installed.' }
    case 'loading': return { label: 'Loading', detail: 'The model is starting. This can take a few seconds the first time.' }
    case 'error': return { label: 'Error', detail: s.reason ?? 'The AI stopped. Billing is not affected.' }
    default: return { label: 'Ready', detail: s.loaded ? 'The model is loaded and working.' : 'The model is installed and starts when it is first needed.' }
  }
}

/** "12.3 MB" / "480 KB" for the model size. */
export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return 'unknown size'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

/** One plain line for the indexing progress. */
export function describeIndexProgress(enabled: boolean, p: AiIndexProgress): string {
  if (!enabled || p.state === 'off') return 'Indexing is off.'
  const of = p.total > 0 ? `${Math.min(p.done, p.total)} of ${p.total} item names` : ''
  switch (p.state) {
    case 'running': return of !== '' ? `Indexing: ${of}.` : 'Indexing item names.'
    case 'paused': return of !== '' ? `Paused: ${of}. ${p.pending} left.` : `Paused. ${p.pending} left.`
    case 'error': return `Indexing stopped${p.lastError ? `: ${p.lastError}` : '.'} Use Resume to try again.`
    default: return p.total > 0 ? `Up to date: ${of}.` : 'Up to date. Nothing to index.'
  }
}

/** Pause is offered while work is queued or running; Resume while paused or stopped by an error. */
export function indexButtons(enabled: boolean, p: AiIndexProgress): { pause: boolean; resume: boolean } {
  if (!enabled) return { pause: false, resume: false }
  return { pause: p.state === 'running', resume: p.state === 'paused' || p.state === 'error' }
}

/** The one support line (also added to "Copy diagnostics"): model id, dimension, vector count, last embed time. No names, no bills. */
export function aiDiagnosticsLine(enabled: boolean, a: Pick<AiAdminState, 'status' | 'vectors'>): string {
  const s = a.status
  const ms = s.lastEmbedMs !== undefined ? `${Math.round(s.lastEmbedMs)} ms` : 'none yet'
  return `AI: ${enabled ? 'on' : 'off'}, ${s.state}, model ${s.modelId}, dim ${s.dim}, vectors ${a.vectors}, last embed ${ms}`
}
