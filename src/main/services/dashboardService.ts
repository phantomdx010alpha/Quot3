import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DashboardRepo } from '../db/dashboardRepo'
import type { CustomerService } from './customerService'
import { buildDashboardStats, RECENT_BILLS, statsWindowStart, topCustomers, type DashboardStats } from '../../shared/dashboard/dashboardStats'

export interface DashboardService {
  stats(): DashboardStats
}

export interface DashboardDeps {
  repo: DashboardRepo
  customers: Pick<CustomerService, 'list'>
  /** ISO time of the newest backup, or null. */
  lastBackup: () => string | null
  /** The machine's LOCAL date `YYYY-MM-DD` (injectable for tests). */
  today?: () => string
}

export function localToday(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Newest `*.db` file in the backups folder (ISO mtime), or null when there is none / the folder is missing. */
export function latestBackupTime(dir: string): string | null {
  try {
    let best = -1
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.db')) continue
      const t = statSync(join(dir, f)).mtimeMs
      if (t > best) best = t
    }
    return best < 0 ? null : new Date(best).toISOString()
  } catch {
    return null
  }
}

/** Phase 46 - read-only landing-page numbers; works on a read-only database. */
export function createDashboardService({ repo, customers, lastBackup, today }: DashboardDeps): DashboardService {
  return {
    stats() {
      const t = (today ?? localToday)()
      return {
        ...buildDashboardStats(repo.daysSince(statsWindowStart(t)), t),
        recent: repo.recent(RECENT_BILLS),
        topCustomers: topCustomers(customers.list()),
        lastBackup: lastBackup(),
        syncStatus: 'off'
      }
    }
  }
}
