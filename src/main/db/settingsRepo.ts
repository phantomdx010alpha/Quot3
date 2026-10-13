import type Database from 'better-sqlite3'

/** Raw `settings` table access (db layer). Validation/defaults live in services/settingsService.ts. */
export interface SettingsRepo {
  getRaw(key: string): string | undefined
  setRaw(key: string, valueJson: string, updatedAt: string): void
  allRaw(): { key: string; value: string }[]
}

export function createSettingsRepo(sqlite: Database.Database): SettingsRepo {
  const selOne = sqlite.prepare('SELECT value_json AS v FROM settings WHERE key = ?')
  const selAll = sqlite.prepare('SELECT key, value_json AS value FROM settings')
  const upsert = sqlite.prepare(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  )
  return {
    getRaw: (key) => (selOne.get(key) as { v: string } | undefined)?.v,
    setRaw: (key, valueJson, updatedAt) => void upsert.run(key, valueJson, updatedAt),
    allRaw: () => selAll.all() as { key: string; value: string }[]
  }
}
