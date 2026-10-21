import { z } from 'zod'
import { PhoneDbError, STORE_NAMES, countRecords, txDone, type PhoneDb, type StoreName } from './db'
import { getAllSettings, SECRET_SETTING_PREFIX, SETTING_DEFAULTS } from './settingsRepo'
import { getMeta, setMetaValue } from './metaRepo'

/** Manual Export backup / Import backup file (Phase 175). The phone's second safety net (sync is the first, Milestone 17 section 3.2).
 *  One JSON file: `{ format, format_version, app_version, exported_at, stores: { <store>: rows[] } }`.
 *  Money stays decimal strings because rows are stored as they are. Session material (`secret.*` settings) is never exported. */
export const BACKUP_FORMAT = 'quot3-phone-backup'
export const BACKUP_FORMAT_VERSION = 1
export const BACKUP_MIME = 'application/json'

const envelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  format_version: z.number().int().min(1),
  app_version: z.string(),
  exported_at: z.string(),
  stores: z.record(z.string(), z.array(z.record(z.string(), z.unknown())))
})

export function backupFileName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `quot3-phone-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`
}

async function readStore(db: PhoneDb, name: StoreName): Promise<Record<string, unknown>[]> {
  const tx = db.idb.transaction(name, 'readonly')
  const store = tx.objectStore(name)
  const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const r = store.getAll()
    r.onsuccess = () => resolve(r.result as Record<string, unknown>[])
    r.onerror = () => reject(r.error)
  })
  return name === 'settings' ? rows.filter((r) => !String(r.key).startsWith(SECRET_SETTING_PREFIX)) : rows
}

export interface ExportOptions {
  readonly now?: () => Date
  readonly appVersion: string
}

export interface BackupFile {
  readonly blob: Blob
  readonly fileName: string
  readonly counts: Record<string, number>
}

/** Builds the backup and, when this tab may write, records `last_export_at`. A read-only tab still gets the file. */
export async function exportBackup(db: PhoneDb, opts: ExportOptions): Promise<BackupFile> {
  const now = (opts.now ?? (() => new Date()))()
  const stores: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}
  for (const name of STORE_NAMES) {
    stores[name] = await readStore(db, name)
    counts[name] = stores[name]!.length
  }
  const json = JSON.stringify({
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    app_version: opts.appVersion,
    exported_at: now.toISOString(),
    stores
  })
  if (db.canWrite()) await setMetaValue(db, 'last_export_at', now.toISOString())
  return { blob: new Blob([json], { type: BACKUP_MIME }), fileName: backupFileName(now), counts }
}

export type ParsedBackup = z.infer<typeof envelope>

/** Reads and checks a backup without touching the database. Throws `PhoneDbError` ('bad-backup' / 'newer-backup'). */
export async function parseBackup(file: Blob | string): Promise<ParsedBackup> {
  let data: unknown
  try {
    data = JSON.parse(typeof file === 'string' ? file : await file.text())
  } catch {
    throw new PhoneDbError('bad-backup', 'This is not a Quot3 phone backup file.')
  }
  const parsed = envelope.safeParse(data)
  if (!parsed.success) throw new PhoneDbError('bad-backup', 'This is not a Quot3 phone backup file.')
  if (parsed.data.format_version > BACKUP_FORMAT_VERSION)
    throw new PhoneDbError('newer-backup', 'This backup was made by a newer version. Update the app first.')
  const known = new Set<string>(STORE_NAMES)
  for (const name of Object.keys(parsed.data.stores))
    if (!known.has(name)) throw new PhoneDbError('bad-backup', `The backup has an unknown part ("${name}").`)
  return parsed.data
}

export interface ImportResult {
  readonly counts: Record<string, number>
  readonly appVersion: string
  readonly exportedAt: string
}

/** Replaces ALL phone data with the backup, in ONE transaction: any bad row aborts the whole import and nothing changes.
 *  Local `secret.*` settings (the signed-in session) are kept, since a backup never carries them. */
export async function importBackup(db: PhoneDb, file: Blob | string, now: () => Date = () => new Date()): Promise<ImportResult> {
  db.assertWritable()
  const backup = await parseBackup(file)
  const keepSecrets = (await getAllSettings(db))
  const secretRows = Object.entries(keepSecrets)
    .filter(([k]) => k.startsWith(SECRET_SETTING_PREFIX))
    .map(([key, value]) => ({ key, value }))

  const tx = db.idb.transaction([...STORE_NAMES], 'readwrite')
  const counts: Record<string, number> = {}
  try {
    for (const name of STORE_NAMES) {
      const store = tx.objectStore(name)
      store.clear()
      const rows = backup.stores[name] ?? []
      for (const row of rows) store.put(row) // a row without its key throws DataError here and aborts the transaction
      counts[name] = rows.length
    }
    for (const row of secretRows) tx.objectStore('settings').put(row)
    tx.objectStore('meta').put({ key: 'last_import_at', value: now().toISOString() })
  } catch (e) {
    try {
      tx.abort()
    } catch {
      /* already finished */
    }
    await txDone(tx).catch(() => undefined)
    throw new PhoneDbError('bad-backup', `The backup has a damaged record (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`)
  }
  await txDone(tx).catch((e: unknown) => {
    throw new PhoneDbError('bad-backup', `The backup could not be restored (${e instanceof Error ? e.message : String(e)}). Nothing was changed.`)
  })
  return { counts, appVersion: backup.app_version, exportedAt: backup.exported_at }
}

// ---- "last export is old" flag ----

export interface BackupStatus {
  /** 'never': the phone holds bills and has never exported. 'old': last export is past the reminder age. */
  readonly state: 'ok' | 'old' | 'never'
  readonly daysSince: number | null
}

export function computeBackupStatus(input: { lastExportAt: string | null; hasData: boolean; now: Date; reminderDays: number }): BackupStatus {
  if (!input.lastExportAt) return { state: input.hasData ? 'never' : 'ok', daysSince: null }
  const t = Date.parse(input.lastExportAt)
  if (Number.isNaN(t)) return { state: input.hasData ? 'never' : 'ok', daysSince: null }
  const days = Math.max(0, Math.floor((input.now.getTime() - t) / 86_400_000))
  return { state: days >= input.reminderDays ? 'old' : 'ok', daysSince: days }
}

export async function getBackupStatus(db: PhoneDb, now: Date = new Date()): Promise<BackupStatus> {
  const meta = await getMeta(db)
  const reminder = (await readReminderDays(db)) ?? SETTING_DEFAULTS['backup.reminderDays']
  const hasData = (await countRecords(db, 'bills')) > 0
  return computeBackupStatus({ lastExportAt: meta.last_export_at, hasData, now, reminderDays: reminder })
}

async function readReminderDays(db: PhoneDb): Promise<number | null> {
  const all = await getAllSettings(db)
  const v = all['backup.reminderDays']
  return typeof v === 'number' && v > 0 ? v : null
}
