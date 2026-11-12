import { utilityProcess } from 'electron'
import type { WorkerHandle } from './aiService'
import type { FromWorker, ToWorker } from './workerProtocol'

/** Phase 223 (M22) - the real spawner: forks `embedWorker.js` (built beside `index.js`) as an Electron utility process. Electron glue; not unit-tested [A]. */
export function createUtilitySpawner(workerFile: string): () => WorkerHandle {
  return () => {
    const child = utilityProcess.fork(workerFile, [], { serviceName: 'quot3-ai', stdio: 'ignore' })
    return {
      post: (m: ToWorker) => child.postMessage(m),
      onMessage: (cb) => { child.on('message', (m: FromWorker) => cb(m)) },
      onExit: (cb) => { child.on('exit', (code) => cb(code)) },
      kill: () => { child.kill() }
    }
  }
}
