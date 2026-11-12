import { useEffect, useState } from 'react'
import { Button, ConfirmDialog } from '../ui'
import { useAiAdminStore } from '../../stores/aiAdminStore'
import { AI_PRIVACY_LINE, aiDiagnosticsLine, describeAiStatus, describeIndexProgress, formatBytes, indexButtons } from '@shared/ai/aiAdmin'
import { DEFAULT_MODEL } from '@shared/ai/modelConfig'

/**
 * Phase 230 (M22) - Settings > AI. One honest place to see and control the local AI: status with the plain reason, the model, the four
 * switches (`ai.enabled` is the master), indexing progress with Pause / Resume, Rebuild index, Delete AI data, the privacy line and the
 * support line. With the master off nothing runs and every other AI control is greyed out.
 */
export function AiSection(): React.JSX.Element {
  const settings = useAiAdminStore((s) => s.settings)
  const admin = useAiAdminStore((s) => s.admin)
  const status = useAiAdminStore((s) => s.status)
  const error = useAiAdminStore((s) => s.error)
  const note = useAiAdminStore((s) => s.note)
  const busy = useAiAdminStore((s) => s.busy)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    void useAiAdminStore.getState().load()
    const t = setInterval(() => { void useAiAdminStore.getState().refresh() }, 3000)
    return () => clearInterval(t)
  }, [])
  const st = useAiAdminStore.getState
  const on = settings.enabled
  const desc = admin ? describeAiStatus(on, admin.status) : null
  const btn = admin ? indexButtons(on, admin.progress) : { pause: false, resume: false }
  const sw = (which: 'enabled' | 'billingPanel' | 'itemSuggestions' | 'sentenceSearch', label: string, disabled = false): React.JSX.Element => (
    <label className="q3-set__check">
      <input type="checkbox" checked={settings[which]} disabled={disabled} onChange={(e) => { void st().setSwitch(which, e.target.checked) }} />
      <span>{label}</span>
    </label>
  )
  return (
    <form className="q3-set__form" aria-label="AI" onSubmit={(e) => e.preventDefault()}>
      <p className="q3-set__muted">{AI_PRIVACY_LINE}</p>
      {sw('enabled', 'Use AI (master switch). Off = nothing runs and no AI appears anywhere.')}
      {sw('billingPanel', 'Show past purchases of the party while billing', !on)}
      {sw('itemSuggestions', 'Suggest item merges on the Items page', !on)}
      {sw('sentenceSearch', 'Understand plain sentences in search (re-order by meaning)', !on)}
      <p className="q3-set__muted" role="status" aria-label="AI status">
        {status === 'loading' || status === 'idle' ? 'Reading the AI state.' : desc ? `Status: ${desc.label}. ${desc.detail}` : error}
      </p>
      {admin && <p className="q3-set__muted">Model: {admin.status.modelId} ({DEFAULT_MODEL.dtype}), {formatBytes(admin.modelBytes)}.</p>}
      {admin && <p className="q3-set__muted" aria-label="Indexing progress">{describeIndexProgress(on, admin.progress)}</p>}
      <div className="q3-set__row">
        <Button onClick={() => { void st().pause() }} disabled={busy || !btn.pause}>Pause</Button>
        <Button onClick={() => { void st().resume() }} disabled={busy || !btn.resume}>Resume</Button>
        <Button onClick={() => { void st().rebuild() }} disabled={busy || !on}>Rebuild index</Button>
        <Button onClick={() => setConfirm(true)} disabled={busy || !admin || admin.vectors === 0}>Delete AI data</Button>
      </div>
      {admin && <p className="q3-set__muted" aria-label="AI diagnostics">{aiDiagnosticsLine(on, admin)}</p>}
      {(error !== '' && admin) || note !== '' ? <p role={error !== '' ? 'alert' : 'status'} className="q3-set__muted">{error || note}</p> : null}
      <ConfirmDialog open={confirm} title="Delete AI data?" danger confirmLabel="Delete"
        message="The saved item-name vectors are removed. Your bills, parties and items are not touched. Turn AI on and use Rebuild index to make them again."
        onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void st().deleteData() }} />
    </form>
  )
}
