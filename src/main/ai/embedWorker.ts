/**
 * Phase 223 (M22) - utility-process entry (a separate electron-vite main input, built to out/main/embedWorker.js).
 * The ONLY place the AI package is imported. It runs off the main thread so the grid and the main process never wait for the model.
 * Real model load / speed / memory are never verified from the sandbox (standing gap, MILESTONE22_DESIGN A7).
 */
import { join } from 'node:path'
import { createWorkerCore, type Extractor } from './workerCore'
import type { FromWorker, ToWorker, WorkerModelInit } from './workerProtocol'

async function loadReal(modelRoot: string, model: WorkerModelInit): Promise<Extractor> {
  const tf = await import('@huggingface/transformers')
  // Local files only: the model ships inside the installer; nothing is ever downloaded at runtime.
  tf.env.allowRemoteModels = false
  tf.env.allowLocalModels = true
  tf.env.localModelPath = join(modelRoot, '..')
  const pipe = await tf.pipeline('feature-extraction', model.id, { dtype: model.dtype === 'int8' ? 'q8' : 'fp32' })
  return async (texts) => {
    const t = await pipe(texts, { pooling: model.pooling, normalize: model.normalize })
    const dim = t.dims[t.dims.length - 1] as number
    const data = t.data as Float32Array
    return texts.map((_, i) => data.slice(i * dim, (i + 1) * dim))
  }
}

interface ParentPortLike { on(ev: 'message', cb: (e: { data: ToWorker }) => void): void; postMessage(m: FromWorker): void }

export function startWorker(port: ParentPortLike, load = loadReal): void {
  const core = createWorkerCore({ load, post: (m) => port.postMessage(m) })
  port.on('message', (e) => { void core.handle(e.data) })
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort
if (parentPort) startWorker(parentPort)
