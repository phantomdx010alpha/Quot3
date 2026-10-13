import { BookmarkSimple, ListNumbers, Minus, PencilSimple, Plus, Sigma } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { ConfirmDialog, IconButton } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { useExtraColUiStore } from '../../stores/extraColUiStore'
import { UnitsPopup } from './UnitsPopup'
import { confirmRemoveExtraCol, openUnitsPopup, runToggleMark, requestRemoveExtraCol, requestRenameExtraCol, runAddExtraCol } from '../../stores/extraColActions'

const keep = (e: React.MouseEvent): void => e.preventDefault() // buttons never steal focus from the grid
const refocus = (): void => useGridUiStore.getState().refocus?.()

/**
 * Phase 21 — "+Col / −Col" (and rename) buttons mirroring Ctrl+Alt+= / Ctrl+Alt+− / Ctrl+Alt+R, plus the confirmation shown
 * when removing a column that holds data. Mounted wherever the bill grid is shown so the global shortcuts have a dialog
 * to open. Buttons are out of the Tab order (shortcuts + palette are the keyboard path) and keep the cell's caret.
 */
export function ExtraColsToolbar(): React.JSX.Element {
  const cols = useBillStore((s) => s.extraCols)
  const removeKey = useExtraColUiStore((s) => s.removeKey)
  const name = cols.find((c) => c.key === removeKey)?.header ?? ''
  const k = (a: Parameters<typeof primaryKeys>[0]): { shortcut: string } | Record<string, never> => { const v = primaryKeys(a); return v ? { shortcut: v } : {} }
  return (
    <div className="q3-colbar" role="toolbar" aria-label="Extra columns">
      <IconButton icon={Plus} label="Add extra column" {...k('cols.add')} tabIndex={-1} onMouseDown={keep} onClick={() => { runAddExtraCol(); refocus() }} />
      <IconButton icon={Minus} label="Remove extra column" {...k('cols.remove')} tabIndex={-1} disabled={cols.length === 0} onMouseDown={keep}
        onClick={() => { requestRemoveExtraCol(); if (!useExtraColUiStore.getState().removeKey) refocus() }} />
      <IconButton icon={PencilSimple} label="Rename extra column" {...k('cols.rename')} tabIndex={-1} disabled={cols.length === 0} onMouseDown={keep}
        onClick={() => requestRenameExtraCol()} />
      <IconButton icon={BookmarkSimple} label="Mark / unmark cell" {...k('units.mark')} tabIndex={-1} disabled={cols.length === 0} onMouseDown={keep}
        onClick={() => { runToggleMark(); refocus() }} />
      <IconButton icon={Sigma} label="Units summary" {...k('units.summary')} tabIndex={-1} disabled={cols.length === 0} onMouseDown={keep} onClick={() => openUnitsPopup('units')} />
      <IconButton icon={ListNumbers} label="Marked calculations" {...k('units.marked')} tabIndex={-1} disabled={cols.length === 0} onMouseDown={keep} onClick={() => openUnitsPopup('marked')} />
      <UnitsPopup />
      <ConfirmDialog
        open={removeKey !== null}
        title={`Remove column '${name}'?`}
        message="This column has entries. Removing it deletes them from the bill; Ctrl+Z brings the column and every entry back."
        confirmLabel="Remove"
        danger
        onConfirm={() => { confirmRemoveExtraCol(); refocus() }}
        onCancel={() => { useExtraColUiStore.getState().closeRemove(); refocus() }}
      />
    </div>
  )
}
