import { useState } from 'react'
import { X } from '@phosphor-icons/react'
import type { QueryChip } from '@shared/ai/sentenceQuery'
import { chipSource, pickPartyText, removeChipText, replaceSpan, type SentenceView } from '@shared/ai/sentenceSearch'
import { Icon } from '../ui'

export interface SentenceChipsProps {
  view: SentenceView
  /** The edited sentence (the search box and the results follow it). */
  onChange: (text: string) => void
}

/**
 * Phase 229 (M22): how the typed sentence was understood. Each chip can be removed (x), or clicked to retype the words it came from
 * (Enter applies, Esc cancels); an ambiguous party shows its choices. Editing only rewrites the sentence, then the normal search
 * re-runs, so the chips can never disagree with the results. Chips never take focus until clicked.
 */
export function SentenceChips({ view, onChange }: SentenceChipsProps): React.JSX.Element | null {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const shown = view.chips.filter((c) => c.kind !== 'item' || view.chips.length > 1)
  if (shown.length === 0) return null

  const apply = (chip: QueryChip): void => { setEditing(null); onChange(replaceSpan(view.text, chip, draft)) }

  return (
    <div className="q3-hist__chips" role="group" aria-label="How the search was understood">
      {shown.map((c, i) => (
        <span key={`${c.kind}-${c.span.start}`} className={`q3-chip q3-chip--${c.kind}`}>
          {editing === i && c.kind !== 'item' ? (
            <input
              className="q3-chip__input"
              aria-label={`Change ${c.kind}`}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); apply(c) }
                else if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
              }}
              onBlur={() => setEditing(null)}
            />
          ) : (
            <button type="button" className="q3-chip__label" disabled={c.kind === 'item'} title={c.kind === 'item' ? undefined : 'Click to change'} onClick={() => { setDraft(chipSource(view.text, c)); setEditing(i) }}>
              {c.label}
            </button>
          )}
          {c.candidates && c.candidates.length > 1 && (
            <span className="q3-chip__choices">
              {c.candidates.map((p) => (
                <button key={p.id} type="button" className="q3-chip__choice" onClick={() => onChange(pickPartyText(view.text, c, p.name))}>{p.name}</button>
              ))}
            </span>
          )}
          {c.removable && (
            <button type="button" className="q3-chip__x" aria-label={`Remove ${c.kind}`} title="Remove" onClick={() => onChange(removeChipText(view.text, c))}>
              <Icon icon={X} weight="bold" size="sm" />
            </button>
          )}
        </span>
      ))}
      {view.reranked && <span className="q3-hist__note">Item matches sorted by meaning</span>}
      {view.formatUnknown > 0 && <span className="q3-hist__note">{`Format not known for ${view.formatUnknown} ${view.formatUnknown === 1 ? 'bill' : 'bills'} (kept)`}</span>}
    </div>
  )
}
