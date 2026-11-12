import { EMBED_BATCH } from '../../shared/ai/aiStatus'
import type { FromWorker, ToWorker, WorkerModelInit } from './workerProtocol'

/** Turns prefixed texts into vectors (the real one wraps transformers.js; tests use the fake embedder). */
export type Extractor = (texts: string[]) => Promise<Float32Array[]>

export interface WorkerCoreDeps {
  load(modelRoot: string, model: WorkerModelInit): Promise<Extractor>
  post(m: FromWorker): void
  now?: () => number
}

/** The worker's brain, with no Electron or model import: lazy load, batching, ordered replies. */
export function createWorkerCore(deps: WorkerCoreDeps) {
  const now = deps.now ?? (() => Date.now())
  let extractor: Extractor | null = null
  const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

  async function handle(m: ToWorker): Promise<void> {
    if (m.type === 'init') {
      try {
        extractor = await deps.load(m.modelRoot, m.model)
        deps.post({ type: 'ready' })
      } catch (e) {
        extractor = null
        deps.post({ type: 'error', message: msg(e) })
      }
      return
    }
    if (!extractor) { deps.post({ type: 'error', id: m.id, message: 'model not loaded' }); return }
    const t0 = now()
    try {
      const out: Float32Array[] = []
      for (let i = 0; i < m.texts.length; i += EMBED_BATCH) out.push(...(await extractor(m.texts.slice(i, i + EMBED_BATCH))))
      if (out.length !== m.texts.length) throw new Error(`expected ${m.texts.length} vectors, got ${out.length}`)
      deps.post({ type: 'result', id: m.id, vectors: out, ms: now() - t0 })
    } catch (e) {
      deps.post({ type: 'error', id: m.id, message: msg(e) })
    }
  }
  return { handle }
}
