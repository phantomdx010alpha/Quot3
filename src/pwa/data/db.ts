/** Phone database (Phase 175). One IndexedDB database, `quot3-phone`, versioned by IndexedDB's own upgrade step.
 *  Not counted in the desktop `schema: N` line. Store list: docs/DATA_MODEL.md (Milestone 17 phone store).
 *  No helper library: this file is the whole promise wrapper. Pure browser APIs only (no Node, no Electron). */
export const DB_NAME = 'quot3-phone'
/** Bump only by adding a new upgrade step in `UPGRADES`; never edit a step that has shipped. */
export const DB_VERSION = 1

export interface IndexDef {
  readonly name: string
  readonly keyPath: string | readonly string[]
  readonly unique?: boolean
}
export interface StoreDef {
  readonly keyPath: string | readonly string[]
  readonly indexes: readonly IndexDef[]
}

/** Stores created by upgrade step 1. */
export const STORE_DEFS = {
  meta: { keyPath: 'key', indexes: [] },
  settings: { keyPath: 'key', indexes: [] },
  bills: {
    keyPath: 'id',
    indexes: [
      { name: 'bill_date', keyPath: 'bill_date' },
      { name: 'party_id', keyPath: 'party_id' },
      { name: 'po_number', keyPath: 'po_number' },
      { name: 'deleted_at', keyPath: 'deleted_at' }
    ]
  },
  bill_rows: { keyPath: 'id', indexes: [{ name: 'bill_id_idx', keyPath: ['bill_id', 'idx'] }] },
  bill_revisions: { keyPath: ['bill_id', 'revision'], indexes: [] },
  parties: {
    keyPath: 'id',
    indexes: [
      { name: 'name_norm', keyPath: 'name_norm' },
      { name: 'phone', keyPath: 'phone' }
    ]
  },
  drafts: { keyPath: 'id', indexes: [] },
  sync_record_state: { keyPath: ['kind', 'rec_id'], indexes: [] },
  sync_outbox: { keyPath: 'id', indexes: [] },
  sync_aside: { keyPath: ['kind', 'rec_id'], indexes: [] }
} as const satisfies Record<string, StoreDef>

export type StoreName = keyof typeof STORE_DEFS
export const STORE_NAMES = Object.keys(STORE_DEFS) as StoreName[]

export type PhoneDbErrorCode =
  | 'newer-version' // the stored database is newer than this app: show "Update the app"
  | 'blocked' // another tab holds an older version open and will not let go
  | 'unavailable' // no IndexedDB, or the browser refused to open it
  | 'read-only' // this tab does not hold the single-writer lock
  | 'bad-backup' // a backup file that is not a Quot3 phone backup / is corrupt
  | 'newer-backup' // a backup written by a newer app

export class PhoneDbError extends Error {
  readonly code: PhoneDbErrorCode
  constructor(code: PhoneDbErrorCode, message: string) {
    super(message)
    this.name = 'PhoneDbError'
    this.code = code
  }
}

/** The part of the single-writer lock the data layer needs (see platform/writerLock.ts). */
export interface WriterState {
  readonly held: boolean
}

export interface PhoneDb {
  readonly idb: IDBDatabase
  /** False when another tab holds the writer lock. Reads always work. */
  canWrite(): boolean
  /** Throws `PhoneDbError('read-only')` when this tab may not write. Every repo write calls it first. */
  assertWritable(): void
  close(): void
}

/** Upgrade steps by target version. A step may only ADD stores / indexes; data steps run inside the upgrade transaction. */
const UPGRADES: Record<number, (db: IDBDatabase, tx: IDBTransaction) => void> = {
  1: (db) => {
    for (const name of STORE_NAMES) {
      const def: StoreDef = STORE_DEFS[name]
      const store = db.createObjectStore(name, { keyPath: def.keyPath as string | string[] })
      for (const ix of def.indexes) store.createIndex(ix.name, ix.keyPath as string | string[], { unique: ix.unique ?? false })
    }
  }
}

export function runUpgrades(db: IDBDatabase, tx: IDBTransaction, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion + 1; v <= newVersion; v++) UPGRADES[v]?.(db, tx)
}

export interface OpenOptions {
  /** Defaults to the global `indexedDB`; tests pass a fake factory. */
  readonly factory?: IDBFactory
  readonly name?: string
  /** Defaults to "always writable". The app passes the writer lock state. */
  readonly writer?: WriterState
}

export function openPhoneDb(opts: OpenOptions = {}): Promise<PhoneDb> {
  const factory = opts.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB)
  if (!factory) return Promise.reject(new PhoneDbError('unavailable', 'This browser has no IndexedDB.'))
  return new Promise<PhoneDb>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = factory.open(opts.name ?? DB_NAME, DB_VERSION)
    } catch (e) {
      reject(new PhoneDbError('unavailable', `Could not open the phone database: ${String(e)}`))
      return
    }
    req.onupgradeneeded = (ev) => {
      const tx = req.transaction
      if (tx) runUpgrades(req.result, tx, ev.oldVersion, DB_VERSION)
    }
    req.onblocked = () => reject(new PhoneDbError('blocked', 'Close the other Quot3 tab or window, then try again.'))
    req.onerror = () => {
      const err = req.error
      if (err?.name === 'VersionError') reject(new PhoneDbError('newer-version', 'Update the app: this data was saved by a newer version.'))
      else reject(new PhoneDbError('unavailable', `Could not open the phone database: ${err?.message ?? 'unknown error'}`))
    }
    req.onsuccess = () => {
      const idb = req.result
      // Another tab upgrading must never be stalled by this connection.
      idb.onversionchange = () => idb.close()
      const writer = opts.writer
      const db: PhoneDb = {
        idb,
        canWrite: () => writer?.held ?? true,
        assertWritable: () => {
          if (!db.canWrite()) throw new PhoneDbError('read-only', 'Quot3 is open in another tab. Close it to make changes here.')
        },
        close: () => idb.close()
      }
      resolve(db)
    }
  })
}

// ---- tiny promise helpers shared by the repos ----

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function getRecord<T>(db: PhoneDb, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const tx = db.idb.transaction(store, 'readonly')
  return (await reqToPromise(tx.objectStore(store).get(key))) as T | undefined
}

export async function getAllRecords<T>(db: PhoneDb, store: StoreName): Promise<T[]> {
  const tx = db.idb.transaction(store, 'readonly')
  return (await reqToPromise(tx.objectStore(store).getAll())) as T[]
}

export async function putRecord(db: PhoneDb, store: StoreName, value: unknown): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  await txDone(tx)
}

export async function deleteRecord(db: PhoneDb, store: StoreName, key: IDBValidKey): Promise<void> {
  db.assertWritable()
  const tx = db.idb.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await txDone(tx)
}

export async function countRecords(db: PhoneDb, store: StoreName): Promise<number> {
  const tx = db.idb.transaction(store, 'readonly')
  return reqToPromise(tx.objectStore(store).count())
}
