import { useEffect, useMemo, useState } from 'react'
import { validatePoPrefix } from '@shared/settings/appSettings'
import { Button, Input } from '../ui'
import { useBackupStore } from '../../stores/backupStore'
import { useBootstrapStore } from '../../stores/bootstrapStore'

/**
 * Phase 58 - join an existing branch. The new computer takes the history of another branch from a backup file made there
 * (Settings > Backup > Create backup), merges it in (bills it already has are kept as they are, PO numbers are kept) and
 * picks its own PO prefix. Imported bills are never sent again. Do this BEFORE activating sync so the prefix is registered once.
 */
export function BootstrapPanel(): React.JSX.Element {
  const { step, busy, error, preview, result } = useBootstrapStore()
  // Phase 92: select the stable list and derive with useMemo - a filter inside the selector returned a NEW array on every read
  // and caused 'Maximum update depth exceeded' (Settings > Sync / License).
  const backupList = useBackupStore((s) => s.list)
  const imported = useMemo(() => backupList.filter((b) => b.kind === 'imported' && b.readable), [backupList])
  const [prefix, setPrefix] = useState('')
  useEffect(() => { void useBackupStore.getState().load() }, [])
  useEffect(() => { if (preview) setPrefix(preview.prefixClash ? preview.suggestedPrefix : preview.local.poPrefix) }, [preview])

  const others = preview ? preview.branches.map((b) => b.poPrefix) : []
  const check = validatePoPrefix(prefix, others)
  const unchanged = preview !== null && check.ok && check.prefix.toUpperCase() === preview.local.poPrefix.toUpperCase()
  const canImport = preview !== null && check.ok && !busy && preview.billsAdded + preview.partiesAdded + preview.branchesAdded > 0

  return (
    <div className="q3-bs" aria-label="Join an existing branch">
      <h3 className="q3-bs__title">Join an existing branch</h3>
      <p className="q3-set__muted">
        For a new computer: on a computer that already has the bills, create a backup (Settings, Backup), copy the file here and choose it below.
        The bills, customers and PO numbers are added to this computer. Nothing here is replaced, and nothing imported is sent to the other branches again.
      </p>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {step === 'choose' && (
        <div className="q3-set__row">
          <Button variant="primary" disabled={busy} onClick={() => { void useBootstrapStore.getState().pickFile() }}>Choose a backup file</Button>
          {imported.slice(0, 3).map((b) => (
            <Button key={b.file} size="sm" variant="ghost" disabled={busy} title={b.file} onClick={() => { void useBootstrapStore.getState().review(b.file) }}>
              Use {b.file.replace(/^imported-/, '').replace(/\.db$/, '')} ({b.billCount} bills)
            </Button>
          ))}
        </div>
      )}
      {step === 'review' && preview && (
        <div className="q3-bs__review">
          <p role="status">
            {preview.billsAdded === 0
              ? 'There is nothing new to add from this file.'
              : `This adds ${preview.billsAdded} bill${preview.billsAdded === 1 ? '' : 's'} and ${preview.partiesAdded} customer${preview.partiesAdded === 1 ? '' : 's'}.`}
            {preview.skippedExisting > 0 && ` ${preview.skippedExisting} already here (kept as they are).`}
            {preview.skippedTrashed > 0 && ` ${preview.skippedTrashed} were in Recently deleted (not added).`}
            {preview.skippedClash > 0 && ` ${preview.skippedClash} could not be added (the same PO number belongs to a different bill here).`}
          </p>
          {preview.branches.length > 0 && (
            <div className="q3-sy__scroll" tabIndex={0} role="region" aria-label="Branches in the file">
              <table className="q3-sy__table">
                <thead><tr><th scope="col">Branch</th><th scope="col">PO prefix</th><th scope="col">Bills</th><th scope="col">New here</th></tr></thead>
                <tbody>{preview.branches.map((b) => <tr key={b.id}><td>{b.name}</td><td>{b.poPrefix}</td><td>{b.bills}</td><td>{b.newBills}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <Input
            label="PO prefix for this computer" value={prefix} autoComplete="off" spellCheck={false} onChange={(e) => setPrefix(e.target.value)}
            {...(!check.ok ? { error: check.message } : preview.prefixClash ? { hint: `A branch in the file already uses ${preview.local.poPrefix}. Choose a different prefix for this computer.` } : { hint: 'New bills made here will be numbered with this prefix.' })}
          />
          {preview.activated && !unchanged && <p role="alert" className="q3-set__error">Sync is already activated here. A new prefix then needs Deactivate and Activate again (Sync section above).</p>}
          <div className="q3-set__row">
            <Button variant="primary" disabled={!canImport} onClick={() => { void useBootstrapStore.getState().apply(prefix) }}>{busy ? 'Importing' : 'Import'}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => useBootstrapStore.getState().reset()}>Cancel</Button>
          </div>
        </div>
      )}
      {step === 'done' && result && (
        <div className="q3-bs__done">
          <p role="status" className="q3-set__saved">
            Imported {result.billsAdded} bill{result.billsAdded === 1 ? '' : 's'} and {result.partiesAdded} customer{result.partiesAdded === 1 ? '' : 's'}. This computer's PO prefix is {result.prefix}.
            Your data from before was saved as {result.safetyBackup}.
          </p>
          <p className="q3-set__muted">
            {result.activated
              ? result.prefixChanged ? 'Sync is activated: Deactivate and Activate again so the license has the new prefix.' : 'Sync is activated; new bills made here will reach the other branches.'
              : 'Next: activate sync above with the license and passphrase your organisation uses, so new bills reach the other branches.'}
          </p>
          <div className="q3-set__row"><Button onClick={() => useBootstrapStore.getState().reset()}>Done</Button></div>
        </div>
      )}
    </div>
  )
}
