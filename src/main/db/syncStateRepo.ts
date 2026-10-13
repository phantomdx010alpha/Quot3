import type Database from 'better-sqlite3'

/** Phase 52: the `sync_state` key/value table (the only SQL for it). Secret values arrive here already encrypted. */
export interface SyncStateRepo {
  get(key: string): string | undefined
  set(key: string, value: string): void
  /** Several writes in one transaction (activation stores everything or nothing). */
  setMany(entries: Record<string, string>): void
  remove(keys: readonly string[]): void
  /** Keys starting with `prefix`. */
  keys(prefix: string): string[]
}

export function createSyncStateRepo(sqlite: Database.Database): SyncStateRepo {
  const sel = sqlite.prepare('SELECT value FROM sync_state WHERE key = ?')
  const up = sqlite.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const del = sqlite.prepare('DELETE FROM sync_state WHERE key = ?')
  const like = sqlite.prepare("SELECT key FROM sync_state WHERE substr(key, 1, length(?)) = ?")
  const many = sqlite.transaction((e: Record<string, string>) => { for (const [k, v] of Object.entries(e)) up.run(k, v) })
  const remove = sqlite.transaction((keys: readonly string[]) => { for (const k of keys) del.run(k) })
  return {
    get: (k) => (sel.get(k) as { value: string } | undefined)?.value,
    set: (k, v) => void up.run(k, v),
    setMany: (e) => void many(e),
    remove: (k) => void remove(k),
    keys: (p) => (like.all(p, p) as { key: string }[]).map((r) => r.key)
  }
}
