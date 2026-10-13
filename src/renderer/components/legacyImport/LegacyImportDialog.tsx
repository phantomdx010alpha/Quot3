import { ArrowCounterClockwise, FileText, FolderOpen } from '@phosphor-icons/react'
import { CLASH_CHOICE_LABEL, clashChoiceFor, previewLines, type ReportFormat } from '@shared/legacyImport/uiModel'
import type { ClashChoice } from '@shared/legacyImport/plan'
import { formatHistoryDate } from '@shared/history/historyList'
import { Badge, Button, Dialog, Select } from '../ui'
import { useLegacyImportStore } from '../../stores/legacyImportStore'

const CHOICES: readonly ClashChoice[] = ['import', 'skip', 'renumber']
const MAX_LISTED = 25

function ReportButtons({ disabled }: { disabled: boolean }): React.JSX.Element {
  const save = useLegacyImportStore((s) => s.saveReport)
  const b = (format: ReportFormat, label: string): React.JSX.Element => (
    <Button size="sm" icon={FileText} disabled={disabled} onClick={() => { void save(format) }}>{label}</Button>
  )
  return <>{b('text', 'Save report as text')}{b('csv', 'Save report as CSV')}</>
}

function List({ title, rows }: { title: string; rows: readonly string[] }): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <details className="q3-limp__list">
      <summary>{title} ({rows.length})</summary>
      <ul>{rows.slice(0, MAX_LISTED).map((r, i) => <li key={i}>{r}</li>)}</ul>
      {rows.length > MAX_LISTED && <p className="q3-limp__hint">{rows.length - MAX_LISTED} more are in the saved report.</p>}
    </details>
  )
}

