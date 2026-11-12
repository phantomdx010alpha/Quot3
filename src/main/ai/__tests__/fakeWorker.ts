import type { WorkerHandle } from '../aiService'
import { createFakeEmbedder } from '../fakeEmbedder'
import type { FromWorker, ToWorker } from '../workerProtocol'
import { createWorkerCore, type Extractor } from '../workerCore'

export interface FakeControl { loadError?: string; crashOnEmbed?: boolean; hold?: boolean; embedder?: Extractor }

/** In-process stand-in for the utility process: the real worker core with the FAKE embedder. Never a real model, never the network. */
export class FakeWorker implements WorkerHandle {
  received: ToWorker[] = []
  killed = false
  private msgCb: (m: FromWorker) => void = () => {}
  private exitCb: (c: number | null) => void = () => {}
  private release: () => void = () => {}
  private gate: Promise<void>
  private core
  constructor(private ctl: FakeControl) {
    this.gate = ctl.hold ? new Promise<void>((r) => { this.release = r }) : Promise.resolve()
    const embedder = ctl.embedder ?? createFakeEmbedder()
    this.core = createWorkerCore({
      load: async () => { if (ctl.loadError) throw new Error(ctl.loadError); return async (t) => { await this.gate; return embedder(t) } },
      post: (m) => queueMicrotask(() => this.msgCb(m))
    })
  }
  post(m: ToWorker): void {
    this.received.push(m)
    if (m.type === 'embed' && this.ctl.crashOnEmbed) { queueMicrotask(() => this.exitCb(1)); return }
    queueMicrotask(() => void this.core.handle(m))
  }
  onMessage(cb: (m: FromWorker) => void): void { this.msgCb = cb }
  onExit(cb: (c: number | null) => void): void { this.exitCb = cb }
  kill(): void { this.killed = true }
  releaseHold(): void { this.release() }
  embeds(): Extract<ToWorker, { type: 'embed' }>[] { return this.received.filter((m): m is Extract<ToWorker, { type: 'embed' }> => m.type === 'embed') }
}

export function createFakeSpawner(ctl: FakeControl = {}) {
  const workers: FakeWorker[] = []
  return { ctl, workers, spawn: (): WorkerHandle => { const w = new FakeWorker(ctl); workers.push(w); return w } }
}

export const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
