import { ArrowLeft, ClockCounterClockwise, FilePdf, Image, PencilSimple, Printer, Trash, TrashSimple } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { Button } from '../ui'

export interface ActionBarProps {
  /** How many bills the actions act on (selection, else the highlighted one). */
  count: number
  busy?: boolean
  onOpenPdf: () => void
  onEdit: () => void
  onPrint: () => void
  onImage: () => void
  onDelete: () => void
  onBack: () => void
  /** Phase 43: open the Recently deleted view. */
  onTrash?: () => void
  /** Phase 44: open the revision panel for the highlighted bill. */
  onRevisions?: () => void
}

const key = (a: Parameters<typeof primaryKeys>[0]): { shortcut: string } | Record<string, never> => { const v = primaryKeys(a); return v ? { shortcut: v } : {} }

/**
 * Phase 42: the legacy bottom bar - Open PDF, Edit / Open, Print, Delete, Back (plus Copy image). Print, Edit, PDF and image need exactly
 * one bill; Delete takes the whole selection. Buttons keep the list's focus on mouse down, so keys keep working after a click.
 */
export function ActionBar({ count, onOpenPdf, onEdit, onPrint, onImage, onDelete, onBack, onTrash, onRevisions }: ActionBarProps): React.JSX.Element {
  const none = count === 0
  const many = count > 1
  const keep = (e: React.MouseEvent): void => e.preventDefault()
  const needOne = none ? 'Select a bill first' : many ? 'Select one bill' : undefined
  return (
    <div className="q3-hist__actions" role="toolbar" aria-label="Bill actions">
      <span className="q3-hist__selcount" aria-live="polite">{count > 1 ? `${count} bills selected` : ''}</span>
      <Button size="sm" icon={FilePdf} {...key('history.openPdf')} disabled={none || many} title={needOne ?? 'Save as PDF and open it'} onMouseDown={keep} onClick={onOpenPdf}>Open PDF</Button>
      <Button size="sm" icon={PencilSimple} {...key('history.open')} disabled={none || many} title={needOne ?? 'Open in Create to edit'} onMouseDown={keep} onClick={onEdit}>Edit / Open</Button>
      <Button size="sm" icon={Printer} {...key('output.printRough')} disabled={none || many} title={needOne ?? 'Print (Rough). Professional: Ctrl+Shift+P'} onMouseDown={keep} onClick={onPrint}>Print</Button>
      <Button size="sm" icon={Image} {...key('output.imageRough')} disabled={none || many} title={needOne ?? 'Copy as image (Rough). Professional: Ctrl+Shift+I'} onMouseDown={keep} onClick={onImage}>Copy image</Button>
      <Button size="sm" variant="danger" icon={Trash} {...key('history.delete')} disabled={none} title={none ? 'Select a bill first' : 'Delete (asks first)'} onMouseDown={keep} onClick={onDelete}>Delete</Button>
      {onRevisions && <Button size="sm" icon={ClockCounterClockwise} {...key('revisions.open')} disabled={none || many} title={needOne ?? 'Earlier versions of this bill - compare and restore'} onMouseDown={keep} onClick={onRevisions}>Revisions</Button>}
      {onTrash && <Button size="sm" icon={TrashSimple} {...key('history.trash')} title="Recently deleted - restore or delete forever" onMouseDown={keep} onClick={onTrash}>Recently deleted</Button>}
      <Button size="sm" icon={ArrowLeft} {...key('nav.back')} onMouseDown={keep} onClick={onBack}>Back</Button>
    </div>
  )
}
