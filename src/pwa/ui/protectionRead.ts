/** Phase 292 - reads what `protectionState` needs from the phone (storage health, unsent bills, the two "had data" markers) and the
 *  two-marker "storage cleared" check. Read-only except the marker writes, which never throw and are skipped in a read-only tab. */
import { countRecords, type PhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { checkDataCleared, type ClearedVerdict, type MarkerStore } from '../platform/clearedData'
import { protectionState, type MarkerCount, type ProtectionState } from '../platform/protectionState'
import { readStorageHealth, type StorageEnv, type StorageHealth } from '../platform/storage'
import { listFailed, listPending } from '../sync/outbox'
import { getRaw, setRaw } from '../sync/syncMeta'

/** The second marker lives in the IndexedDB `meta` store (the first is in localStorage). It is set ONLY when bills or customers exist,
 *  so a freshly linked empty phone never trips it; "Reset phone data" clears it. [A] */
export const DB_MARKER_KEY = 'protect.had_data'

export interface DbMarker {
  has(): Promise<boolean>
  set(): Promise<void>
}

export function dbMarker(db: PhoneDb): DbMarker {
  return {
    has: async () => { try { return (await getRaw<unknown>(db, DB_MARKER_KEY, false)) === true } catch { return false } },
    set: async () => { if (!db.canWrite()) return; try { await setRaw(db, DB_MARKER_KEY, true) } catch { /* a full or blocked store must not stop the app */ } }
  }
}

/** Sets the second marker when bills or customers exist. Called at start-up and after a save, never while a screen renders. Never throws. */
export async function noteHadRecords(db: PhoneDb): Promise<void> {
  try {
    if (!db.canWrite()) return
    const [bills, parties] = await Promise.all([countRecords(db, 'bills'), countRecords(db, 'parties')])
    if (bills > 0 || parties > 0) await dbMarker(db).set()
  } catch { /* the marker is a convenience; it must never stop the app */ }
}

export interface ClearedFacts { readonly bills: number; readonly customers: number; readonly linked: boolean }
export interface ClearedCheck { readonly verdict: ClearedVerdict; readonly markers: MarkerCount }

/** The old localStorage rule stays exactly as it was (`checkDataCleared`). The IndexedDB marker adds: bills and customers are both gone while
 *  the marker says there once were some (this also catches a partial loss where the login survived). Either marker is enough.
 *  This check only READS the second marker (a screen opening writes nothing); `noteHadRecords` sets it at start-up and after a save. */
export async function checkDataClearedTwo(facts: ClearedFacts, local: MarkerStore | null, idb: DbMarker | null): Promise<ClearedCheck> {
  const legacy = checkDataCleared(facts, local)
  const hasRecords = facts.bills > 0 || facts.customers > 0
  const dbHas = idb ? await idb.has() : false
  let localHas = false
  try { localHas = local?.get() === '1' } catch { localHas = false }
  const markers: MarkerCount = localHas && dbHas ? 'both' : localHas || dbHas ? 'one' : 'none'
  const lostRecords = !hasRecords && dbHas
  return { verdict: legacy === 'cleared' || lostRecords ? 'cleared' : 'ok', markers }
}

/** The engine slice this needs (the Dashboard's `EngineReader` shape); absent = the sync times are not known. */
export interface EngineTimes {
  status(): Promise<{ push: { lastSuccessAt: string | null }; pull: { lastSuccessAt: string | null } }>
}

export async function unsentBills(db: PhoneDb): Promise<number> {
  const rows = [...(await listPending(db)), ...(await listFailed(db))]
  return new Set(rows.filter((r) => r.kind === 'bill').map((r) => r.recId)).size
}

export interface ReadProtectionOptions {
  env: StorageEnv
  installed: boolean | null
  engine?: EngineTimes | null
  local?: MarkerStore | null
}

export async function readProtection(db: PhoneDb, o: ReadProtectionOptions): Promise<{ state: ProtectionState; health: StorageHealth; linked: boolean }> {
  const health = await readStorageHealth(o.env)
  const [meta, pending] = await Promise.all([getMeta(db), unsentBills(db).catch(() => 0)])
  let pushOkAt: string | null = null
  let pullOkAt: string | null = null
  if (o.engine) {
    try { const s = await o.engine.status(); pushOkAt = s.push.lastSuccessAt; pullOkAt = s.pull.lastSuccessAt } catch { /* the times stay unknown */ }
  }
  const linked = meta.branch_id !== null
  const markerDb = await dbMarker(db).has()
  let markerLocal = false
  try { markerLocal = o.local?.get() === '1' } catch { markerLocal = false }
  return { state: protectionState({ health, installed: o.installed, pending, pushOkAt, pullOkAt, markerLocal, markerDb }), health, linked }
}
