import { useEffect, useState } from 'react'
import { UPDATE_CHANNELS, describeUpdate, type UpdateChannel } from '@shared/updater'
import { Button, Input, Select } from '../ui'
import { restartToUpdate, useUpdateStore } from '../../stores/updateStore'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Phase 62 - Settings > Updates: Check now, progress, Restart to update, automatic checks, channel, optional feed address. */
export function UpdatesSection(): React.JSX.Element {
  const { state, error, busy } = useUpdateStore()
  const [feed, setFeed] = useState('')
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
          ? <Button variant="primary" onClick={() => restartToUpdate()}>Restart to update</Button>
          : <Button variant="primary" disabled={working || unavailable} onClick={() => { void useUpdateStore.getState().check() }}>Check for updates</Button>}
      </div>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
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
