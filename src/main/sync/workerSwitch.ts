/**
 * Phase 140b - one worker as far as `syncManager` is concerned, backed by the v1 worker until the shared notebook is activated on this
 * computer and by the v2 worker afterwards. Only the active engine runs; `stop` stops both (idempotent), so a switch can never leave a
 * stray worker behind. `onV2Start` / `onV2Stop` carry the doorbell on the pull side.
 */
export interface SwitchableWorker {
  start(): void
  stop(): void
  notifyOnline(): void
  runOnce(): Promise<unknown>
  kick?(): void
}

export type WorkerSwitch<S> = Required<SwitchableWorker> & { status(): S }

export function createWorkerSwitch<S>(o: {
  v1: SwitchableWorker
  v2: SwitchableWorker
  useV2: () => boolean
  status: (v2: boolean) => S
  onV2Start?: () => void
  onV2Stop?: () => void
}): WorkerSwitch<S> {
  const pick = (): SwitchableWorker => (o.useV2() ? o.v2 : o.v1)
  return {
    start() { if (o.useV2()) { o.v2.start(); o.onV2Start?.() } else o.v1.start() },
    stop() { o.v1.stop(); o.v2.stop(); o.onV2Stop?.() },
    notifyOnline() { pick().notifyOnline() },
    runOnce() { return pick().runOnce() },
    kick() { pick().kick?.() },
    status: () => o.status(o.useV2())
  }
}
