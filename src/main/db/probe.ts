import Database from 'better-sqlite3'

export type SqliteDb = Database.Database

export interface Probe { ok: boolean; message: string; billCount: number; userVersion: number }

/** Opens a file READ-ONLY and runs integrity_check; never throws. */
export function probeDatabase(file: string): Probe {
  let h: Database.Database | null = null
  try {
    h = new Database(file, { readonly: true, fileMustExist: true })
    const rows = h.pragma('integrity_check') as { integrity_check: string }[]
    const ok = rows.length === 1 && rows[0]!.integrity_check === 'ok'
    if (!ok) return { ok: false, message: rows.slice(0, 3).map((r) => r.integrity_check).join('; '), billCount: -1, userVersion: 0 }
    const userVersion = Number(h.pragma('user_version', { simple: true }))
    let billCount = 0
    try { billCount = (h.prepare('SELECT COUNT(*) AS n FROM bills').get() as { n: number }).n } catch { return { ok: false, message: 'not a Quot3 database', billCount: -1, userVersion } }
    return { ok: true, message: 'ok', billCount, userVersion }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'cannot be opened', billCount: -1, userVersion: 0 }
  } finally {
    try { h?.close() } catch { /* ignore */ }
  }
}
