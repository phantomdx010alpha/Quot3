import type { PhoneDb } from '../data/db'
import { getMetaValue } from '../data/metaRepo'
import { PhoneSyncError } from './errors'
import { restoreSyncSession, type SessionVault } from './session'
import type { PhoneSharedPort } from './transport'

/**
 * Phase 179 - the `connect()` the push / pull / doorbell / first-sync workers share: puts the stored login back (Phase 178 vault) the first time, then
 * reuses the signed-in port (the transport refreshes its own session; `persistSessionChanges` stores each new pair). A refused login or a phone that is
 * not linked throws `PhoneSyncError('auth_failed')`, which pauses the workers ("sign in again"); a paused / unreachable server throws its own kind and the
 * stored login is kept. The branch id comes from `meta` (written together with the org by `linkPhoneToOrganisation`).
 */
export interface PhoneConnection { port: PhoneSharedPort; creds: { license: string; branchId: string } }

export function createPhoneConnect(db: PhoneDb, vault: SessionVault, port: PhoneSharedPort): { connect: () => Promise<PhoneConnection>; reset: () => void } {
  let ready: PhoneConnection | null = null
  let inflight: Promise<PhoneConnection> | null = null
  async function open(): Promise<PhoneConnection> {
    const branchId = await getMetaValue(db, 'branch_id')
    if (!branchId) throw new PhoneSyncError('auth_failed', 'Set up this phone’s branch first.')
    const r = await restoreSyncSession(vault, port)
    if (r.state === 'none' || r.state === 'signed_out') throw new PhoneSyncError('auth_failed', 'Sign in again to keep syncing.')
    if (r.state === 'unreachable') throw new PhoneSyncError(r.failure.kind, r.failure.message)
    return { port, creds: { license: r.data.license, branchId } }
  }
  return {
    connect() {
      if (ready) return Promise.resolve(ready)
      inflight ??= open().then((c) => { ready = c; return c }).finally(() => { inflight = null })
      return inflight
    },
    reset() { ready = null }
  }
}
