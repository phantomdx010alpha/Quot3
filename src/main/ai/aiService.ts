import { withPrefix, type EmbedKind, type ModelConfig } from '../../shared/ai/modelConfig'
import type { AiStatus, EmbedFailure, EmbedOutcome } from '../../shared/ai/aiStatus'
import type { FromWorker, ToWorker } from './workerProtocol'

/** What aiService needs from a spawned worker (the Electron utility process, or an in-process fake in tests). */
export interface WorkerHandle {
  post(m: ToWorker): void
  onMessage(cb: (m: FromWorker) => void): void
  onExit(cb: (code: number | null) => void): void
  kill(): void
}

export interface AiServiceDeps {
  model: ModelConfig
  /** Folder that holds this model's files (resources/ai-models/<id>). */
  modelRoot: string
  /** True when every model file is on disk. */
  modelPresent(): boolean
  spawn(): WorkerHandle
  /** `ai.enabled`. Off means nothing is spawned and every embed returns `off`. */
  isEnabled(): boolean
  log(message: string, extra?: Record<string, unknown>): void
  /** Crashes in a row (reset by a good result) before the service stops trying. */
  maxRestarts?: number
  maxQueue?: number
  jobTimeoutMs?: number
}

export interface AiService {
  status(): AiStatus
  /** Never throws. Texts get the model's prefix here. */
  embed(texts: string[], kind: EmbedKind, opts?: { group?: string }): Promise<EmbedOutcome>
  /** Drop queued jobs (all, or one `group`); a running job is released at once and its late result is ignored. */
  cancel(group?: string): number
  /** Clear a stopped-after-crashes state and try again on the next embed. */
  restart(): void
  shutdown(): void
}

interface Job { texts: string[]; group: string | undefined; resolve(o: EmbedOutcome): void; id: number; cancelled: boolean; timer?: ReturnType<typeof setTimeout> }

