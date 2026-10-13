import { useEffect, useRef, useState } from 'react'
import { Trash, ArrowCounterClockwise } from '@phosphor-icons/react'
import { draftLabel } from '@shared/draft'
import { Button, ConfirmDialog, Icon } from '../ui'
import { useDraftStore } from '../../stores/draftStore'

/**
 * Phase 29 — "Recover unsaved bill — party, time" on the Dashboard. One button per draft (Enter opens it on Create with a fresh
 * undo history) and a Discard button that asks first. Nothing renders when there is nothing to recover and no message.
 */
export function DraftRecovery({ now }: { now?: Date } = {}): React.JSX.Element | null {
  const drafts = useDraftStore((s) => s.drafts)
  const message = useDraftStore((s) => s.message)
  const wantFocus = useDraftStore((s) => s.wantFocus)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const box = useRef<HTMLElement>(null)

  useEffect(() => { void useDraftStore.getState().load() }, [])
  useEffect(() => {
    if (!wantFocus) return
    box.current?.querySelector<HTMLButtonElement>('[data-draft-id]')?.focus()
    useDraftStore.getState().consumeFocus()
  }, [wantFocus, drafts.length])

  if (drafts.length === 0 && message === '') return null
  const at = now ?? new Date()
  const target = drafts.find((d) => d.id === confirmId)
  return (
    <section ref={box} className="q3-drafts" aria-label="Unsaved bills" data-testid="draft-recovery">
      {drafts.length > 0 && <h2 className="q3-drafts__title">Unsaved bills</h2>}
      {drafts.map((d) => (
        <div key={d.id} className="q3-drafts__row">
          <Button
            variant="primary"
            icon={ArrowCounterClockwise}
            className="q3-drafts__recover"
            data-draft-id={d.id}
            onClick={() => { void useDraftStore.getState().recover(d.id) }}
          >
            {draftLabel(d, at)}
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Discard unsaved bill ${d.partyName}`} onClick={() => setConfirmId(d.id)}>
            <Icon icon={Trash} />
          </Button>
        </div>
      ))}
      {message !== '' && <p className="q3-page__hint" role="status">{message}</p>}
      <ConfirmDialog
        open={target !== undefined}
        danger
        title="Discard unsaved bill?"
        message={target ? `The unsaved bill for ${target.partyName === '' ? '(no party name)' : target.partyName} will be deleted for good.` : ''}
        confirmLabel="Discard"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { const id = confirmId; setConfirmId(null); if (id) void useDraftStore.getState().remove(id) }}
      />
    </section>
  )
}
