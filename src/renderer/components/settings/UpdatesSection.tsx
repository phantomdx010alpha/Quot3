import { useEffect, useState } from 'react'
import { UPDATE_CHANNELS, describeUpdate, type UpdateChannel } from '@shared/updater'
import { rollbackConfirmText } from '@shared/rollback'
import { Button, ConfirmDialog, Input, Select } from '../ui'
import { restartToUpdate, useUpdateStore } from '../../stores/updateStore'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const day = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Phase 62 - Settings > Updates: Check now, progress, Restart to update, automatic checks, channel, optional feed address. */
export function UpdatesSection(): React.JSX.Element {
  const { state, error, busy } = useUpdateStore()
  const [feed, setFeed] = useState('')
  // 0.1.5 choose app version: the list is opened on demand; `pick` is the version waiting for the owner's confirmation.
  const { versions, versionsLoading, versionsError } = useUpdateStore()
  const [listOpen, setListOpen] = useState(false)
  const [pick, setPick] = useState('')
  useEffect(() => { void useUpdateStore.getState().load() }, [])
  const copy = describeUpdate(state)
  const unavailable = state.phase === 'unavailable'
  const working = busy || state.phase === 'checking' || state.phase === 'downloading'
  const checked = state.checkedAt !== '' ? when(state.checkedAt) : ''

  return (
    <div className="q3-up" aria-label="Updates">
      <div className="q3-up__status" role="status" data-testid="update-status">
        <h2 className="q3-up__title">{copy.title}</h2>
        <p className="q3-set__muted">{copy.detail}{checked !== '' && state.phase !== 'downloading' ? ` Last checked ${checked}.` : ''}</p>
        {state.phase === 'downloading' && <progress className="q3-up__bar" max={100} value={state.percent} aria-label="Download progress" />}
      </div>
      <div className="q3-set__row">
        {state.phase === 'ready'
          ? <Button variant="primary" onClick={() => restartToUpdate()}>{state.mode === 'rollback' ? `Restart to go back to ${state.version}` : 'Restart to update'}</Button>
          : <Button variant="primary" disabled={working || unavailable} onClick={() => { void useUpdateStore.getState().check() }}>Check for updates</Button>}
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-up__ver" data-testid="version-picker">
        <h3 className="q3-up__sub">Choose app version</h3>
        {state.pinned !== '' && (
          <p className="q3-set__muted" role="status" data-testid="pinned-note">
            You chose to stay on version {state.pinned}. Background updates are paused until you go back to the latest version.
          </p>
        )}
        <p className="q3-set__muted">Go back to an earlier version from GitHub if the newest one gives trouble. Your bills are kept and a backup is made first.</p>
        <div className="q3-set__row">
          <Button size="sm" disabled={unavailable} onClick={() => { const next = !listOpen; setListOpen(next); if (next) void useUpdateStore.getState().loadVersions() }}>
            {listOpen ? 'Hide versions' : 'Choose app version'}
          </Button>
          {state.pinned !== '' && <Button size="sm" variant="primary" disabled={working} onClick={() => { void useUpdateStore.getState().backToLatest() }}>Back to latest</Button>}
        </div>
        {listOpen && versionsLoading && <p className="q3-set__muted" role="status">Loading versions.</p>}
        {listOpen && versionsError !== '' && (
          <div>
            <p role="alert" className="q3-set__error">{versionsError}</p>
            <Button size="sm" variant="ghost" onClick={() => { void useUpdateStore.getState().loadVersions(true) }}>Try again</Button>
          </div>
        )}
        {listOpen && !versionsLoading && versionsError === '' && versions !== null && (
          versions.entries.length === 0
            ? <p className="q3-set__muted">No other versions are available to install.</p>
            : (
              <ul className="q3-up__vlist" aria-label="App versions">
                {versions.entries.map((e) => (
                  <li key={e.version} className="q3-up__vitem">
                    <button type="button" className="q3-up__vrow" disabled={!e.allowed || working || e.current} data-testid={`version-${e.version}`} onClick={() => setPick(e.version)}>
                      <span className="q3-up__vname">{e.version}</span>
                      <span className="q3-up__vmeta">{e.current ? 'Installed now' : [e.prerelease ? 'Early access' : '', e.publishedAt !== '' ? day(e.publishedAt) : ''].filter(Boolean).join(' - ')}</span>
                    </button>
                    {e.why !== '' && <p className="q3-up__vwhy">{e.why}</p>}
                  </li>
                ))}
              </ul>
            )
        )}
      </div>
      <ConfirmDialog
        open={pick !== ''} title="Change app version" message={pick !== '' ? rollbackConfirmText(state.currentVersion, pick) : ''} confirmLabel="Continue"
        onCancel={() => setPick('')}
        onConfirm={() => { const v = pick; setPick(''); void useUpdateStore.getState().chooseVersion(v) }}
      />
      <div className="q3-up__form">
        <label className="q3-up__check">
          <input type="checkbox" checked={state.auto} onChange={(e) => { void useUpdateStore.getState().setConfig({ auto: e.target.checked }) }} />
          <span>Check for updates in the background (shortly after start, then every 6 hours)</span>
        </label>
        <Select
          label="Update channel" value={state.channel}
          options={UPDATE_CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
          onChange={(e) => { void useUpdateStore.getState().setConfig({ channel: e.target.value as UpdateChannel }) }}
        />
        <Input label="Update address (optional)" value={feed} placeholder="Leave empty to use the built-in address. github:owner/repo or https://..." onChange={(e) => setFeed(e.target.value)} />
        <div className="q3-set__row">
          <Button size="sm" variant="ghost" onClick={() => { void useUpdateStore.getState().setConfig({ feedUrl: feed }) }}>Save address</Button>
        </div>
      </div>
      <p className="q3-set__muted">
        An update is downloaded in the background and installed only when you choose Restart to update. It never restarts the app while a bill is unsaved.
        Downloads are checked against the publisher's checksum before they can be installed.
      </p>
    </div>
  )
}
