import { useEffect, useState } from 'react'
import type { OutboxItem } from '@shared/sync/outbox'
import { lastActivityAt, type SyncMode } from '@shared/sync/manager'
import { PROGRESS_MIN_TOTAL, progressLabel, progressPercent, type SyncProgress } from '@shared/sync/progress'
import { Button } from '../ui'
import { useSyncStatusStore } from '../../stores/syncStatusStore'
import { openBillForEdit } from '../../stores/createSession'
import { requestLeave } from '../../stores/guardStore'

const when = (iso: string | null): string => {
  if (iso === null || iso === '') return 'Not yet'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'Not yet' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
const wait = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} s`)
const TONE: Record<SyncMode, 'ok' | 'wait' | 'bad' | 'off'> = { off: 'off', paused: 'off', attention: 'bad', offline: 'wait', working: 'wait', ok: 'ok' }

/** Chip text + tone for a mode (shared with the Dashboard). */
export function SyncDot({ mode }: { mode: SyncMode }): React.JSX.Element {
  return <span className={`q3-sydot q3-sydot--${TONE[mode]}`} aria-hidden="true" />
}

/** Phase 89: one bar per running direction ("Sending 120 of 768"); nothing for tiny runs. */
export function SyncProgressBars(): React.JSX.Element | null {
  const sending = useSyncStatusStore((s) => s.sending)
  const receiving = useSyncStatusStore((s) => s.receiving)
  const list = [sending, receiving].filter((p): p is SyncProgress => p !== null && p.total >= PROGRESS_MIN_TOTAL)
  if (list.length === 0) return null
  return (
    <div className="q3-sprog" data-testid="sync-progress">
      {list.map((p) => (
        <div key={p.direction} className="q3-sprog__row">
          <span className="q3-sprog__label" role="status">{progressLabel(p)}</span>
          <progress className="q3-sprog__bar" max={p.total} value={Math.min(p.done, p.total)} aria-label={progressLabel(p)}>{progressPercent(p)}%</progress>
        </div>
      ))}
    </div>
  )
}

/** Phase 89: the chip text while a run is going (the Dashboard shows it instead of the plain chip), else null. */
export function useProgressChip(): string | null {
  const sending = useSyncStatusStore((s) => s.sending)
  const receiving = useSyncStatusStore((s) => s.receiving)
  const p = [sending, receiving].find((x): x is SyncProgress => x !== null && x.total >= PROGRESS_MIN_TOTAL)
  return p ? progressLabel(p) : null
}

/**
 * Phase 59 - Settings > Sync, status part: the on / off switch, what the last send and receive did, how many changes wait or
 * failed (with Retry), problems in plain words, and the bills that were changed on two branches at once. Activation itself
 * stays in `SyncSection` below it.
 */
export function SyncStatusPanel(): React.JSX.Element {
  const { overview: o, loaded, conflicts, busy, error, notice } = useSyncStatusStore()
  const [failed, setFailed] = useState<OutboxItem[]>([])
  useEffect(() => { void useSyncStatusStore.getState().load(); void useSyncStatusStore.getState().loadConflicts() }, [])
  // The failed list is only fetched while something failed (it is the same outbox the Retry button works on).
  useEffect(() => {
    if (o.failed === 0) { setFailed([]); return }
    const api = (window as unknown as { quot3?: { sync?: { outbox(): Promise<{ ok: boolean; data?: { failed: OutboxItem[] } }> } } }).quot3?.sync
    void api?.outbox().then((r) => { if (r.ok && r.data) setFailed(r.data.failed) }).catch(() => undefined)
  }, [o.failed])

  if (!loaded) return <p className="q3-set__muted" role="status">Loading sync status.</p>
  const st = useSyncStatusStore.getState()
  const locked = busy || o.readOnly
  const open = (billId: string): void => { requestLeave(() => { void openBillForEdit(billId) }) }
  const last = lastActivityAt(o)

  return (
    <section className="q3-sst" aria-label="Sync status">
      <div className="q3-sst__head">
        <label className="q3-set__check">
          <input type="checkbox" role="switch" aria-label="Sync on this computer" checked={o.activated && o.enabled} disabled={!o.activated || locked}
            onChange={(e) => { void st.setEnabled(e.target.checked) }} />
          <span>Sync is {o.activated && o.enabled ? 'on' : 'off'}</span>
        </label>
        <span className={`q3-sychip q3-sychip--${TONE[o.mode]}`} role="status" data-testid="sync-chip"><SyncDot mode={o.mode} />{o.chip}</span>
      </div>
      <p className="q3-set__muted" data-testid="sync-headline">{o.headline}</p>
      <SyncProgressBars />
      {o.activated && (
        <dl className="q3-set__facts" aria-label="Sync numbers">
          <dt>Delivery</dt><dd role="status">{o.deliveryText}</dd>
          <dt>Last sent</dt><dd>{when(o.lastPushAt)}</dd>
          <dt>Last received</dt><dd>{when(o.lastPullAt)}</dd>
          <dt>Last activity</dt><dd>{when(last)}</dd>
          <dt>Waiting to send</dt><dd>{o.pending}{o.oldestPendingAt ? `, oldest ${when(o.oldestPendingAt)}` : ''}</dd>
          <dt>Given up on</dt><dd>{o.failed}</dd>
          <dt>Conflicts</dt><dd>{o.conflicts}</dd>
          {o.held > 0 && <><dt>Held for the open bill</dt><dd>{o.held}</dd></>}
          {o.skipped > 0 && <><dt>Unreadable from others</dt><dd>{o.skipped}</dd></>}
          {o.enabled && (o.push.consecutiveFailures > 0 || o.pull.consecutiveFailures > 0) && <><dt>Next attempt in</dt><dd>{wait(Math.min(...[o.push, o.pull].filter((x) => x.consecutiveFailures > 0).map((x) => x.nextDelayMs)))}</dd></>}
        </dl>
      )}
      {o.errors.length > 0 && (
        <ul className="q3-sst__errors" aria-label="Sync problems">{o.errors.map((m) => <li key={m} className="q3-set__error">{m}</li>)}</ul>
      )}
      {o.clockWarning !== '' && <p role="alert" className="q3-set__error" data-testid="sync-clock-warning">{o.clockWarning}</p>}
      {o.activated && (
        <div className="q3-set__row">
          <Button variant="primary" disabled={locked || !o.enabled} onClick={() => { void st.syncNow() }}>{busy ? 'Working' : 'Sync now'}</Button>
          <Button variant="ghost" disabled={locked || o.failed === 0} onClick={() => { void st.retry() }}>Retry failed changes</Button>
        </div>
      )}
      {failed.length > 0 && (
        <div className="q3-sy__scroll" tabIndex={0} role="region" aria-label="Changes given up on">
          <table className="q3-sy__table">
            <thead><tr><th scope="col">Bill</th><th scope="col">Tries</th><th scope="col">Last error</th><th scope="col"><span className="q3-sr">Action</span></th></tr></thead>
            <tbody>{failed.map((f) => (
              <tr key={f.id}><td>{f.poNumber ?? 'Removed bill'}</td><td>{f.attempts}</td><td>{f.lastError ?? ''}</td>
                <td><Button variant="ghost" disabled={locked} onClick={() => { void st.retry([f.id]) }}>Retry</Button></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="q3-sst__conflicts">
          <h3 className="q3-bs__title">Bills changed on two branches</h3>
          <p className="q3-set__muted">The newer version was kept. Your version is saved in the audit log. Open the bill to check it, then mark it as seen.</p>
          <div className="q3-sy__scroll" tabIndex={0} role="region" aria-label="Conflicts">
            <table className="q3-sy__table">
              <thead><tr><th scope="col">Bill</th><th scope="col">When</th><th scope="col">What was lost</th><th scope="col"><span className="q3-sr">Actions</span></th></tr></thead>
              <tbody>{conflicts.map((c) => (
                <tr key={c.billId}>
                  <td>{c.poNumber}</td><td>{when(c.at)}</td><td>{c.lost === 'delete' ? 'A delete made here' : 'An edit made here'}</td>
                  <td className="q3-sst__acts">
                    <Button variant="ghost" onClick={() => open(c.billId)}>Open bill</Button>
                    <Button variant="ghost" disabled={locked} onClick={() => { void st.dismissConflict(c.billId) }}>Mark as seen</Button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {notice !== '' && <p role="status" className="q3-set__saved">{notice}</p>}
    </section>
  )
}
