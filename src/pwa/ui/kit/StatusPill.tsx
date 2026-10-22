import { useMemo, useState, type ReactElement } from 'react'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { statusModel, type StatusActionId, type StatusFlags } from './statusModel'

/** One status pill instead of stacked banners (Phase 191). The thin line shows while the phone is read-only; the pill opens a sheet that lists EVERY
 *  active notice with its action. `onAction` is wired by the layout to the same handlers App.tsx uses (Try again, Reload, Install, Not now). */
export function StatusPill(props: { flags: StatusFlags; onAction?: (id: StatusActionId) => void }): ReactElement | null {
  const { flags } = props
  const model = useMemo(() => statusModel(flags), [flags])
  const [open, setOpen] = useState(false)
  if (!model.pill && !model.readOnlyLine) return null
  const run = (id: StatusActionId): void => { setOpen(false); props.onAction?.(id) }
  return (
    <div className="q3x-status">
      {model.readOnlyLine ? <div className="q3x-readonly-line" role="alert">{model.readOnlyLine}</div> : null}
      {model.pill ? (
        <button type="button" className="q3x-pill" data-kind={model.pill.kind} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <span className="q3x-pill-label">{model.pill.label}</span>
          {model.pill.more > 0 ? <span className="q3x-pill-more">{`+${model.pill.more}`}</span> : null}
        </button>
      ) : null}
      <BottomSheet open={open} title="Notices" onClose={() => setOpen(false)}>
        <ul className="q3x-status-list">
          {model.all.map((n) => (
            <li key={n.kind} className="q3x-status-item" data-kind={n.kind}>
              <strong className="q3x-status-label">{n.label}</strong>
              <p className="q3x-status-text">{n.text}</p>
              {n.actions.length > 0 ? (
                <div className="q3x-status-actions">
                  {n.actions.map((a) => <Button key={a.id} label={a.label} variant={a.id === 'hideInstall' ? 'text' : 'secondary'} disabled={a.disabled} onClick={() => run(a.id)} />)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  )
}
