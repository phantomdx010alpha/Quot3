import { Fragment, useEffect, useState } from 'react'
import { AUDIT_RETENTION_CHOICES, actionLabel, entityLabel } from '@shared/audit'
import { Button, Input, Select } from '../ui'
import { useAuditStore } from '../../stores/auditStore'
import { useDiagnosticsStore } from '../../stores/diagnosticsStore'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const retentionLabel = (days: number): string => (days % 365 === 0 ? `${days / 365} ${days === 365 ? 'year' : 'years'}` : `${days} days`)

/**
 * Phase 61 - Settings > Activity log: who did what and when (bills created / edited / deleted / restored, imports, restores, sync
 * conflicts), with filters, newest first, plus the retention and "Copy diagnostics". The list is read-only.
 */
export function AuditSection(): React.JSX.Element {
  const { filters, items, hasMore, facets, status, error, expanded } = useAuditStore()
  const diag = useDiagnosticsStore()
  const [search, setSearch] = useState(filters.search)
  useEffect(() => { void useAuditStore.getState().load() }, [])

  const entities = [{ value: '', label: 'Everything' }, ...(facets?.entities ?? []).map((e) => ({ value: e, label: entityLabel(e) }))]
  const actions = [{ value: '', label: 'Any action' }, ...(facets?.actions ?? []).map((a) => ({ value: a, label: actionLabel(a) }))]
  const retention = facets?.retentionDays ?? 365
  const choices = [...new Set([...AUDIT_RETENTION_CHOICES, retention])].sort((a, b) => a - b)
  const filtered = filters.entity !== '' || filters.action !== '' || filters.fromDay !== '' || filters.toDay !== '' || filters.search !== ''

  return (
    <div className="q3-au" aria-label="Activity log">
      <p className="q3-set__muted">
        Every bill saved, deleted or restored, every restore and import, and every sync conflict is written here with the time and branch. Entries are kept for {retentionLabel(retention)}.
      </p>
      <div className="q3-au__filters" role="search" aria-label="Filter the activity log">
        <Select label="What" value={filters.entity} options={entities} onChange={(e) => { void useAuditStore.getState().setFilters({ entity: e.target.value }) }} />
        <Select label="Action" value={filters.action} options={actions} onChange={(e) => { void useAuditStore.getState().setFilters({ action: e.target.value }) }} />
        <Input label="From" type="date" value={filters.fromDay} onChange={(e) => { void useAuditStore.getState().setFilters({ fromDay: e.target.value }) }} />
        <Input label="To" type="date" value={filters.toDay} onChange={(e) => { void useAuditStore.getState().setFilters({ toDay: e.target.value }) }} />
        <Input
          label="Search" value={search} placeholder="PO number, name, id"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void useAuditStore.getState().setFilters({ search }) } }}
        />
        <div className="q3-set__row">
          <Button size="sm" onClick={() => { void useAuditStore.getState().setFilters({ search }) }}>Search</Button>
          <Button size="sm" variant="ghost" disabled={!filtered && search === ''} onClick={() => { setSearch(''); void useAuditStore.getState().clearFilters() }}>Clear</Button>
        </div>
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {status === 'loading' && items.length === 0 ? (
        <p className="q3-set__muted" role="status">Loading.</p>
      ) : items.length === 0 ? (
        <p className="q3-set__muted" role="status">{filtered ? 'No entries match these filters.' : 'Nothing has been recorded yet.'}</p>
      ) : (
        <div className="q3-sc__scroll" tabIndex={0} role="region" aria-label="Activity log entries">
          <table className="q3-sc q3-au__table">
            <thead><tr><th scope="col">When</th><th scope="col">What happened</th><th scope="col">Branch</th><th scope="col"><span className="q3-sr">Details</span></th></tr></thead>
            <tbody>
              {items.map((it) => (
                <Fragment key={it.id}>
                  <tr data-audit-id={it.id}>
                    <td>{when(it.at)}</td>
                    <td>{it.summary}</td>
                    <td>{it.branchName}</td>
                    <td>
                      {it.detailText !== '' && (
                        <Button size="sm" variant="ghost" aria-expanded={expanded === it.id} aria-label={`Details of entry ${it.id}`} onClick={() => useAuditStore.getState().toggle(it.id)}>
                          {expanded === it.id ? 'Hide' : 'Details'}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expanded === it.id && (
                    <tr><td colSpan={4}><pre className="q3-au__detail">{it.detailText}</pre></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && <div className="q3-set__row"><Button size="sm" onClick={() => { void useAuditStore.getState().more() }}>Show older entries</Button></div>}
      <div className="q3-au__foot">
        <Select
          label="Keep entries for" value={String(retention)} options={choices.map((d) => ({ value: String(d), label: retentionLabel(d) }))}
          hint="Older entries are removed when the app starts."
          onChange={(e) => { void useAuditStore.getState().setRetention(Number(e.target.value)) }}
        />
        <div className="q3-set__row">
          <Button variant="ghost" onClick={() => { void diag.copy() }}>Copy diagnostics</Button>
        </div>
      </div>
      {diag.message !== '' && <p role={diag.failed ? 'alert' : 'status'} className={diag.failed ? 'q3-set__error' : 'q3-set__saved'}>{diag.message}</p>}
    </div>
  )
}
