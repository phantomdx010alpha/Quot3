import { ArrowCounterClockwise, FileXls } from '@phosphor-icons/react'
import { IMPORT_FIELDS, IMPORT_FIELD_LABEL, describeReport, type PlannedRow, type PlannedStatus } from '@shared/partyImport/partyImport'
import { Badge, Button, Dialog, Icon, Select } from '../ui'
import { usePartyImportStore } from '../../stores/partyImportStore'

const STATUS_LABEL: Readonly<Record<PlannedStatus, string>> = { new: 'New', update: 'Update', duplicate: 'Exists', repeated: 'Repeated', invalid: 'Problem', blank: 'Empty' }
const STATUS_TONE: Readonly<Record<PlannedStatus, 'ok' | 'info' | 'neutral' | 'danger'>> = { new: 'ok', update: 'info', duplicate: 'neutral', repeated: 'neutral', invalid: 'danger', blank: 'neutral' }

function PlanTable({ rows }: { rows: readonly PlannedRow[] }): React.JSX.Element {
  return (
    <div className="q3-pimp__tablewrap">
      <table className="q3-pimp__table" aria-label="Import preview">
        <thead><tr><th>Row</th><th>Result</th><th>Party name</th><th>Phone</th><th>Transport</th><th>Note</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.row}>
              <td>{r.row}</td>
              <td><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
              <td>{r.name}</td><td>{r.phone}</td><td>{r.transport}</td><td>{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Phase 47 - the party Excel import. A modal mounted once in the app shell: choose file, check the column mapping against a preview, import, undo. */
export function PartyImportDialog(): React.JSX.Element | null {
  const s = usePartyImportStore()
  if (s.step === 'closed' || s.step === 'choosing') return null
  const p = s.preview

  if (s.step === 'done' || (s.step === 'mapping' && s.report === null && s.undoMessage !== '')) {
    return (
      <Dialog open title="Import parties" onClose={s.close} wide footer={<Button variant="primary" data-autofocus onClick={s.close}>Close</Button>}>
        {s.report ? (
          <div>
            <p role="status" className="q3-pimp__result">{describeReport(s.report)}</p>
            {s.report.details.some((d) => d.status === 'invalid') && <p className="q3-pimp__warn">Rows with problems were not imported:</p>}
            <PlanTable rows={s.report.details.filter((d) => d.status === 'invalid' || d.status === 'new' || d.status === 'update').slice(0, 50)} />
            <div className="q3-pimp__row">
              <Button size="sm" icon={ArrowCounterClockwise} disabled={s.busy} onClick={() => { void s.undo() }}>Undo this import</Button>
              <span className="q3-pimp__hint">Removes what this import added and puts updated parties back.</span>
            </div>
          </div>
        ) : <p role="status" className="q3-pimp__result">{s.undoMessage}</p>}
        {s.error && <p role="alert" className="q3-pimp__error">{s.error}</p>}
      </Dialog>
    )
  }

  const colOptions = [{ value: '', label: 'Do not import' }, ...(p?.headers ?? []).map((h, i) => ({ value: String(i), label: `${i + 1}. ${h.trim() === '' ? '(blank)' : h}` }))]
  const nameMissing = s.mapping.name === null
  const total = p ? p.summary.new + p.summary.update : 0
  return (
    <Dialog
      open title="Import parties from Excel" onClose={s.close} wide
      footer={
        <>
          <Button onClick={s.close}>Cancel</Button>
          <Button variant="primary" icon={FileXls} disabled={s.busy || nameMissing || total === 0 || s.step === 'importing'} onClick={() => { void s.commit() }}>
            {total > 0 ? `Import ${total} ${total === 1 ? 'party' : 'parties'}` : 'Import'}
          </Button>
        </>
      }
    >
      {p && (
        <div className="q3-pimp">
          <p className="q3-pimp__file"><Icon icon={FileXls} /> {p.fileName} - {p.totalRows} data rows</p>
          <div className="q3-pimp__grid">
            {p.sheets.length > 1 && (
              <Select label="Sheet" value={s.sheet} options={p.sheets.map((n) => ({ value: n, label: n }))} onChange={(e) => { void s.setSheet(e.target.value) }} />
            )}
            <label className="q3-pimp__num">
              <span>Header row</span>
              <input className="q3-input nm-inset nm-sm" type="number" min={1} value={s.headerRow ?? p.headerRow} aria-label="Header row" onChange={(e) => { void s.setHeaderRow(Number(e.target.value)) }} />
            </label>
            {IMPORT_FIELDS.map((f) => (
              <Select
                key={f} label={IMPORT_FIELD_LABEL[f] + (f === 'name' ? ' (required)' : '')} value={s.mapping[f] === null ? '' : String(s.mapping[f])}
                options={f === 'name' ? colOptions.slice(1) : colOptions}
                onChange={(e) => { void s.setMapping(f, e.target.value === '' ? null : Number(e.target.value)) }}
              />
            ))}
            <Select label="If the party already exists" value={s.mode} options={[{ value: 'skip', label: 'Skip it (keep what is saved)' }, { value: 'update', label: 'Update it with the new details' }]} onChange={(e) => { void s.setMode(e.target.value as 'skip' | 'update') }} />
          </div>
          <p className="q3-pimp__summary" role="status">
            {p.summary.new} new, {p.summary.update} to update, {p.summary.duplicate + p.summary.repeated} skipped, {p.summary.invalid} with problems
          </p>
          {nameMissing ? <p className="q3-pimp__warn">Choose the column that holds the party name.</p> : <PlanTable rows={p.rows} />}
        </div>
      )}
      {s.error && <p role="alert" className="q3-pimp__error">{s.error}</p>}
    </Dialog>
  )
}
