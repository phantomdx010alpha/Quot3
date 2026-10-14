import { Drop, HighlighterCircle, TextB, TextAa, Eraser } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import type { FormatKind } from '@shared/richtext/format'
import { toolbarName, type ToolbarNameId } from '@shared/toolbarNames'
import { IconButton } from '../ui'
import { useGridUiStore } from '../../stores/gridUiStore'

const ITEMS: ReadonlyArray<{ kind: FormatKind; label: string; icon: PhosphorIcon; action: ToolbarNameId }> = [
  { kind: 'redBold', label: 'Red + Bold', icon: Drop, action: 'grid.redBold' },
  { kind: 'bold', label: 'Bold', icon: TextB, action: 'grid.bold' },
  { kind: 'clear', label: 'Clear formatting', icon: Eraser, action: 'grid.clearFormat' },
  { kind: 'highlight', label: 'Highlight cell', icon: HighlighterCircle, action: 'grid.highlight' }
]

/**
 * Phase 15 — toolbar mirroring the formatting shortcuts (Red+Bold, Bold, Clear, Highlight) plus the palette button.
 * Buttons never take focus (mousedown is prevented), so the cell's caret/selection stays put; the click then formats it.
 * Keyboard users have the shortcuts and the palette (Ctrl+Shift+K), so the buttons are out of the Tab order.
 */
export function FormatToolbar(): React.JSX.Element {
  const hasGrid = useGridUiStore((s) => s.format !== null)
  const run = (kind: FormatKind): void => { const st = useGridUiStore.getState(); st.format?.(kind); st.refocus?.() }
  return (
    <div className="q3-fmtbar" role="toolbar" aria-label="Item name formatting">
      {ITEMS.map((it) => {
        const keys = primaryKeys(it.action)
        return (
          <IconButton key={it.kind} icon={it.icon} label={it.label} text={toolbarName(it.action)} {...(keys ? { shortcut: keys } : {})} tabIndex={-1} disabled={!hasGrid}
            onMouseDown={(e) => e.preventDefault()} onClick={() => run(it.kind)} />
        )
      })}
      <IconButton icon={TextAa} label="Format palette" text={toolbarName('grid.formatPalette')} {...(primaryKeys('grid.formatPalette') ? { shortcut: primaryKeys('grid.formatPalette') as string } : {})} tabIndex={-1} disabled={!hasGrid}
        onMouseDown={(e) => e.preventDefault()} onClick={() => useGridUiStore.getState().openFormatPalette?.()} />
    </div>
  )
}
