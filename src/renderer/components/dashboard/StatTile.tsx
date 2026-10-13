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
