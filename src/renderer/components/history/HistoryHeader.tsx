import { ArrowsClockwise } from '@phosphor-icons/react'
import type { HistoryBranch } from '@shared/history/historyList'
import { Icon } from '../ui'

export interface HistoryHeaderProps {
  branches: readonly HistoryBranch[]
  /** Phase 59: `'all'` or a branch id. */
  branch?: string
  onBranch?: (branch: string) => void
  total: number
  loading: boolean
  onRefresh: () => void
}

/** Title row: page title, the branch filter (This branch / All branches / one other branch; disabled while only one branch is known) and Refresh. */
export function HistoryHeader({ branches, branch = 'all', onBranch, total, loading, onRefresh }: HistoryHeaderProps): React.JSX.Element {
  const local = branches.find((b) => b.isLocal) ?? branches[0]
  return (
    <header className="q3-hist__head">
      <h1 className="q3-hist__title">All Bills</h1>
      <span className="q3-hist__count" aria-live="polite">{total} {total === 1 ? 'bill' : 'bills'}</span>
      <label className="q3-hist__branch">
        <span>Branch</span>
        <select className="q3-select nm-inset nm-sm" disabled={branches.length < 2 || !onBranch} aria-label="Branch filter" title={branches.length < 2 ? 'Other branches appear here once sync brings their bills' : 'Show bills of one branch or all branches'} value={branches.length < 2 ? (local?.id ?? '') : branch} onChange={(e) => onBranch?.(e.target.value)}>
          {branches.length < 2 ? <option value={local?.id ?? ''}>{local ? local.name : 'Local'}</option> : (
            <>
              <option value="all">All branches</option>
              {local && <option value={local.id}>{`This branch (${local.name})`}</option>}
              {branches.filter((b) => !b.isLocal).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </>
          )}
        </select>
      </label>
      <button type="button" className="q3-hist__refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh History" title="Refresh (palette: Refresh the bills list)">
        <Icon icon={ArrowsClockwise} weight="bold" size="sm" />
        <span>Refresh</span>
      </button>
    </header>
  )
}
