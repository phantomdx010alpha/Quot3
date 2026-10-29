import { useEffect, useState } from 'react'
import type { DbInfo } from '@shared/ipc'
import { formatHistoryDate, formatHistoryTotal } from '@shared/history/historyList'
import { formatBackupTime } from '@shared/dashboard/dashboardStats'
import { ROUTES } from '@shared/routes'
import { NAV_ITEMS } from '../components/layout/navItems'
import { Icon, Kbd } from '../components/ui'
import { DraftRecovery } from '../components/create/DraftRecovery'
import { CrashNotice } from '../components/diagnostics/CrashNotice'
import { DashList } from '../components/dashboard/DashList'
import { Sparkline } from '../components/dashboard/Sparkline'
import { StatTile } from '../components/dashboard/StatTile'
import { TodayTiles } from '../components/dashboard/TodayTiles'
import { primaryKeys } from '@shared/shortcuts'
import { useRouter } from '../router/routerStore'
import { useDashboardStore } from '../stores/dashboardStore'
import { useSyncStatusStore } from '../stores/syncStatusStore'
import { SyncDot, useProgressChip } from '../components/sync/SyncStatusPanel'
import { openSettingsSection } from '../stores/settingsStore'
import { openRecentBill, openTopCustomer } from '../stores/dashboardActions'

const bills = (n: number): string => `${n} ${n === 1 ? 'bill' : 'bills'}`

/**
 * Phase 46 - the landing screen: four entry cards (Create, History, Customers, Settings with their keys), today / this month,
 * the last seven days, recent bills (Enter opens one), top customers, last backup and the sync placeholder. Numbers refresh on
 * mount and whenever the window regains focus; amounts use Indian grouping. Tab order: cards, Recent bills, Top customers.
 */
export default function Dashboard(): React.JSX.Element {
  const navigate = useRouter((s) => s.navigate)
  const [db, setDb] = useState<DbInfo | null>(null)
  const st = useDashboardStore()
  useEffect(() => {
    // Dev-only diagnostics line (Phase 5): the owner sees that the DB opened and migrated.
    void window.quot3.app.getInfo().then((info) => {
      if (info.ok && info.data.devMode) void window.quot3.app.getDbInfo().then((r) => r.ok && setDb(r.data))
    })
  }, [])
  useEffect(() => {
    void useDashboardStore.getState().load()
    const onFocus = (): void => { void useDashboardStore.getState().load() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const cards = NAV_ITEMS.filter((i) => i.path !== '/' && i.path !== ROUTES.games)
  const s = st.stats
  const sync = useSyncStatusStore((x) => x.overview)
  const progressChip = useProgressChip()
  const syncLoaded = useSyncStatusStore((x) => x.loaded)
  return (
    <div className="q3-page">
      <h1 className="q3-page__title">Dashboard</h1>
      <CrashNotice />
      <DraftRecovery />
      <div className="q3-dash" role="group" aria-label="Quick entry">
        {cards.map((c) => {
          const keys = primaryKeys(c.action)
          return (
            <button key={c.path} type="button" className="q3-dash__card nm-raised nm-lg" onClick={() => navigate(c.path)}>
              <span className="q3-dash__inner">
                <Icon icon={c.icon} weight="duotone" size="lg" />
                <span className="q3-dash__label">{c.label}</span>
                {keys && <Kbd keys={keys} />}
              </span>
            </button>
          )
        })}
      </div>
      {st.status === 'error' && <div className="q3-hist__error" role="alert">{st.error}</div>}
      {s && (
        <div className="q3-stats" data-testid="dash-stats">
          <StatTile label="Today" value={formatHistoryTotal(s.today.total)} sub={bills(s.today.count)} />
          <StatTile label="This month" value={formatHistoryTotal(s.month.total)} sub={bills(s.month.count)} />
          <section className="q3-stats__panel nm-inset nm-sm" aria-label="Last 7 days">
            <h2 className="q3-stats__title">Last 7 days</h2>
            <Sparkline week={s.week} />
          </section>
          <section className="q3-stats__panel nm-inset nm-sm" aria-label="Recent bills">
            <h2 className="q3-stats__title">Recent bills</h2>
            <DashList
              label="Recent bills"
              items={s.recent}
              empty="No bills yet. Press Ctrl+1 to create one."
              onOpen={(b) => { openRecentBill(b.id) }}
              render={(b) => (
                <>
                  <span>{b.poNumber}</span>
                  <span>{formatHistoryDate(b.billDate)}</span>
                  <span className="q3-hist__party" title={b.partyName}>{b.partyName || '—'}</span>
                  <span className="q3-hist__num">{formatHistoryTotal(b.grandTotal)}</span>
                </>
              )}
            />
          </section>
          <section className="q3-stats__panel nm-inset nm-sm" aria-label="Top customers">
            <h2 className="q3-stats__title">Top customers</h2>
            <DashList
              label="Top customers"
              items={s.topCustomers}
              empty="No customer has a bill yet."
              onOpen={() => openTopCustomer()}
              render={(c) => (
                <>
                  <span className="q3-hist__party" title={c.name}>{c.name}</span>
                  <span className="q3-hist__num">{bills(c.billCount)}</span>
                  <span className="q3-hist__num">{formatHistoryTotal(c.totalBilled)}</span>
                </>
              )}
            />
          </section>
          <p className="q3-page__hint q3-stats__foot">
            <span>Last backup: {formatBackupTime(s.lastBackup, new Date())}</span>
            <span aria-hidden="true">·</span>
            {syncLoaded && sync.mode !== 'off'
              ? (
                <button type="button" className={`q3-sychip q3-sychip--${sync.mode === 'attention' ? 'bad' : sync.mode === 'ok' ? 'ok' : sync.mode === 'paused' ? 'off' : 'wait'}`} data-testid="dash-sync-chip" title={sync.headline}
                  onClick={() => { openSettingsSection('sync', navigate) }}>
                  <SyncDot mode={sync.mode} />{progressChip ?? sync.chip}
                </button>
              )
              : <span data-testid="dash-sync-chip">Sync: off</span>}
          </p>
        </div>
      )}
      <TodayTiles />
      <p className="q3-page__hint">
        Press <Kbd keys="Ctrl+K" /> for commands, <Kbd keys="F1" /> for all shortcuts.
      </p>
      {db && (
        <p className="q3-page__hint" data-testid="db-info">
          DB schema v{db.userVersion}/{db.schemaVersion} · {db.writable ? 'writable' : 'READ-ONLY'} · next PO {db.nextPoPreview}
        </p>
      )}
    </div>
  )
}
