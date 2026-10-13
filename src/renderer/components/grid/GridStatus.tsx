import { useGridUiStore } from '../../stores/gridUiStore'

/** Phase 11: the visible mode indicator for the grid (status line). APPEND = typing adds to the end; EDIT = free caret. */
export function GridStatus(): React.JSX.Element {
  const mode = useGridUiStore((s) => s.mode)
  const armed = useGridUiStore((s) => s.armed)
  const notice = useGridUiStore((s) => s.notice)
  const label = mode === 'append' ? 'APPEND' : mode === 'free' ? 'EDIT' : '—'
  return (
    <span className={`q3-gstatus q3-gstatus--${mode}`} role="status" aria-live="polite" data-mode={mode}>
      <strong>{label}</strong>
      {mode === 'append' && armed ? <span className="q3-gstatus__hint"> · press Left again to edit in place</span> : null}
      {notice ? <span className="q3-gstatus__notice"> · {notice}</span> : null}
    </span>
  )
}
