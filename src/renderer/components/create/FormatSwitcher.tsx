import { listFormats } from '@shared/format/registry'
import { canHybrid } from '@shared/hybrid/hybrid'
import { formatActionId, primaryKeys } from '@shared/shortcuts'
import { Tooltip } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { switchFormat } from '../../stores/formatActions'
import { enterHybrid } from '../../stores/hybridActions'

/**
 * Phase 20 — format indicator + switcher. Phase 156: ONE compact dropdown (a native select) instead of a row of segmented buttons, so the
 * Create bar leaves the room to the party name, phone and transport. One option per registered format (a new registry entry shows up with no
 * change here) plus Hybrid (a view, Phase 151); each option shows its shortcut. The select never keeps the keyboard: after a change the
 * grid cell gets its caret back, it sits outside the Tab order, and the real keyboard path stays the format's own shortcut (Alt+1..4) and the palette.
 */
export function FormatSwitcher(): React.JSX.Element {
  const formatId = useBillStore((s) => s.formatId)
  // Phase 151: Hybrid is a VIEW over a GST / Non-GST bill, not a registered format: its own option after the formats (Alt+3).
  const hybridOn = useBillStore((s) => s.hybrid?.active === true)
  const hybridOk = useBillStore((s) => canHybrid({ hybrid: s.hybrid, formatId: s.formatId }))
  const hybridKeys = primaryKeys('hybrid.toggle')
  const value = hybridOn ? 'hybrid' : formatId
  const onChange = (next: string): void => {
    const done = next === 'hybrid' ? enterHybrid() : switchFormat(next)
    if (done) useGridUiStore.getState().refocus?.()
  }
  return (
    <div className="q3-fmtsw" role="group" aria-label="Bill format">
      <Tooltip label="Bill format">
        <select
          className="q3-fmtsw__sel" aria-label="Bill format" tabIndex={-1} value={value}
          onChange={(e) => { onChange(e.target.value); e.target.blur() }}
        >
          {listFormats().map((f) => {
            const keys = primaryKeys(formatActionId(f.id))
            return <option key={f.id} value={f.id}>{keys ? `${f.label} (${keys})` : f.label}</option>
          })}
          <option value="hybrid" disabled={!hybridOk && !hybridOn}>{hybridKeys ? `Hybrid (${hybridKeys})` : 'Hybrid'}</option>
        </select>
      </Tooltip>
    </div>
  )
}
