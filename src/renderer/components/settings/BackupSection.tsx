import { useEffect, useState } from 'react'
import { KIND_LABEL, formatBytes, isResetConfirm, isRestoreConfirm, type BackupInfo } from '@shared/backup/backupRules'
import { Button, ConfirmDialog, Dialog, Input } from '../ui'
import { useBackupStore } from '../../stores/backupStore'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Phase 50 - backups: create, list (size / bills), restore (typed), delete, import from another machine, reset local data (typed). */
export function BackupSection(): React.JSX.Element {
  const { list, status, busy, error, notice, restarting } = useBackupStore()
  const [restoreOf, setRestoreOf] = useState<BackupInfo | null>(null)
  const [deleteOf, setDeleteOf] = useState<BackupInfo | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [word, setWord] = useState('')
  useEffect(() => { void useBackupStore.getState().load() }, [])
  const readOnly = status?.readOnly === true
  const close = (): void => { setRestoreOf(null); setResetOpen(false); setWord('') }
  const doRestore = async (): Promise<void> => { if (restoreOf && isRestoreConfirm(word)) { const f = restoreOf.file; close(); await useBackupStore.getState().restore(f, 'RESTORE') } }
  const doReset = async (): Promise<void> => { if (isResetConfirm(word)) { close(); await useBackupStore.getState().reset('RESET') } }

  return (
    <div className="q3-bk" aria-label="Backups">
      <p className="q3-set__muted">
        A backup is made automatically the first time the app opens each day (the newest {status?.keepAuto ?? 14} are kept). Manual backups, imported files and the safety copies made before a restore are never removed automatically.
      </p>
      {status && !status.integrity.ok && <p role="alert" className="q3-set__error">The database failed its start-up check ({status.integrity.message}). Restore the newest backup below.</p>}
      <div className="q3-set__row">
        <Button variant="primary" disabled={busy || readOnly || restarting} shortcut="Ctrl+Alt+B" onClick={() => { void useBackupStore.getState().create() }}>Create backup</Button>
        <Button variant="ghost" disabled={busy || readOnly || restarting} onClick={() => { void useBackupStore.getState().importFile() }}>Import a backup file</Button>
        <Button variant="danger" disabled={busy || readOnly || restarting} onClick={() => { setWord(''); setResetOpen(true) }}>Reset local data</Button>
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {notice !== '' && <p role="status" className="q3-set__saved">{notice}</p>}
      {list.length === 0 ? (
        <p className="q3-set__muted" role="status">No backups yet.</p>
      ) : (
        <div className="q3-sc__scroll" tabIndex={0} role="region" aria-label="Backup list">
          <table className="q3-sc q3-bk__table">
            <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Bills</th><th scope="col">Size</th><th scope="col"><span className="q3-sr">Actions</span></th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.file} title={b.file}>
                  <td>{when(b.createdAt)}</td>
                  <td>{KIND_LABEL[b.kind]}</td>
                  <td>{b.readable ? b.billCount : 'Unreadable'}</td>
                  <td>{formatBytes(b.sizeBytes)}</td>
                  <td className="q3-bk__acts">
                    <Button size="sm" disabled={busy || readOnly || restarting || !b.readable} aria-label={`Restore ${b.file}`} onClick={() => { setWord(''); setRestoreOf(b) }}>Restore</Button>
                    <Button size="sm" variant="ghost" disabled={busy || restarting} aria-label={`Delete ${b.file}`} onClick={() => setDeleteOf(b)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={restoreOf !== null} title="Restore this backup" onClose={close}
        footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" disabled={!isRestoreConfirm(word)} onClick={() => { void doRestore() }}>Restore and restart</Button></>}>
        <p>This replaces everything in the app with the backup from {restoreOf ? when(restoreOf.createdAt) : ''} ({restoreOf?.billCount ?? 0} bills). Your current data is backed up first, and the app restarts. Type RESTORE to confirm.</p>
        <Input label="Type RESTORE" value={word} data-autofocus autoComplete="off" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void doRestore() } }} />
      </Dialog>
      <Dialog open={resetOpen} title="Reset local data" onClose={close}
        footer={<><Button onClick={close}>Cancel</Button><Button variant="danger" disabled={!isResetConfirm(word)} onClick={() => { void doReset() }}>Reset and restart</Button></>}>
        <p>This removes every bill, customer and setting on this computer and starts empty. Your current data is backed up first, so it can be restored from the list. Type RESET to confirm.</p>
        <Input label="Type RESET" value={word} data-autofocus autoComplete="off" onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void doReset() } }} />
      </Dialog>
      <ConfirmDialog open={deleteOf !== null} danger title="Delete this backup file?" message={<>This removes {deleteOf?.file} from the disk. It cannot be undone.</>} confirmLabel="Delete"
        onCancel={() => setDeleteOf(null)} onConfirm={() => { const f = deleteOf?.file; setDeleteOf(null); if (f) void useBackupStore.getState().remove(f) }} />
    </div>
  )
}
