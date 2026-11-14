import { formatHistoryTotal } from '@shared/history/historyList'
import { barHeights, monthLabel, type MonthTotal } from '@shared/dashboard/dashboardStats'

const W = 220
const H = 40
const GAP = 6

/** Phase 251 - the small monthly graph: one bar per month (oldest left, this month right), each bar with a title ("Oct: Rs 1,200.00, 3 bills"). Display only; amounts stay strings. */
export function MonthBars({ months }: { months: readonly MonthTotal[] }): React.JSX.Element | null {
  if (months.length === 0) return null
  const hs = barHeights(months.map((m) => m.total), H)
  const bw = (W - GAP * (months.length - 1)) / months.length
  const label = `Last ${months.length} months: ${months.map((m) => `${monthLabel(m.month)} ${formatHistoryTotal(m.total)}`).join(', ')}`
  return (
    <figure className="q3-spark q3-monthbars" aria-label={`Billed in the last ${months.length} months`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} preserveAspectRatio="none">
        {months.map((m, i) => (
          <rect
            key={m.month}
            className={i === months.length - 1 ? 'q3-monthbars__bar q3-monthbars__bar--now' : 'q3-monthbars__bar'}
            x={i * (bw + GAP)} y={H - hs[i]!} width={bw} height={hs[i]}
          >
            <title>{`${monthLabel(m.month)}: ${formatHistoryTotal(m.total)}, ${m.count} ${m.count === 1 ? 'bill' : 'bills'}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="q3-spark__axis" aria-hidden="true">{months.map((m) => <span key={m.month}>{monthLabel(m.month).slice(0, 1)}</span>)}</figcaption>
    </figure>
  )
}
