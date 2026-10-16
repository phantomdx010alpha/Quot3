import { useEffect, useState } from 'react'
import { FolderOpen } from '@phosphor-icons/react'
import { INTERVAL_RANGE, type LegacyWatchStatus } from '@shared/legacyWatch/watchConfig'
import { Button, Input } from '../ui'
import { useLegacyWatchStore } from '../../stores/legacyWatchStore'
import { ActivityList, ReviewList } from './LegacyReviewLists'

const STATE_TEXT: Record<LegacyWatchStatus['state'], string> = {
  off: 'Watching is off.',
  paused: 'Watching is paused.',
  watching: 'Watching the folder.',
  scanning: 'Scanning the folder now.',
  folder_missing: 'The folder cannot be read.'
}

/** Date and time of the last scan in the owner's local time; '' when it never ran since the app started. */
const when = (iso: string | null): string => {
  if (!iso) return 'No scan yet since Quot3 started.'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'No scan yet since Quot3 started.' : `Last scan: ${d.toLocaleString()}`
}

/** Phase 162 - the one Settings section for the background switches and the legacy folder watch (MILESTONE15_DESIGN 3.7). */
export function LegacyWatchSection(): React.JSX.Element {
  const loaded = useLegacyWatchStore((s) => s.loaded)
  const watch = useLegacyWatchStore((s) => s.watch)
  const background = useLegacyWatchStore((s) => s.background)
  const status = useLegacyWatchStore((s) => s.status)
  const error = useLegacyWatchStore((s) => s.error)
  const busy = useLegacyWatchStore((s) => s.busy)
  const notice = useLegacyWatchStore((s) => s.notice)
  const [secs, setSecs] = useState(String(watch.intervalSeconds))
  useEffect(() => { setSecs(String(watch.intervalSeconds)) }, [watch.intervalSeconds])
  useEffect(() => {
    void useLegacyWatchStore.getState().load()
    // The scanner runs in main; poll its status while this section is open.
    const t = window.setInterval(() => { void useLegacyWatchStore.getState().refreshStatus(); void useLegacyWatchStore.getState().refreshCount() }, 10_000)
    return () => window.clearInterval(t)
  }, [])
  const st = useLegacyWatchStore.getState()
  const hasFolder = watch.folder !== ''
  const canScan = watch.enabled && hasFolder
  const saveSecs = (): void => { void st.setInterval(secs.trim() === '' ? Number.NaN : Number(secs)) }

  if (!loaded) return <p className="q3-set__muted" role="status">Loading.</p>
  return (
    <div className="q3-set__form q3-lw" aria-label="Background and legacy watch">
      <h2 className="q3-page__title">Background</h2>
      <p className="q3-set__muted">Quot3 can only run while someone is signed in to Windows. Both switches are off until you turn them on.</p>
      <label className="q3-set__check">
        <input type="checkbox" checked={background.startWithWindows} disabled={busy} onChange={(e) => { void st.setBackground('startWithWindows', e.target.checked) }} /> Start Quot3 when I sign in to Windows
      </label>
      <label className="q3-set__check">
        <input type="checkbox" checked={background.keepRunning} disabled={busy} onChange={(e) => { void st.setBackground('keepRunning', e.target.checked) }} /> Keep running in the background when the window is closed
      </label>
      {background.startWithWindows && !background.keepRunning && (
        <p className="q3-set__muted" role="note">Quot3 only starts hidden while it is set to keep running in the background. Turn that on too, or Quot3 will open its window at sign-in.</p>
      )}

      <h2 className="q3-page__title">Legacy folder watch</h2>
      <p className="q3-set__muted">Bills the old software saves into this folder are added here and then sent to your other computers by the normal sync. Nothing in the folder is changed or deleted.</p>
      <label className="q3-set__check">
        <input type="checkbox" checked={watch.enabled} disabled={busy} onChange={(e) => { void st.setEnabled(e.target.checked) }} /> Watch the legacy folder for new bills
      </label>
      <div className="q3-set__row">
        <Button type="button" icon={FolderOpen} disabled={busy} onClick={() => { void st.pickFolder() }}>Choose folder</Button>
        <span className="q3-set__muted" data-testid="lw-folder">{hasFolder ? `Folder: ${status?.folderLabel || 'chosen'}` : 'No folder chosen yet.'}</span>
      </div>
      <Input label="Check the folder again every (seconds)" inputMode="numeric" value={secs} disabled={busy} onChange={(e) => setSecs(e.target.value)} onBlur={saveSecs}
        hint={`${INTERVAL_RANGE.min} to ${INTERVAL_RANGE.max}. Saved when you leave the box.`} />
      <div className="q3-set__row">
        <Button type="button" variant="primary" disabled={busy || !canScan} onClick={() => { void st.scanNow() }}>Scan now</Button>
        <Button type="button" disabled={busy || !watch.enabled} onClick={() => { void st.setPaused(!(status?.paused ?? false)) }}>{status?.paused ? 'Resume watching' : 'Pause watching'}</Button>
      </div>
      {!canScan && <p className="q3-set__muted">Scan now needs watching turned on and a folder chosen.</p>}

      <div className="q3-lw__status" role="status" aria-label="Legacy watch status" data-testid="lw-status">
        {status ? (
          <>
            <p>{STATE_TEXT[status.state]}</p>
            <p>{when(status.lastScanAt)}</p>
            <p>Since Quot3 started: {status.totals.imported} imported, {status.totals.updated} updated, {status.totals.duplicate + status.totals.older} skipped, {status.totals.review} need review.</p>
            {status.waiting > 0 && <p>{status.waiting} file(s) are still being written and will be tried again.</p>}
            {!status.syncOn && <p>Sync is off. New bills are saved on this computer only until sync is turned on.</p>}
            {status.message && <p role="alert" className="q3-set__error">{status.message}</p>}
          </>
        ) : <p>Status is not available yet.</p>}
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      {notice !== '' && <p role="status" className="q3-set__saved" data-testid="lw-notice">{notice}</p>}
      <ReviewList />
      <ActivityList />
    </div>
  )
}
