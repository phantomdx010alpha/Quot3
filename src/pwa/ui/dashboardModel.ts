import { buildDashboardStats, formatBackupTime, RECENT_BILLS, statsWindowStart, type DayTotal } from '../../shared/dashboard/dashboardStats'
import { fmtMoney } from '../../shared/money'
import type { BackupStatus } from '../data/backup'
import type { BillHead } from '../data/billsRepo'
import type { Meta } from '../data/metaRepo'
import type { EngineStatus } from '../sync/engine'

/** Pure view model behind the phone Dashboard (Phase 180). Totals come from the shared Dashboard stats (decimal.js), never number maths. */
export interface RecentBill {
  id: string
  poNumber: string
  partyName: string
  billDate: string
  /** Display text, e.g. "₹1,250.00"; '' when the cached total is unreadable. */
  total: string
}

export type SyncTone = 'ok' | 'warn' | 'off'
export interface SyncLine {
  tone: SyncTone
  text: string
  /** Second line (what is waiting / kept aside), '' when nothing to add. */
  detail: string
}

export interface DashboardView {
  today: { date: string; count: number; total: string }
  month: { month: string; count: number; total: string }
  recent: RecentBill[]
  billCount: number
  sync: SyncLine
  backup: { text: string; tone: 'ok' | 'warn'; note: string }
}

export const localIsoDate = (d: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const money = (v: string): string => fmtMoney(v, { indian: true, symbol: true })

function showTotal(v: string): string {
  return v === '' ? '' : money(v)
}

/** What the sync line says. `engine` is null when the sync engine is not running in this tab (not linked, or a read-only tab). */
export function describeSync(meta: Pick<Meta, 'org_id' | 'branch_id' | 'branch_name'>, engine: EngineStatus | null, writable: boolean): SyncLine {
  if (!writable) return { tone: 'warn', text: 'Open in another tab', detail: 'Close the other Quot3 tab or window to make changes here.' }
  if (!meta.org_id || !meta.branch_id) return { tone: 'off', text: 'Sync not set up', detail: 'Sign in under Settings to share bills with your other computers.' }
  const branch = meta.branch_name ? `Branch ${meta.branch_name}` : 'Linked'
  if (!engine) return { tone: 'off', text: branch, detail: 'Sync is not running.' }
  const waiting = engine.outbox.pending + engine.outbox.failed
  const tail: string[] = []
  if (waiting > 0) tail.push(`${waiting} waiting to send`)
  if (engine.aside.total > 0) tail.push(`Update the app to see ${engine.aside.bills} bills`)
  if (engine.deferredBills > 0) tail.push(`${engine.deferredBills} older bills not loaded`)
  const detail = tail.join(' · ')
  switch (engine.state) {
    case 'running': {
      const bad = engine.push.consecutiveFailures > 0 || engine.pull.consecutiveFailures > 0
      return bad ? { tone: 'warn', text: `${branch} · sync server unreachable`, detail } : { tone: 'ok', text: `${branch} · synced`, detail }
    }
    case 'first_sync_needed': return { tone: 'warn', text: `${branch} · first sync needed`, detail: 'Open Settings to start it.' }
    case 'read_only': return { tone: 'warn', text: 'Open in another tab', detail: 'Close the other Quot3 tab or window to make changes here.' }
    case 'not_linked': return { tone: 'off', text: 'Sync not set up', detail: 'Sign in under Settings to share bills with your other computers.' }
    default: return { tone: 'off', text: `${branch} · sync stopped`, detail }
  }
}

export function buildDashboardView(input: {
  heads: readonly BillHead[]
  now: Date
  meta: Pick<Meta, 'org_id' | 'branch_id' | 'branch_name' | 'last_export_at'>
  backup: BackupStatus
  engine: EngineStatus | null
  writable: boolean
}): DashboardView {
  const today = localIsoDate(input.now)
  const windowStart = statsWindowStart(today)
  const rows = input.heads
    .filter((h) => h.billDate >= windowStart)
    .map((h) => ({ billDate: h.billDate, grandTotal: h.grandTotal === '' ? null : h.grandTotal }))
  const s = buildDashboardStats(rows, today)
  const fix = (d: DayTotal): DashboardView['today'] => ({ date: d.date, count: d.count, total: money(d.total) })
  const bk = input.backup
  const backupText = formatBackupTime(input.meta.last_export_at, input.now)
  const note =
    bk.state === 'never' ? 'Export a backup in Settings.' : bk.state === 'old' ? `Last backup was ${bk.daysSince ?? 0} days ago. Export a new one in Settings.` : ''
  return {
    today: fix(s.today),
    month: { month: s.month.month, count: s.month.count, total: money(s.month.total) },
    recent: input.heads.slice(0, RECENT_BILLS).map((h) => ({ id: h.id, poNumber: h.poNumber, partyName: h.partyName, billDate: h.billDate, total: showTotal(h.grandTotal) })),
    billCount: input.heads.length,
    sync: describeSync(input.meta, input.engine, input.writable),
    backup: { text: backupText, tone: bk.state === 'ok' ? 'ok' : 'warn', note }
  }
}
