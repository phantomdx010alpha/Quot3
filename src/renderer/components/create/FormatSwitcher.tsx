import { listFormats } from '@shared/format/registry'
import { canHybrid } from '@shared/hybrid/hybrid'
import { formatActionId, primaryKeys } from '@shared/shortcuts'
import { Tooltip, Kbd } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { switchFormat } from '../../stores/formatActions'
import { enterHybrid } from '../../stores/hybridActions'

/**
 * Phase 20 — format indicator + switcher: one segmented button per registered format (so a new registry entry shows up
 * with no change here). The active one is `aria-pressed`. Buttons never take focus (mousedown prevented → the cell keeps its
 * caret) and sit outside the Tab order: the keyboard path is the format's own shortcut (Alt+1 / Alt+2) and the palette.
 */
export function FormatSwitcher(): React.JSX.Element {
  const formatId = useBillStore((s) => s.formatId)
  // Phase 151: Hybrid is a VIEW over a GST / Non-GST bill, not a registered format: its own button after the formats (Alt+3).
  const hybridOn = useBillStore((s) => s.hybrid?.active === true)
  const hybridOk = useBillStore((s) => canHybrid({ hybrid: s.hybrid, formatId: s.formatId }))
  const hybridKeys = primaryKeys('hybrid.toggle')
  return (
    <div className="q3-fmtsw" role="group" aria-label="Bill format">
      {listFormats().map((f) => {
        const keys = primaryKeys(formatActionId(f.id))
        const active = f.id === formatId && !hybridOn
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
      <Tooltip label="Switch to Hybrid (GST and Non-GST side by side)" {...(hybridKeys ? { shortcut: hybridKeys } : {})}>
        <button
          type="button" className={`q3-fmtsw__btn${hybridOn ? ' q3-fmtsw__btn--active' : ''}`} aria-pressed={hybridOn} tabIndex={-1} disabled={!hybridOk && !hybridOn}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (enterHybrid()) useGridUiStore.getState().refocus?.() }}
        >
          Hybrid
          {hybridKeys ? <Kbd keys={hybridKeys} /> : null}
        </button>
      </Tooltip>
    </div>
  )
}
