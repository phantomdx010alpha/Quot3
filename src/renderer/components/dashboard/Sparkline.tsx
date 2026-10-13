import { formatHistoryTotal } from '@shared/history/historyList'
import { sparklinePoints, weekdayLabel, type DayTotal } from '@shared/dashboard/dashboardStats'

const W = 220
const H = 48
const PAD = 4

/** Last seven days of billed totals as a simple SVG polyline with a dot per day; each dot carries a title ("Fri: ₹1,200.00, 3 bills"). */
export function Sparkline({ week }: { week: readonly DayTotal[] }): React.JSX.Element {
  const pts = sparklinePoints(week.map((d) => d.total), W - PAD * 2, H - PAD * 2).map((p) => ({ x: p.x + PAD, y: p.y + PAD }))
  const label = `Last 7 days: ${week.map((d) => `${weekdayLabel(d.date)} ${formatHistoryTotal(d.total)}`).join(', ')}`
  return (
    <figure className="q3-spark" aria-label="Billed in the last 7 days">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} preserveAspectRatio="none">
        <polyline className="q3-spark__line" fill="none" points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} />
        {pts.map((p, i) => (
          <circle key={week[i]!.date} className={i === pts.length - 1 ? 'q3-spark__dot q3-spark__dot--today' : 'q3-spark__dot'} cx={p.x} cy={p.y} r={2.5}>
            <title>{`${weekdayLabel(week[i]!.date)}: ${formatHistoryTotal(week[i]!.total)}, ${week[i]!.count} ${week[i]!.count === 1 ? 'bill' : 'bills'}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="q3-spark__axis" aria-hidden="true">{week.map((d) => <span key={d.date}>{weekdayLabel(d.date).slice(0, 1)}</span>)}</figcaption>
    </figure>
  )
}
