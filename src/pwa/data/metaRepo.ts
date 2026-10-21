import { getAllRecords, getRecord, putRecord, type PhoneDb } from './db'

/** Phone `meta` store: one row per key, `{ key, value }`. Counters are plain integers (never money). */
export interface Meta {
  /** Schema of the phone data (the IndexedDB version it was created at). */
  schema_version: number
  /** The phone's own branch (Phase 178 sets these; null until then). [A] unconfirmed: phone = own seat + branch. */
  branch_id: string | null
  branch_name: string | null
  /** The organisation id (from the sync login, Phase 178). Customer ids are derived from it (Phase 177); null = not signed in yet. */
  org_id: string | null
  po_prefix: string | null
  /** Last PO sequence number issued by this phone (Phase 176 increments it in the bill's own transaction). */
  po_counter: number
  /** Sync cursor (`server_seq`), Phase 179. */
  server_seq: number | null
  /** Server time minus phone time, milliseconds, Phase 179. */
  clock_offset_ms: number
  last_export_at: string | null
  last_import_at: string | null
  created_at: string | null
}

export type MetaKey = keyof Meta

export const META_DEFAULTS: Meta = {
  schema_version: 1,
  branch_id: null,
  branch_name: null,
  org_id: null,
  po_prefix: null,
  po_counter: 0,
  server_seq: null,
  clock_offset_ms: 0,
  last_export_at: null,
  last_import_at: null,
  created_at: null
}

interface MetaRow {
  key: string
  value: unknown
}

export async function getMetaValue<K extends MetaKey>(db: PhoneDb, key: K): Promise<Meta[K]> {
  const row = await getRecord<MetaRow>(db, 'meta', key)
  return row ? (row.value as Meta[K]) : META_DEFAULTS[key]
}

export async function setMetaValue<K extends MetaKey>(db: PhoneDb, key: K, value: Meta[K]): Promise<void> {
  await putRecord(db, 'meta', { key, value } satisfies MetaRow)
}

/** All meta values, with defaults for keys never written. Unknown stored keys are ignored. */
export async function getMeta(db: PhoneDb): Promise<Meta> {
  const rows = await getAllRecords<MetaRow>(db, 'meta')
  const out: Record<string, unknown> = { ...META_DEFAULTS }
  for (const r of rows) if (r.key in META_DEFAULTS) out[r.key] = r.value
  return out as unknown as Meta
}

/** Writes `created_at` once, the first time the app opens a fresh database. Safe to call on every start. */
export async function ensureMeta(db: PhoneDb, now: Date): Promise<Meta> {
  const existing = await getRecord<MetaRow>(db, 'meta', 'created_at')
  if (!existing && db.canWrite()) {
    await setMetaValue(db, 'created_at', now.toISOString())
    await setMetaValue(db, 'schema_version', META_DEFAULTS.schema_version)
  }
  return getMeta(db)
}
