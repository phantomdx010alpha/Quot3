import { SHARED_MESSAGES, classifySharedFailure, sharedLinkStateFor, type LinkState, type SharedErrorKind } from '../../shared/sync/license'
import type { SyncFailure } from './transport'

/** Phase 178 - a sync failure the UI can show. `kind` comes from the transport's own error; anything else is classified as a plain server problem. */
export class PhoneSyncError extends Error {
  readonly kind: SharedErrorKind
  constructor(kind: SharedErrorKind, message?: string) {
    super(message ?? SHARED_MESSAGES[kind])
    this.name = 'PhoneSyncError'
    this.kind = kind
  }
}

const isKind = (v: unknown): v is SharedErrorKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SHARED_MESSAGES, v)

/**
 * Turns anything thrown by a transport into a kind + plain-words message. A paused project stays "paused / not answering", never "no internet"
 * (spec section 12). The server's own error text is never copied (it could echo input).
 */
export function toSyncFailure(e: unknown): SyncFailure {
  if (e instanceof PhoneSyncError) return { kind: e.kind, message: e.message }
  const kind = (e as { kind?: unknown } | null)?.kind
  if (isKind(kind)) return { kind, message: SHARED_MESSAGES[kind] }
  if (e instanceof TypeError) return { kind: 'offline', message: SHARED_MESSAGES.offline } // fetch() rejects with TypeError when the network is down
  const f = e as { status?: unknown; code?: unknown } | null
  const k = classifySharedFailure({ status: typeof f?.status === 'number' ? f.status : undefined, code: typeof f?.code === 'string' ? f.code : undefined })
  return { kind: k, message: SHARED_MESSAGES[k] }
}

/** True for the kinds that mean "try again later", where a stored session must be kept. */
export const isTransientKind = (k: SharedErrorKind): boolean => k === 'offline' || k === 'timeout' || k === 'server' || k === 'server_paused'

export const linkStateOf = (k: SharedErrorKind): LinkState => sharedLinkStateFor(k)
