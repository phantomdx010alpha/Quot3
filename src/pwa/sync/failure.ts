import { SHARED_MESSAGES } from '../../shared/sync/license'
import { classifySharedWorkerFailure, sharedBlockFor, type SharedBlock } from '../../shared/sync/push'
import { toSyncFailure } from './errors'

/** Phase 179 - what a failure means to a worker: pause (connection / paused server / refused login / refused license) or blame a row. */
export class Pause extends Error {
  constructor(readonly block: SharedBlock, msg: string) {
    super(msg)
    this.name = 'Pause'
  }
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : 'Unknown error')

/** True for an error that came from the network / transport layer (as opposed to a bug in our own code). */
function isTransportError(e: unknown): boolean {
  if (e instanceof TypeError) return true // fetch() rejects with TypeError when the network is down
  const o = e as { kind?: unknown; status?: unknown; code?: unknown } | null
  if (typeof o?.kind === 'string' && Object.prototype.hasOwnProperty.call(SHARED_MESSAGES, o.kind)) return true
  return typeof o?.status === 'number' || typeof o?.code === 'string'
}

/**
 * `'row'` = the server refused the request itself (too large / invalid): the caller isolates the culprit row. A `Pause` = stop for now, nothing counts
 * against a row. `null` = not a transport problem at all (a bug or damaged data in our own code): the caller decides.
 */
export function classifyFailure(e: unknown): 'row' | Pause | null {
  if (e instanceof Pause) return e
  if (!isTransportError(e)) return null
  const f = toSyncFailure(e)
  const c = classifySharedWorkerFailure(f.kind)
  return c === 'row' ? 'row' : new Pause(sharedBlockFor(c), f.message)
}
