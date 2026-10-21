import { decodeRecord, rawFromAside, READER_VER } from '../../shared/sync/codecV2'
import { txDone, type PhoneDb } from '../data/db'
import { getMetaValue } from '../data/metaRepo'
import { APPLY_STORES, applyRecord, type ApplierDeps } from './applier'
import { listAside } from './aside'
import { putStateTx } from './recordState'

/**
 * Phase 179 - after an app update: every record kept aside is decoded again with this build's reader version. A record that now decodes is applied
 * (`fromAside`: the aside guard does not stop it), its `sync_record_state` is written and its aside row is deleted, ALL IN ONE transaction (a failure
 * rolls the three back together: nothing is half retried). A record that is still too new stays; a damaged envelope or a record that cannot be applied
 * stays and is counted. Never throws for a bad record.
 */
export interface RetryAsideResult { retried: number; applied: number; stillAside: number; damaged: number; failed: number }

export interface RetryAsideDeps {
  db: PhoneDb
  now: () => Date
  newId: () => string
  isOpen?: (billId: string) => boolean
  /** Offset to server time (for an unsent local change to the same record). */
  offsetMs?: number | null
  readerVer?: number
  revisionCap?: number
}

export async function retryAsideRecords(deps: RetryAsideDeps): Promise<RetryAsideResult> {
  const { db } = deps
  const r: RetryAsideResult = { retried: 0, applied: 0, stillAside: 0, damaged: 0, failed: 0 }
  const readerVer = deps.readerVer ?? READER_VER
  const localBranchId = (await getMetaValue(db, 'branch_id')) ?? ''
  const orgId = await getMetaValue(db, 'org_id')
  for (const row of await listAside(db)) {
    const raw = rawFromAside(row)
    if (!raw) { r.damaged++; continue }
    r.retried++
    const dec = decodeRecord(raw, readerVer)
    if (dec.outcome === 'aside') { r.stillAside++; continue }
    if (dec.outcome === 'invalid') { r.damaged++; continue }
    db.assertWritable()
    const tx = db.idb.transaction([...APPLY_STORES], 'readwrite')
    const done = txDone(tx)
    done.catch(() => undefined)
    try {
      const d: ApplierDeps = { localBranchId, orgId, now: deps.now, newId: deps.newId, isOpen: deps.isOpen, revisionCap: deps.revisionCap }
      const out = await applyRecord(tx, dec.record, { fromBranch: null, offsetMs: deps.offsetMs ?? null, fromAside: true }, d)
      if (out === 'held' || out === 'deferred' || out === 'unsupported') { tx.abort(); await done.catch(() => undefined); r.failed++; continue }
      if (out !== 'kept_local') {
        putStateTx(tx, { kind: dec.record.kind, recId: dec.record.recId, baseVersion: dec.record.version, baseHash: dec.record.payloadHash, serverSeq: dec.record.serverSeq, syncedAt: deps.now().toISOString() })
      }
      tx.objectStore('sync_aside').delete([row.kind, row.recId])
      await done
      r.applied++
    } catch {
      try { tx.abort() } catch { /* already finished */ }
      await done.catch(() => undefined)
      r.failed++
    }
  }
  return r
}
