import { useEffect, useState } from 'react'
import { PO_PREFIX_MAX, previewPo, validatePoPrefix } from '@shared/settings/appSettings'
import { Button, Input } from '../ui'
import { useSettingsStore } from '../../stores/settingsStore'

/** The local branch's PO prefix. Applies to NEW bills only; saved bills keep their number. */
export function BranchSection(): React.JSX.Element {
  const data = useSettingsStore((s) => s.data)!
  const { saving, error } = useSettingsStore()
  const b = data.branch
  const [prefix, setPrefix] = useState(b?.prefix ?? '')
  useEffect(() => { setPrefix(b?.prefix ?? '') }, [b?.prefix])
  if (!b) return <p className="q3-set__muted">No branch is set up yet.</p>
  const check = validatePoPrefix(prefix, b.otherPrefixes)
  const changed = check.ok && check.prefix !== b.prefix
  return (
    <form className="q3-set__form" onSubmit={(e) => { e.preventDefault(); if (check.ok) void useSettingsStore.getState().savePrefix(prefix) }} aria-label="Branch and PO prefix">
      <p className="q3-set__muted">Branch: {b.name}</p>
      <Input label="PO prefix" value={prefix} maxLength={PO_PREFIX_MAX + 4} autoFocus onChange={(e) => { setPrefix(e.target.value); useSettingsStore.getState().clearError() }} {...(!check.ok ? { error: check.message } : { hint: 'Letters, digits and - _ / (up to 8). Saved in capitals.' })} />
      <p className="q3-set__preview-po" aria-live="polite">
        Next bill: <strong>{check.ok ? previewPo(check.prefix, b.nextSeq) : previewPo(b.prefix, b.nextSeq)}</strong>
        {changed && <span className="q3-set__muted"> (now {previewPo(b.prefix, b.nextSeq)})</span>}
      </p>
      <p className="q3-set__muted">Only new bills use the new prefix. Bills already saved keep the number they have, and the counter carries on from {b.nextSeq}.</p>
      {error !== '' && <p role="alert" className="q3-set__error">{error}</p>}
      <div className="q3-set__row"><Button type="submit" variant="primary" disabled={saving || !changed || data.readOnly}>Save prefix</Button></div>
    </form>
  )
}
