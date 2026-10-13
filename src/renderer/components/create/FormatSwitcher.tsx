import { listFormats } from '@shared/format/registry'
import { formatActionId, primaryKeys } from '@shared/shortcuts'
import { Tooltip, Kbd } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { switchFormat } from '../../stores/formatActions'

/**
 * Phase 20 — format indicator + switcher: one segmented button per registered format (so a new registry entry shows up
 * with no change here). The active one is `aria-pressed`. Buttons never take focus (mousedown prevented → the cell keeps its
 * caret) and sit outside the Tab order: the keyboard path is the format's own shortcut (Alt+1 / Alt+2) and the palette.
 */
export function FormatSwitcher(): React.JSX.Element {
  const formatId = useBillStore((s) => s.formatId)
  return (
    <div className="q3-fmtsw" role="group" aria-label="Bill format">
      {listFormats().map((f) => {
        const keys = primaryKeys(formatActionId(f.id))
        const active = f.id === formatId
        return (
          <Tooltip key={f.id} label={`Switch to ${f.label}`} {...(keys ? { shortcut: keys } : {})}>
            <button
              type="button" className={`q3-fmtsw__btn${active ? ' q3-fmtsw__btn--active' : ''}`} aria-pressed={active} tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (switchFormat(f.id)) useGridUiStore.getState().refocus?.() }}
            >
              {f.label}
              {keys ? <Kbd keys={keys} /> : null}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
