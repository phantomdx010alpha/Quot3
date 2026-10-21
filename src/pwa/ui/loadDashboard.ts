import { getBackupStatus } from '../data/backup'
import { listBillHeads } from '../data/billsRepo'
import type { PhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import type { EngineStatus } from '../sync/engine'
import { buildDashboardView, type DashboardView } from './dashboardModel'

/** The slice of the sync engine the Dashboard reads. Null / absent: the engine is not running in this tab. */
export interface EngineReader {
  status(): Promise<EngineStatus>
}

/** Reads the phone database and builds the Dashboard view. Read-only: it never writes, so it is safe in a read-only tab. */
export async function loadDashboard(db: PhoneDb, now: Date, engine: EngineReader | null = null): Promise<DashboardView> {
  const [heads, meta, backup] = await Promise.all([listBillHeads(db), getMeta(db), getBackupStatus(db, now)])
  let status: EngineStatus | null = null
  if (engine) {
    try { status = await engine.status() } catch { status = null }
  }
  return buildDashboardView({ heads, now, meta, backup, engine: status, writable: db.canWrite() })
}
