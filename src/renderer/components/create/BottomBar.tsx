import type { ReactNode } from 'react'
import { ArrowUUpLeft, ArrowUUpRight, ClockCounterClockwise, ArrowCounterClockwise, FloppyDisk, FilePlus, Printer, Receipt, Image, ImageSquare, Table } from '@phosphor-icons/react'
import { redoTooltip, undoTooltip, REVERT_MESSAGE } from '@shared/history/historyView'
import { outputTooltip, type OutputActionId } from '@shared/outputActions'
import { primaryKeys } from '@shared/shortcuts'
import { ConfirmDialog, IconButton, Badge } from '../ui'
import { useBillStore } from '../../stores/billStore'
import { useGridUiStore } from '../../stores/gridUiStore'
import { useUndoUiStore } from '../../stores/undoUiStore'
import { confirmRevert, requestRevert, runRedo, runUndo } from '../../stores/undoActions'
import { runSave } from '../../stores/saveActions'
import { requestLeave } from '../../stores/guardStore'
import { startFreshBill } from '../../stores/createSession'
import { runOutput } from '../../stores/outputActions'
import { UndoPanel } from './UndoPanel'
import { QuietStatus } from './QuietStatus'

/** Phase 30: the stub output buttons, in bar order. They are aria-disabled (not `disabled`) so the tooltip with the reason still shows and a click or key reports it. */
const OUTPUT_BUTTONS: ReadonlyArray<readonly [OutputActionId, typeof Printer]> = [
  ['output.printRough', Printer],
  ['output.printPro', Receipt],
  ['output.imageRough', Image],
  ['output.imagePro', ImageSquare],
  ['output.tsv', Table]
]

const keep = (e: React.MouseEvent): void => e.preventDefault() // buttons never steal focus from the grid
const refocus = (): void => useGridUiStore.getState().refocus?.()

/**
 * Phase 18 — the undo/redo part of the Create page's bottom action bar (≤ 44 px): Undo, Redo (disabled when empty; the
 * tooltip names the NEXT action, "Undo: Paste"), History panel, Revert to last saved, an unsaved-changes badge, and a
 * slot for later phases (Phase 30 adds Save/Print/etc.). Also mounts the history panel and the revert confirmation,
 * so the global shortcuts (Ctrl+Shift+H, Ctrl+Alt+Z) have something to open wherever the bar is shown.
 * Buttons are out of the Tab order (the shortcuts + palette are the keyboard path); mousedown is prevented to keep the cell's caret.
 */
export function BottomBar({ children, actions = false }: { children?: ReactNode; actions?: boolean }): React.JSX.Element {
  const canUndo = useBillStore((s) => s.canUndo)
  const canRedo = useBillStore((s) => s.canRedo)
  const undoLabel = useBillStore((s) => s.undoLabel)
  const redoLabel = useBillStore((s) => s.redoLabel)
  const dirty = useBillStore((s) => s.dirty)
  const panelOpen = useUndoUiStore((s) => s.panelOpen)
  const revertOpen = useUndoUiStore((s) => s.revertOpen)
  const k = (a: Parameters<typeof primaryKeys>[0]): { shortcut: string } | Record<string, never> => { const v = primaryKeys(a); return v ? { shortcut: v } : {} }

  return (
    <div className="q3-bbar" role="toolbar" aria-label="Bill actions">
      <IconButton icon={ArrowUUpLeft} label={undoTooltip(undoLabel)} {...k('edit.undo')} tabIndex={-1} disabled={!canUndo}
        onMouseDown={keep} onClick={() => { runUndo(); refocus() }} />
      <IconButton icon={ArrowUUpRight} label={redoTooltip(redoLabel)} {...k('edit.redo')} tabIndex={-1} disabled={!canRedo}
        onMouseDown={keep} onClick={() => { runRedo(); refocus() }} />
      <IconButton icon={ClockCounterClockwise} label="Undo history" {...k('edit.historyPanel')} tabIndex={-1} active={panelOpen}
        onMouseDown={keep} onClick={() => useUndoUiStore.getState().togglePanel()} />
      <IconButton icon={ArrowCounterClockwise} label="Revert to last saved" {...k('edit.revert')} tabIndex={-1} disabled={!dirty}
        onMouseDown={keep} onClick={() => requestRevert()} />
      {actions ? (
        <>
          <span className="q3-bbar__sep" aria-hidden="true" />
          {OUTPUT_BUTTONS.map(([id, icon]) => (
            <IconButton key={id} icon={icon} label={outputTooltip(id)} {...k(id)} tabIndex={-1} aria-disabled={true} className="q3-iconbtn--stub"
              onMouseDown={keep} onClick={() => { runOutput(id); refocus() }} />
          ))}
          <span className="q3-bbar__sep" aria-hidden="true" />
          <IconButton icon={FilePlus} label="New bill" {...k('bill.new')} tabIndex={-1} onMouseDown={keep}
            onClick={() => { requestLeave(startFreshBill) }} />
          <IconButton icon={FloppyDisk} label="Save bill" {...k('bill.save')} tabIndex={-1} onMouseDown={keep}
            onClick={() => { void runSave(); refocus() }} />
        </>
      ) : null}
      {dirty ? <Badge tone="warn">Unsaved changes</Badge> : null}
      <QuietStatus />
      <div className="q3-bbar__slot">{children}</div>
      <UndoPanel />
      <ConfirmDialog
        open={revertOpen}
        title="Revert to last saved?"
        message={REVERT_MESSAGE}
        confirmLabel="Revert"
        onConfirm={() => { confirmRevert(); refocus() }}
        onCancel={() => { useUndoUiStore.getState().closeRevert(); refocus() }}
      />
    </div>
  )
}
