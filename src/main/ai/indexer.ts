import { distinctTextKeys, type TextKey } from '../../shared/ai/textKey'
import type { EmbedKind } from '../../shared/ai/modelConfig'
import type { EmbedOutcome } from '../../shared/ai/aiStatus'
import type { AiVectorRepo, BillNameSource } from '../db/aiVectorRepo'

/**
 * Phase 224 (M22) - the background indexer. Collects the distinct normalised item names, queues the ones with no vector for the
 * current model, and embeds them in small chunks on idle ticks so billing is never slowed. Pausable, resumable (the queue is
 * recomputed from the cache, so a restart just continues), rebuilds when the model id or revision changes, never throws.
 * It only ever writes the cache; it never touches bills, money or settings.
 */
export interface IndexerProgress { state: 'off' | 'idle' | 'running' | 'paused' | 'error'; total: number; done: number; pending: number; lastError?: string }

export interface IndexerDeps {
  repo: AiVectorRepo
  names: BillNameSource
  /** `aiService.embed`: never throws, returns an outcome. */
  embed(texts: string[], kind: EmbedKind, opts?: { group?: string }): Promise<EmbedOutcome>
  /** Cancel queued embed jobs of this group (`aiService.cancel`). */
  cancel?(group: string): unknown
  /** Cache key for the current model: id plus revision, so a new revision rebuilds. */
  modelKey: string
  dim: number
  /** `ai.enabled`. */
  isEnabled(): boolean
  /** Runs `fn` on the next idle moment (production: a short timer; tests: run by hand). Returns a cancel function. */
  schedule(fn: () => void): () => void
  now?: () => Date
  log?(message: string, extra?: Record<string, unknown>): void
  chunk?: number
  /** Failed chunks in a row before the indexer stops until `resume()` / the next scan. */
  maxFailures?: number
}

export interface Indexer {
  /** Full pass: drop other models' rows, find the missing names, start working. Call after enabling AI and at startup. */
  scan(): void
  /** After bills were saved / imported: queue just their names. */
  notifyBills(billIds: readonly string[]): void
  pause(): void
  resume(): void
  /** Delete every cached vector (Settings > AI "delete"); the next scan rebuilds. */
  dropAll(): number
  progress(): IndexerProgress
  onProgress(cb: (p: IndexerProgress) => void): () => void
  stop(): void
}

export const INDEX_GROUP = 'indexer'

export function createIndexer(deps: IndexerDeps): Indexer {
  const chunk = deps.chunk ?? 32
  const maxFailures = deps.maxFailures ?? 3
  const now = deps.now ?? (() => new Date())
  const GROUP = INDEX_GROUP
  let queue: TextKey[] = []
  let total = 0
  let done = 0
  let paused = false
  let failures = 0
  let running = false
  let stopped = false
  let lastError: string | undefined
  let cancelTick: (() => void) | null = null
  const listeners = new Set<(p: IndexerProgress) => void>()
  let warned = false

  const state = (): IndexerProgress['state'] => {
    if (!deps.isEnabled()) return 'off'
    if (lastError && failures >= maxFailures) return 'error'
    if (paused) return 'paused'
    return queue.length > 0 || running ? 'running' : 'idle'
  }
  const progress = (): IndexerProgress => ({ state: state(), total, done, pending: queue.length, ...(lastError ? { lastError } : {}) })
  const emit = (): void => { const p = progress(); for (const cb of listeners) { try { cb(p) } catch { /* a listener never breaks the indexer */ } } }
  const warnOnce = (m: string): void => { if (!warned) { warned = true; deps.log?.(m) } }

  function enqueue(keys: TextKey[]): void {
    if (keys.length === 0) return
    const have = deps.repo.have(deps.modelKey, keys.map((k) => k.hash))
    const queued = new Set(queue.map((k) => k.hash))
    const missing = keys.filter((k) => !have.has(k.hash) && !queued.has(k.hash))
    queue.push(...missing)
    total += missing.length
    // keys that already had a vector need no work and are not counted as progress
  }

  function kick(): void {
    if (stopped || paused || cancelTick || running || queue.length === 0 || !deps.isEnabled()) return
    if (failures >= maxFailures) return
    cancelTick = deps.schedule(() => { cancelTick = null; void tick() })
  }

  async function tick(): Promise<void> {
    if (stopped || paused || running || queue.length === 0 || !deps.isEnabled()) { emit(); return }
    running = true
    const batch = queue.splice(0, chunk)
    emit()
    try {
      const out = await deps.embed(batch.map((k) => k.text), 'passage', { group: GROUP })
      if (stopped) return
      if (out.ok && out.vectors.length === batch.length && out.vectors.every((v) => v.length === deps.dim)) {
        deps.repo.upsertMany(deps.modelKey, batch.map((k, i) => ({ hash: k.hash, vector: out.vectors[i]! })), now().toISOString())
        done += batch.length
        failures = 0
        lastError = undefined
      } else if (!out.ok && (out.reason === 'cancelled' || out.reason === 'off' || out.reason === 'queueFull')) {
        queue.unshift(...batch) // put it back; pause / disable / back-pressure is not a failure
        if (out.reason === 'queueFull') failures = 0
      } else {
        queue.unshift(...batch)
        failures++
        lastError = out.ok ? 'The model returned the wrong number of vectors.' : `Embedding failed (${out.reason}).`
        warnOnce(`indexer: ${lastError}`)
      }
    } catch (err) {
      queue.unshift(...batch)
      failures++
      lastError = err instanceof Error ? err.message : 'indexer error'
      warnOnce(`indexer: ${lastError}`)
    } finally {
      running = false
      emit()
      kick()
    }
  }

  return {
    scan() {
      if (stopped || !deps.isEnabled()) { emit(); return }
      try {
        deps.repo.deleteOtherModels(deps.modelKey) // model id or revision changed: the old vectors are useless
        queue = []
        total = 0
        done = 0
        failures = 0
        lastError = undefined
        enqueue(distinctTextKeys(deps.names.listNames()))
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'scan failed'
        failures = maxFailures
        warnOnce(`indexer: ${lastError}`)
      }
      emit()
      kick()
    },
    notifyBills(billIds) {
      if (stopped || !deps.isEnabled() || billIds.length === 0) return
      try { enqueue(distinctTextKeys(deps.names.listNames(billIds))) } catch (err) { warnOnce(`indexer: ${err instanceof Error ? err.message : 'notify failed'}`) }
      emit()
      kick()
    },
    pause() {
      paused = true
      if (cancelTick) { cancelTick(); cancelTick = null }
      deps.cancel?.(GROUP)
      emit()
    },
    resume() {
      paused = false
      failures = 0
      lastError = undefined
      emit()
      kick()
    },
    dropAll() {
      if (cancelTick) { cancelTick(); cancelTick = null }
      deps.cancel?.(GROUP)
      queue = []
      total = 0
      done = 0
      const n = deps.repo.deleteAll()
      emit()
      return n
    },
    progress,
    onProgress(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    stop() {
      stopped = true
      if (cancelTick) { cancelTick(); cancelTick = null }
      deps.cancel?.(GROUP)
      listeners.clear()
    }
  }
}

/** The cache key for a model: id plus pinned revision (an unpinned build uses `unpinned`). */
export const modelCacheKey = (m: { id: string; revision: string }): string => `${m.id}@${m.revision || 'unpinned'}`