/** Phase 86 - "Import legacy bills": Pick -> Reading -> Preview -> Import -> Report (LEGACY_IMPORT_SPEC section 7). Mounted once in the app shell. */
export function LegacyImportDialog(): React.JSX.Element | null {
  const s = useLegacyImportStore()
  if (s.step === 'closed') return null
  const err = s.error ? <p role="alert" className="q3-limp__error">{s.error}</p> : null

  if (s.step === 'pick') {
    return (
      <Dialog open title="Import legacy bills" onClose={s.close} wide footer={<Button onClick={s.close}>Close</Button>}>
        <div className="q3-limp">
          <p>Choose the folder that holds the old app's bill files (.json), or pick some of the files. Nothing is changed until you press Import on the next screen. Zip files are not read: unzip them first.</p>
          <div className="q3-limp__row">
            <Button variant="primary" icon={FolderOpen} data-autofocus disabled={s.busy} onClick={() => { void s.pick('folder') }}>Choose folder</Button>
            <Button icon={FileText} disabled={s.busy} onClick={() => { void s.pick('files') }}>Choose .json files</Button>
          </div>
          {s.undoMessage && <p role="status" className="q3-limp__ok">{s.undoMessage}</p>}
          {s.notice && <p role="status" className="q3-limp__hint">{s.notice}</p>}
          {err}
          {s.batches.length > 0 && (
            <div className="q3-limp__past">
              <h3 className="q3-limp__h">Past imports</h3>
              <table className="q3-limp__table" aria-label="Past imports">
                <thead><tr><th>Date</th><th>Source</th><th>Bills</th><th>Numbers</th><th /></tr></thead>
                <tbody>
                  {s.batches.map((b) => (
                    <tr key={b.id}>
                      <td>{formatHistoryDate(b.at.slice(0, 10))}</td>
                      <td title={b.sourceLabel}>{b.sourceLabel}</td>
                      <td>{b.created}</td>
                      <td>{b.poFirst !== null && b.poLast !== null ? `${b.poFirst} - ${b.poLast}` : '-'}</td>
                      <td>
                        {b.undoneAt ? <Badge>Undone</Badge> : (
                          <Button size="sm" icon={ArrowCounterClockwise} disabled={s.busy} title="Moves the bills of this import that were not edited since to Recently deleted" onClick={() => { void s.undo(b.id) }}>Undo this import</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Dialog>
    )
  }

  if (s.step === 'reading') {
    const p = s.progress
    return (
      <Dialog open title="Import legacy bills" onClose={() => { void s.cancelReading() }} footer={<Button data-autofocus onClick={() => { void s.cancelReading() }}>Cancel</Button>}>
        <p role="status" className="q3-limp__progress">{p && p.total > 0 ? `Reading ${p.done} of ${p.total}` : 'Reading the files'}</p>
        {p && p.total > 0 && <progress className="q3-limp__bar" max={p.total} value={p.done} aria-label="Reading progress" />}
        <p className="q3-limp__hint">Nothing is changed while reading.</p>
      </Dialog>
    )
  }

  if (s.step === 'importing') {
    return (
      <Dialog open title="Import legacy bills" onClose={() => undefined}>
        <p role="status" className="q3-limp__progress">Taking a safety backup, then importing. Please wait.</p>
        <p className="q3-limp__hint">This is all-or-nothing: if anything fails, nothing is changed.</p>
      </Dialog>
    )
  }

  if (s.step === 'done' && s.result) {
    const r = s.result.report
    return (
      <Dialog open title="Import finished" onClose={s.close} wide
        footer={<><ReportButtons disabled={s.busy} /><Button variant="primary" data-autofocus onClick={s.close}>Close</Button></>}>
        <div className="q3-limp">
          {s.result.batchId === null
            ? <p role="status" className="q3-limp__ok">Nothing needed importing: every bill is already here. No backup was made and nothing was changed.</p>
            : <p role="status" className="q3-limp__ok">{r.created} {r.created === 1 ? 'bill' : 'bills'} imported. Next new bill: {r.nextPoAfter}. A safety backup was made first.</p>}
          {previewLines(r).map((l) => <p key={l} className="q3-limp__line">{l}</p>)}
          <List title="Files with a problem" rows={r.errors.map((e) => `${e.file}: ${e.error}`)} />
          <List title="Skipped" rows={r.skipped.map((x) => `${x.file}: ${x.detail}`)} />
          <List title="Given a new number" rows={r.renumbered.map((x) => `${x.file}: ${x.legacyRef} became ${x.newPo}`)} />
          <List title="Total differs from the old app" rows={r.totalDifferences.map((d) => `${d.file}: old ${d.legacy}, new ${d.recomputed}${d.note ? ` (${d.note})` : ''}`)} />
          {s.result.batchId !== null && (
            <div className="q3-limp__row">
              <Button size="sm" icon={ArrowCounterClockwise} disabled={s.busy} onClick={() => { void s.undo(s.result!.batchId!) }}>Undo this import</Button>
              <span className="q3-limp__hint">Moves these bills to Recently deleted (edited ones are kept).</span>
            </div>
          )}
          {s.notice && <p role="status" className="q3-limp__hint">{s.notice}</p>}
          {err}
        </div>
      </Dialog>
    )
  }

  // preview
  const p = s.preview
  if (!p) return null
  const r = p.report
  return (
    <Dialog open title={`Import legacy bills - ${p.sourceLabel}`} onClose={s.close} wide
      footer={
        <>
          <Button onClick={() => { void s.backToPick() }}>Back</Button>
          <ReportButtons disabled={s.busy} />
          <Button variant="primary" data-autofocus disabled={s.busy || !p.canImport} onClick={() => { void s.commit() }}>
            {p.canImport ? `Import ${r.created} ${r.created === 1 ? 'bill' : 'bills'}` : 'Nothing to import'}
          </Button>
        </>
      }>
      <div className="q3-limp">
        {previewLines(r).map((l) => <p key={l} className="q3-limp__line">{l}</p>)}
        <p className="q3-limp__hint">Formats: {r.formats.gst} GST, {r.formats.nonGst} non-GST. Old bill numbers keep only the number; the old prefix is dropped.</p>
        <label className="q3-limp__hint q3-limp__check">
          <input type="checkbox" checked={s.send} disabled={s.busy} onChange={(e) => s.setSend(e.target.checked)} />
          Send imported bills to the other branches (only when sync is on; import on one branch only)
        </label>
        {r.warnings.length > 0 && <List title="Warnings" rows={r.warnings} />}
        <List title="Files with a problem (not imported)" rows={r.errors.map((e) => `${e.file}: ${e.error}`)} />
        <List title="Skipped" rows={r.skipped.map((x) => `${x.file}: ${x.detail}`)} />
        {r.clashGroups.length > 0 && (
          <div className="q3-limp__clash">
            <h3 className="q3-limp__h">Bills that share a number in the old app ({r.clashGroups.length})</h3>
            <p className="q3-limp__hint">The suggested choice is already selected. Change it only if you know better.</p>
            <div className="q3-limp__tablewrap">
              <table className="q3-limp__table" aria-label="Clashing bill numbers">
                <thead><tr><th>No.</th><th>File</th><th>Party</th><th>Date</th><th>Choice</th></tr></thead>
                <tbody>
                  {r.clashGroups.flatMap((g) => g.files.map((f) => (
                    <tr key={`${g.number}-${f.file}`}>
                      <td>{g.number}</td><td title={f.reason}>{f.file}</td><td>{f.party}</td><td>{f.date}</td>
                      <td>
                        <Select
                          label="" aria-label={`Choice for ${f.file}`} value={s.choices[f.file] ?? clashChoiceFor(f.defaultAction)} disabled={s.busy}
                          options={CHOICES.map((c) => ({ value: c, label: CLASH_CHOICE_LABEL[c] }))}
                          onChange={(e) => { void s.setChoice(f.file, e.target.value as ClashChoice) }}
                        />
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {s.notice && <p role="status" className="q3-limp__hint">{s.notice}</p>}
        {err}
      </div>
    </Dialog>
  )
}
