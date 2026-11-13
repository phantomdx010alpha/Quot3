import { useEffect } from 'react'
import { Button } from '../ui'
import { describeEntry } from '@shared/pricelist/logEntry'
import { LOG_RETENTION_RANGE } from '@shared/pricelist/settings'
import { usePriceActivityStore } from '../../stores/priceActivityStore'

const when = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString() }

/**
 * Phase 243 (M23) - Settings > Price List > Activity. Seat 1 (shared sync on) or a PC without sync only; any other seat never sees this section
 * (and the server returns nothing to it). The list itself shows only while the switch is on. Recording always runs, so the history is there
 * when the switch is turned on later [A]. Plain words, tokens only, no emoji.
 */
export function PriceActivitySettings(): React.JSX.Element | null {
  const access = usePriceActivityStore((s) => s.access)
  const rows = usePriceActivityStore((s) => s.rows)
  const next = usePriceActivityStore((s) => s.next)
  const error = usePriceActivityStore((s) => s.error)
  const busy = usePriceActivityStore((s) => s.busy)
  useEffect(() => {
    void usePriceActivityStore.getState().load()
    return () => usePriceActivityStore.getState().reset()
  }, [])
  if (access === null || !access.canView) return null
  const st = usePriceActivityStore.getState
  return (
    <div className="q3-set__panel" role="group" aria-label="Price List activity">
      <h2 className="q3-page__title">Activity</h2>
      <p className="q3-set__muted">
        {access.source === 'server'
          ? 'Who added, changed or removed what in the Price List, on every computer and phone of the shop. Only seat 1 can see this.'
          : 'What was added, changed or removed in the Price List on this computer. Without shared sync this computer counts as the main one.'}
      </p>
      <label className="q3-set__check">
        <input type="checkbox" checked={access.visible} disabled={busy} onChange={(e) => { void st().setVisible(e.target.checked) }} />
        <span>Show the activity list (it is recorded either way)</span>
      </label>
      <label className="q3-set__row">
        <span>Keep the activity for (days)</span>
        <input type="number" className="q3-input" min={LOG_RETENTION_RANGE.min} max={LOG_RETENTION_RANGE.max} defaultValue={access.retentionDays} key={access.retentionDays}
          aria-label="Days to keep the activity" onBlur={(e) => { const n = Number(e.target.value); if (n !== access.retentionDays) void st().setRetention(n) }} />
      </label>
      {access.visible && (
        <>
          <div className="q3-set__row">
            <Button type="button" disabled={busy || rows.length === 0} onClick={() => { void st().exportCsv() }}>Export as CSV</Button>
            <Button type="button" disabled={busy} onClick={() => { void st().load() }}>Refresh</Button>
          </div>
          {rows.length === 0 && !busy && error === '' && <p className="q3-set__muted" data-testid="pla-none">Nothing has been recorded yet.</p>}
          <ul className="q3-pla" aria-label="Price List changes">
            {rows.map((r) => (
              <li key={r.id} className="q3-pla__row" data-testid={`pla-${r.id}`}>
                <span className="q3-pla__when">{when(r.at)}</span>
                <span className="q3-pla__what">{describeEntry(r, r.branchName)}</span>
              </li>
            ))}
          </ul>
          {next !== null && <Button type="button" disabled={busy} onClick={() => { void st().more() }}>Show older</Button>}
        </>
      )}
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
    </div>
  )
}