export function createAiService(deps: AiServiceDeps): AiService {
  const maxRestarts = deps.maxRestarts ?? 3
  const maxQueue = deps.maxQueue ?? 64
  const jobTimeoutMs = deps.jobTimeoutMs ?? 60_000
  const queue: Job[] = []
  let worker: WorkerHandle | null = null
  let phase: 'stopped' | 'starting' | 'ready' | 'dead' = 'stopped'
  let deadReason = ''
  let crashes = 0
  let current: Job | null = null
  /** The worker still owes us a reply (also true after a cancel until that reply arrives). */
  let busy = false
  let nextId = 1
  let embedded = 0
  let lastMs: number | undefined
  let warned = new Set<string>()

  const warnOnce = (key: string, message: string): void => { if (!warned.has(key)) { warned.add(key); deps.log(message) } }
  const fail = (j: Job, reason: EmbedFailure): void => { if (j.timer) clearTimeout(j.timer); j.resolve({ ok: false, reason }) }
  const failAll = (reason: EmbedFailure): void => { while (queue.length) fail(queue.shift()!, reason) }

  function die(reason: string): void {
    phase = 'dead'
    deadReason = reason
    warnOnce(`dead:${reason}`, `AI stopped: ${reason}`)
    if (current) { fail(current, 'error'); current = null }
    busy = false
    failAll('error')
    const w = worker
    worker = null
    w?.kill()
  }

  function crashed(why: string): void {
    const w = worker
    worker = null
    phase = 'stopped'
    busy = false
    w?.kill()
    if (current) { fail(current, 'error'); current = null }
    crashes++
    warnOnce(`crash:${crashes}`, `AI worker ${why} (${crashes}/${maxRestarts})`)
    if (crashes > maxRestarts) { die(`the AI worker stopped ${crashes} times`); return }
    pump()
  }

  function spawnWorker(): void {
    phase = 'starting'
    const w = deps.spawn()
    worker = w
    w.onMessage((m) => { if (w === worker) onMessage(m) })
    w.onExit((code) => { if (w === worker) crashed(`exited (code ${code})`) })
    w.post({ type: 'init', modelRoot: deps.modelRoot, model: { id: deps.model.id, dtype: deps.model.dtype, pooling: deps.model.pooling, normalize: deps.model.normalize, maxTokens: deps.model.maxTokens } })
  }

  function onMessage(m: FromWorker): void {
    if (m.type === 'ready') { phase = 'ready'; pump(); return }
    if (m.type === 'error' && m.id === undefined) { die(`the model could not be loaded: ${m.message}`); return }
    busy = false
    const j = current
    if (!j || j.id !== (m as { id: number }).id) { pump(); return } // a late reply for a cancelled job
    current = null
    if (j.timer) clearTimeout(j.timer)
    if (m.type === 'result') {
      crashes = 0
      embedded += m.vectors.length
      lastMs = m.ms
      j.resolve({ ok: true, vectors: m.vectors })
    } else {
      warnOnce(`job:${m.message}`, `AI embed failed: ${m.message}`)
      j.resolve({ ok: false, reason: 'error' })
    }
    pump()
  }

  function pump(): void {
    if (current || busy || queue.length === 0) return
    if (!deps.isEnabled()) { failAll('off'); return }
    if (!deps.modelPresent()) { failAll('notInstalled'); return }
    if (phase === 'dead') { failAll('error'); return }
    if (!worker) { spawnWorker(); return }
    if (phase !== 'ready') return
    const j = queue.shift()!
    current = j
    busy = true
    j.timer = setTimeout(() => {
      if (current !== j) return
      j.resolve({ ok: false, reason: 'timeout' })
      current = null
      crashed('timed out')
    }, jobTimeoutMs)
    worker.post({ type: 'embed', id: j.id, texts: j.texts })
  }

  return {
    status() {
      const base = { modelId: deps.model.id, dim: deps.model.dim, embedded, ...(lastMs !== undefined ? { lastEmbedMs: lastMs } : {}) }
      if (!deps.modelPresent()) return { ...base, state: 'notInstalled', loaded: false, reason: 'The AI model files are not installed.' }
      if (phase === 'dead') return { ...base, state: 'error', loaded: false, reason: deadReason }
      if (phase === 'starting') return { ...base, state: 'loading', loaded: false }
      return { ...base, state: 'ready', loaded: phase === 'ready' }
    },
    embed(texts, kind, opts) {
      return new Promise<EmbedOutcome>((resolve) => {
        try {
          if (!deps.isEnabled()) { resolve({ ok: false, reason: 'off' }); return }
          if (queue.length >= maxQueue) { resolve({ ok: false, reason: 'queueFull' }); return }
          queue.push({ texts: texts.map((t) => withPrefix(deps.model, t, kind)), group: opts?.group, resolve, id: nextId++, cancelled: false })
          pump()
        } catch (e) {
          warnOnce(`throw:${String(e)}`, `AI service error: ${e instanceof Error ? e.message : String(e)}`)
          resolve({ ok: false, reason: 'error' })
        }
      })
    },
    cancel(group) {
      let n = 0
      for (let i = queue.length - 1; i >= 0; i--) {
        if (group === undefined || queue[i]!.group === group) { fail(queue.splice(i, 1)[0]!, 'cancelled'); n++ }
      }
      if (current && (group === undefined || current.group === group)) { current.cancelled = true; fail(current, 'cancelled'); current = null; n++ }
      return n
    },
    restart() {
      crashes = 0
      deadReason = ''
      warned = new Set()
      const w = worker
      worker = null
      phase = 'stopped'
      busy = false
      w?.kill()
      pump()
    },
    shutdown() {
      const w = worker
      worker = null
      phase = 'stopped'
      busy = false
      if (current) { fail(current, 'cancelled'); current = null }
      failAll('cancelled')
      w?.kill()
    }
  }
}
