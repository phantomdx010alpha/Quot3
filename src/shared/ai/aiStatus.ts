/** Phase 223 (M22) - shapes shared by the AI service, its IPC and (later) Settings > AI. Pure types and limits. */
export type AiState = 'notInstalled' | 'loading' | 'ready' | 'error'

export interface AiStatus {
  state: AiState
  modelId: string
  dim: number
  /** True once the worker has loaded the model (it loads lazily on the first embed). `ready` with `loaded: false` means installed, not started. */
  loaded: boolean
  /** Plain reason when `state` is `error` (or why nothing is installed). */
  reason?: string
  /** Vectors embedded since the app started. */
  embedded: number
  lastEmbedMs?: number
}

/** Why an embed call returned no vectors. The service never throws into callers. */
export type EmbedFailure = 'off' | 'notInstalled' | 'error' | 'queueFull' | 'cancelled' | 'timeout'
export type EmbedOutcome = { ok: true; vectors: Float32Array[] } | { ok: false; reason: EmbedFailure }

export const EMBED_MAX_TEXTS = 64
export const EMBED_MAX_CHARS = 512
export const EMBED_BATCH = 16
