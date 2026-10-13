import type { BillDiff, FieldChange, RowDiff } from '@shared/diff/billDiff'
import { Badge } from '../ui'

const TONE = { added: 'ok', removed: 'danger', changed: 'warn', moved: 'info' } as const
const WORD = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' } as const

function Change({ c }: { c: FieldChange }): React.JSX.Element {
  return (
    <li className="q3-rev__change">
      <span className="q3-rev__field">{c.label}</span>
      <span className="q3-rev__before" title={c.before}>{c.before === '' ? '(empty)' : c.before}</span>
      <span className="q3-rev__arrow" aria-hidden="true">{'->'}</span>
      <span className="q3-rev__after" title={c.after}>{c.after === '' ? '(empty)' : c.after}</span>
    </li>
  )
}

function Section({ title, changes }: { title: string; changes: FieldChange[] }): React.JSX.Element | null {
  if (changes.length === 0) return null
  return (
    <section className="q3-rev__section" aria-label={title}>
      <h3 className="q3-rev__h">{title}</h3>
      <ul className="q3-rev__changes">{changes.map((c) => <Change key={c.field + c.before + c.after} c={c} />)}</ul>
    </section>
  )
}

function RowBlock({ r }: { r: RowDiff }): React.JSX.Element {
  const no = r.kind === 'removed' ? `row ${r.beforeNo}` : r.beforeNo !== null && r.afterNo !== null && r.beforeNo !== r.afterNo ? `row ${r.beforeNo} -> ${r.afterNo}` : `row ${r.afterNo}`
  return (
    <li className={`q3-rev__row q3-rev__row--${r.kind}`}>
      <div className="q3-rev__rowhead">
        <Badge tone={TONE[r.kind]}>{WORD[r.kind]}</Badge>
        <span className="q3-rev__rowno">{no}</span>
        <span className="q3-rev__rowname" title={r.name}>{r.name === '' ? '(no item name)' : r.name}</span>
      </div>
      {r.changes.length > 0 && <ul className="q3-rev__changes">{r.changes.map((c) => <Change key={c.field} c={c} />)}</ul>}
    </li>
  )
}

/** Phase 44: the inline diff - bill fields, party, extra columns, then every added / removed / changed / moved row. Presentational. */
export function RevisionDiff({ diff }: { diff: BillDiff }): React.JSX.Element {
  if (diff.identical) return <p className="q3-rev__none">No differences.</p>
  return (
    <div className="q3-rev__diff">
      <Section title="Bill" changes={diff.bill} />
      <Section title="Party" changes={diff.party} />
      <Section title="Extra columns" changes={diff.extraCols} />
      {diff.rows.length > 0 && (
        <section className="q3-rev__section" aria-label="Rows">
          <h3 className="q3-rev__h">Rows ({diff.rows.length})</h3>
          <ul className="q3-rev__rows">{diff.rows.map((r) => <RowBlock key={`${r.kind}-${r.rowId}`} r={r} />)}</ul>
        </section>
      )}
    </div>
  )
}
