import { deleteRecord, getAllRecords, getRecord, putRecord, type PhoneDb } from './db'

/** Phone `settings` store: `{ key, value }`, value is any structured-cloneable JSON-like data.
 *  Keys starting with `secret.` hold session material (Phase 178) and are NEVER written into a backup file. */
export interface SettingDefaults {
  /** The phone's own company block for professional output (company settings do NOT sync, Phase 173 Q10). Phase 185 builds the entry. */
  'company.profile': { name: string; phone: string; address: string; logoDataUrl: string | null }
  /** Remembered share choice [A]. */
  'share.defaults': { style: 'rough' | 'professional'; kind: 'image' | 'pdf' }
  /** Show the "last export is old" note after this many days. */
  'backup.reminderDays': number
  /** App lock (Phase 187) [A]: off by default. */
  'appLock.enabled': boolean
  'theme.name': 'navy-ember' | 'light'
}

export const SETTING_DEFAULTS: SettingDefaults = {
  'company.profile': { name: '', phone: '', address: '', logoDataUrl: null },
  'share.defaults': { style: 'professional', kind: 'image' },
  'backup.reminderDays': 14,
  'appLock.enabled': false,
  'theme.name': 'navy-ember'
}

export type SettingKey = keyof SettingDefaults

export const SECRET_SETTING_PREFIX = 'secret.'

interface SettingRow {
  key: string
  value: unknown
}

export async function getSetting<K extends SettingKey>(db: PhoneDb, key: K): Promise<SettingDefaults[K]>
export async function getSetting<T>(db: PhoneDb, key: string, fallback: T): Promise<T>
export async function getSetting(db: PhoneDb, key: string, fallback?: unknown): Promise<unknown> {
  const row = await getRecord<SettingRow>(db, 'settings', key)
  if (row) return row.value
  if (fallback !== undefined) return fallback
  return (SETTING_DEFAULTS as unknown as Record<string, unknown>)[key]
}

export async function setSetting<K extends SettingKey>(db: PhoneDb, key: K, value: SettingDefaults[K]): Promise<void>
export async function setSetting(db: PhoneDb, key: string, value: unknown): Promise<void>
export async function setSetting(db: PhoneDb, key: string, value: unknown): Promise<void> {
  await putRecord(db, 'settings', { key, value } satisfies SettingRow)
}

/** Removes the stored value so the default applies again. */
export async function resetSetting(db: PhoneDb, key: string): Promise<void> {
  await deleteRecord(db, 'settings', key)
}

export async function getAllSettings(db: PhoneDb): Promise<Record<string, unknown>> {
  const rows = await getAllRecords<SettingRow>(db, 'settings')
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
