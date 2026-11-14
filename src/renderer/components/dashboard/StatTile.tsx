export interface StatTileProps { label: string; value: string; sub?: string }

/** One headline number (label, big value, small caption). */
export function StatTile({ label, value, sub }: StatTileProps): React.JSX.Element {
  return (
    <div className="q3-stat nm-inset nm-sm" role="group" aria-label={label}>
      <span className="q3-stat__label">{label}</span>
      <span className="q3-stat__value">{value}</span>
      {sub !== undefined && <span className="q3-stat__sub">{sub}</span>}
    </div>
  )
}

export interface StatPairProps { title: string; first: StatTileProps; second: StatTileProps }

/**
 * Phase 251 - two headline numbers in ONE tile (Today + This month). Each figure keeps its own labelled group, so the
 * `Today` / `This month` hooks (aria-label, text) are the same as the two separate tiles had.
 */
export function StatPair({ title, first, second }: StatPairProps): React.JSX.Element {
  const one = ({ label, value, sub }: StatTileProps): React.JSX.Element => (
    <div className="q3-stat q3-stat--in" role="group" aria-label={label}>
      <span className="q3-stat__label">{label}</span>
      <span className="q3-stat__value">{value}</span>
      {sub !== undefined && <span className="q3-stat__sub">{sub}</span>}
    </div>
  )
  return (
    <section className="q3-stats__panel q3-stats__panel--pair nm-inset nm-sm" aria-label={title}>
      {one(first)}
      {one(second)}
    </section>
  )
}
