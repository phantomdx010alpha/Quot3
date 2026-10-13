import { useEffect, useRef } from 'react'
import { ArrowCounterClockwise, ClockCounterClockwise } from '@phosphor-icons/react'
import { formatHistoryDate, formatHistoryTotal } from '@shared/history/historyList'
import { describeDiff } from '@shared/diff/billDiff'
import { formatRevisionTime } from '@shared/revisions'
import { REVISION_MAX_PER_BILL } from '@shared/constants'
import { Badge, Button, Dialog, EmptyState } from '../ui'
import { useRevisionStore } from '../../stores/revisionStore'
import { restoreSelectedRevision } from '../../stores/revisionActions'
import { RevisionDiff } from './RevisionDiff'

const keep = (e: React.MouseEvent): void => e.preventDefault()

/**
 * Phase 44 - Revision history (undo layer L4). A modal mounted once in the app shell, so Ctrl+Shift+V works from Create and from History.
 * Left: the stored revisions, newest first. Right: the diff of the highlighted one (against the previous revision, or against the
 * current bill - key C). Up / Down / Home / End choose, Enter or R restores it AS AN UNSAVED CHANGE in Create, Esc closes.
 */
export function RevisionPanel(): React.JSX.Element | null {
  const s = useRevisionStore()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }) }, [s.selected])
  if (!s.open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const k = e.key
    if (k === 'ArrowDown') { e.preventDefault(); void s.moveSelection(1) }
    else if (k === 'ArrowUp') { e.preventDefault(); void s.moveSelection(-1) }
    else if (k === 'Home') { e.preventDefault(); void s.moveSelection(-1e9) }
    else if (k === 'End') { e.preventDefault(); void s.moveSelection(1e9) }
    else if (k === 'PageDown') { e.preventDefault(); void s.moveSelection(8) }
    else if (k === 'PageUp') { e.preventDefault(); void s.moveSelection(-8) }
    else if (k.toLowerCase() === 'c' && !e.shiftKey) { e.preventDefault(); void s.toggleMode() }
    else if (k === 'Enter' || k.toLowerCase() === 'r') { e.preventDefault(); restoreSelectedRevision() }
  }

  const sel = s.items.find((r) => r.revision === s.selected)
  const canRestore = sel !== undefined && !sel.isCurrent
  const summary = s.detail?.diff ? describeDiff(s.detail.diff) : ''

  return (
    <Dialog
      open
      wide
      title={`Revisions - ${s.poNumber}`}
      onClose={() => s.close()}
      footer={(
        <>
          <Button variant="primary" icon={ArrowCounterClockwise} disabled={!canRestore} title={canRestore ? 'Open this version in Create as an unsaved change (Enter)' : 'Already the current version'} onMouseDown={keep} onClick={() => { restoreSelectedRevision() }}>Restore this revision</Button>
          <Button onClick={() => s.close()}>Close</Button>
        </>
      )}
    >
      {s.status === 'loading' && <p className="q3-rev__none">Loading revisions...</p>}
      {s.status === 'error' && <p className="q3-rev__none" role="alert">{s.error}</p>}
      {s.status === 'ready' && s.items.length === 0 && <EmptyState icon={ClockCounterClockwise} title="No revisions yet" description="Revisions are stored every time the bill is saved." />}
      {s.status === 'ready' && s.items.length > 0 && (
        <div className="q3-rev" onKeyDown={onKeyDown}>
          <div ref={listRef} className="q3-rev__list" role="listbox" aria-label="Revisions" tabIndex={0} data-autofocus aria-activedescendant={s.selected === null ? undefined : `q3-rev-${s.selected}`}>
            {s.items.map((r) => (
              <div key={r.revision} id={`q3-rev-${r.revision}`} role="option" aria-selected={r.revision === s.selected} className={r.revision === s.selected ? 'q3-rev__item q3-rev__item--sel' : 'q3-rev__item'} onMouseDown={keep} onClick={() => { void s.select(r.revision) }}>
                <span className="q3-rev__no">#{r.revision}</span>
                <span className="q3-rev__when">{formatRevisionTime(r.savedAt)}</span>
                <span className="q3-rev__total">{formatHistoryTotal(r.grandTotal)}</span>
                {r.isCurrent && <Badge tone="accent">Current</Badge>}
                <span className="q3-rev__sub" title={r.partyName}>{r.partyName === '' ? '(no party)' : r.partyName} - {formatHistoryDate(r.billDate)} - {r.itemRowCount} item{r.itemRowCount === 1 ? '' : 's'}</span>
              </div>
            ))}
            <p className="q3-rev__cap">Newest {REVISION_MAX_PER_BILL} saves are kept.</p>
          </div>
          <div className="q3-rev__detail" aria-live="polite">
            <div className="q3-rev__modes" role="group" aria-label="Compare with">
              <Button size="sm" variant={s.mode === 'previous' ? 'primary' : 'secondary'} onMouseDown={keep} onClick={() => { void s.setMode('previous') }}>What this save changed</Button>
              <Button size="sm" variant={s.mode === 'current' ? 'primary' : 'secondary'} onMouseDown={keep} onClick={() => { void s.setMode('current') }}>Changes since (vs current)</Button>
              <span className="q3-rev__hint">C switches</span>
            </div>
            {summary !== '' && <p className="q3-rev__summary">{summary}</p>}
            {s.detailStatus === 'loading' && <p className="q3-rev__none">Comparing...</p>}
            {s.detailStatus === 'error' && <p className="q3-rev__none" role="alert">{s.detailError}</p>}
            {s.detailStatus === 'ready' && s.detail?.kind === 'first' && <p className="q3-rev__none">This is the oldest stored revision - there is nothing earlier to compare with.</p>}
            {s.detailStatus === 'ready' && s.detail?.kind === 'same' && <p className="q3-rev__none">This is the current version of the bill.</p>}
            {s.detailStatus === 'ready' && s.detail?.kind === 'diff' && s.detail.diff && <RevisionDiff diff={s.detail.diff} />}
          </div>
        </div>
      )}
    </Dialog>
  )
}
