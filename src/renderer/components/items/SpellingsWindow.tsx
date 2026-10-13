import { useEffect, useRef } from 'react'
import type { SpellingRow } from '@shared/items/groupRows'
import { formatHistoryDate } from '@shared/history/historyList'

export interface SpellingsWindowProps {
  rows: readonly SpellingRow[]
  cursor: number
  /** Name of the selected group ('' = none selected). */
  groupName: string
  /** The spelling being moved (outlined). */
  movingKey: string | null
  onCursor: (i: number) => void
}

const KIND_LABEL: Record<string, string> = { typo: 'Typo?', plural: 'Plural?', 'one-word': 'Close?' }

/** Phase 113 - Window 2: the spellings of the selected item (count, last used, why it is here), then the suggested merges. Not virtualised: one item has few spellings. */
export function SpellingsWindow({ rows, cursor, groupName, movingKey, onCursor }: SpellingsWindowProps): React.JSX.Element {
  const cur = useRef<HTMLDivElement | null>(null)
  useEffect(() => { cur.current?.scrollIntoView?.({ block: 'nearest' }) }, [cursor, rows])
  if (groupName === '') return <div className="q3-items__note">Select an item in Groups.</div>
  const firstSuggestion = rows.findIndex((r) => r.kind === 'suggestion')
  return (
    <div role="grid" aria-label={`Spellings of ${groupName}`} aria-rowcount={rows.length}>
      {rows.map((r, i) => {
        const sel = i === cursor
        const head = i === firstSuggestion ? <div className="q3-items__sub" role="presentation">Suggested merges</div> : null
        if (r.kind === 'spelling') {
          const s = r.spelling
          return (
            <div key={r.key}>
              <div
                ref={sel ? cur : undefined}
                role="row"
                aria-selected={sel}
                className={`q3-items__row q3-items__row--spelling${s.originalKey === movingKey ? ' q3-items__row--mark' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); (e.currentTarget.closest('.q3-items__content') as HTMLElement | null)?.focus(); onCursor(i) }}
              >
                <span role="gridcell" title={s.note ? `${s.name} (${s.note})` : s.name}>{s.name}</span>
                <span role="gridcell" className="q3-items__num" title="Times used">{s.count}</span>
                <span role="gridcell" className="q3-items__muted">{s.lastUsed ? formatHistoryDate(s.lastUsed) : ''}</span>
                <span role="gridcell" className="q3-items__muted" title={s.why.text || s.why.rule}>{s.why.text || (s.why.rule === 'most-used' ? 'Most used spelling' : '')}</span>
              </div>
            </div>
          )
        }
        const x = r.suggestion
        return (
          <div key={r.key}>
            {head}
            <div
              ref={sel ? cur : undefined}
              role="row"
              aria-selected={sel}
              className="q3-items__row q3-items__row--suggestion"
              onMouseDown={(e) => { e.preventDefault(); (e.currentTarget.closest('.q3-items__content') as HTMLElement | null)?.focus(); onCursor(i) }}
            >
              <span role="gridcell" className="q3-items__muted">{KIND_LABEL[x.kind] ?? 'Suggested'}</span>
              <span role="gridcell" title={`${x.text}. Merge ${r.fromName} (${x.fromCount}) into ${r.intoName} (${x.toCount})`}>{r.fromName} &rarr; {r.intoName}</span>
              <span role="gridcell" className="q3-items__muted" title={x.text}>{x.text}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
