import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { computeBackupStatus, exportBackup, importBackup, type BackupStatus } from '../data/backup'
import { countRecords, type PhoneDb } from '../data/db'
import { getMeta } from '../data/metaRepo'
import { resetPhoneData } from '../data/resetData'
import { getSetting } from '../data/settingsRepo'
import { formatBytes, readStorageHealth, requestPersistence, type StorageEnv, type StorageHealth } from '../platform/storage'
import { lastExportText, nextResetStep, type ResetStep } from './settingsModel'

function browserDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const yn = (v: boolean | null): string => (v === null ? 'unknown' : v ? 'yes' : 'no')
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Settings > Storage and backup (Phase 185): persistence, usage, Export / Import, and "Reset phone data" behind TWO confirms. */
export function SettingsStorage(props: {
  db: PhoneDb; version: string; now?: () => Date
  storageEnv?: StorageEnv; download?: (blob: Blob, name: string) => void
  onChanged?: () => void
}): ReactElement {
  const { db } = props
  const [health, setHealth] = useState<StorageHealth | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [lastExport, setLastExport] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<File | null>(null)
  const [reset, setReset] = useState<ResetStep>('idle')
  const [busy, setBusy] = useState(false)
  const env = props.storageEnv ?? (typeof navigator !== 'undefined' ? (navigator as StorageEnv) : {})
  const nowDate = (): Date => (props.now ? props.now() : new Date())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setHealth(await readStorageHealth(env))
      const meta = await getMeta(db)
      const days = await getSetting(db, 'backup.reminderDays')
      setLastExport(meta.last_export_at)
      setStatus(computeBackupStatus({ lastExportAt: meta.last_export_at, hasData: (await countRecords(db, 'bills')) > 0, now: nowDate(), reminderDays: days }))
    } catch (e) { setError(msg(e)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])
  useEffect(() => { void refresh() }, [refresh])

  const doExport = async (): Promise<void> => {
    if (busy) return
    setBusy(true); setError(null); setNote(null)
    try {
      const f = await exportBackup(db, { appVersion: props.version, now: props.now })
      ;(props.download ?? browserDownload)(f.blob, f.fileName)
      setNote(`Backup saved to your downloads (${f.counts.bills ?? 0} bills, ${f.counts.parties ?? 0} customers).`)
      await refresh()
    } catch (e) { setError(msg(e)) } finally { setBusy(false) }
  }

  const doImport = async (): Promise<void> => {
    const file = pendingImport
    if (!file || busy) return
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await importBackup(db, file, props.now)
      setNote(`Backup restored (${r.counts.bills ?? 0} bills, ${r.counts.parties ?? 0} customers).`)
      props.onChanged?.()
      await refresh()
    } catch (e) { setError(msg(e)) } finally { setPendingImport(null); setBusy(false) }
  }

  const resetAction = async (action: 'start' | 'confirm' | 'cancel'): Promise<void> => {
    const { step, erase } = nextResetStep(reset, action)
    setReset(step)
    if (!erase) return
    setBusy(true); setError(null); setNote(null)
    try {
      await resetPhoneData(db)
      setNote('Phone data erased. Settings and the branch link were kept.')
      props.onChanged?.()
      await refresh()
    } catch (e) { setError(msg(e)) } finally { setBusy(false) }
  }

  const canWrite = db.canWrite()
  return (
    <section className="q3-set" aria-label="Storage and backup">
      <h2 className="q3-h2">Storage and backup</h2>
      <div className="q3-row"><span>Kept by the browser</span><span>{yn(health?.persisted ?? null)}</span></div>
      <div className="q3-row"><span>Used</span><span>{formatBytes(health?.usageBytes ?? null)} of {formatBytes(health?.quotaBytes ?? null)}</span></div>
      <div className="q3-row"><span>Last export</span><span>{lastExportText(lastExport, nowDate())}</span></div>
      {health?.persisted === false && health.persistApiAvailable ? (
        <button type="button" className="q3-btn" disabled={!canWrite} onClick={() => void requestPersistence(env).then(refresh)}>Ask the browser to keep my data</button>
      ) : null}
      {status && status.state !== 'ok' ? <p className="q3-note q3-note-warn" role="status">{status.state === 'never' ? 'This phone has bills but no backup file yet. Export one.' : `Your last backup is ${status.daysSince} days old. Export a new one.`}</p> : null}
      <div className="q3-actions">
        <button type="button" className="q3-btn q3-btn-primary" disabled={busy} onClick={() => void doExport()}>Export backup</button>
        <label className="q3-btn">
          Import backup
          <input type="file" aria-label="Import backup file" accept="application/json,.json" hidden disabled={!canWrite || busy} onChange={(e) => { setPendingImport(e.target.files?.[0] ?? null); e.target.value = '' }} />
        </label>
      </div>
      {pendingImport ? (
        <div className="q3-confirm" role="alertdialog" aria-label="Replace phone data">
          <p>Replace everything on this phone with “{pendingImport.name}”? Bills and customers made since that backup are lost.</p>
          <div className="q3-actions">
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => void doImport()}>Replace</button>
            <button type="button" className="q3-btn" onClick={() => setPendingImport(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <h2 className="q3-h2">Reset phone data</h2>
      <p className="q3-muted">Erases the bills and customers on this phone only. Export a backup first.</p>
      {reset === 'idle' ? <button type="button" className="q3-btn" disabled={!canWrite || busy} onClick={() => void resetAction('start')}>Reset phone data</button> : null}
      {reset === 'first' ? (
        <div className="q3-confirm" role="alertdialog" aria-label="Reset phone data, first check">
          <p>Erase all bills and customers on this phone? Changes not yet sent to your other computers are lost.</p>
          <div className="q3-actions">
            <button type="button" className="q3-btn" onClick={() => void resetAction('confirm')}>Continue</button>
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => void resetAction('cancel')}>Keep my data</button>
          </div>
        </div>
      ) : null}
      {reset === 'second' ? (
        <div className="q3-confirm" role="alertdialog" aria-label="Reset phone data, last check">
          <p>Last check: this cannot be undone.</p>
          <div className="q3-actions">
            <button type="button" className="q3-btn" onClick={() => void resetAction('confirm')}>Yes, erase now</button>
            <button type="button" className="q3-btn q3-btn-primary" onClick={() => void resetAction('cancel')}>Keep my data</button>
          </div>
        </div>
      ) : null}
      {note ? <p className="q3-note" role="status">{note}</p> : null}
      {error ? <p className="q3-note q3-note-warn" role="alert">{error}</p> : null}
    </section>
  )
}
