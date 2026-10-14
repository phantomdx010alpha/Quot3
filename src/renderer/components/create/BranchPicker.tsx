import { useEffect, useState } from 'react'
import type { HistoryBranch } from '@shared/history/historyList'

/** Phase 149: the branch list for the Stock transfer header. Read once; no bridge (tests / design preview) = just the current value. */
function useBranchNames(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let live = true
    try {
      const h = (window as unknown as { quot3?: { history?: { branches?: () => Promise<{ ok: boolean; data?: HistoryBranch[] }> } } }).quot3?.history
      void h?.branches?.().then((r) => {
        if (!live || !r.ok || !r.data) return
        // Local branch first (the server already sorts it first), de-duplicated by name, blanks dropped.
        const seen = new Set<string>()
        const out: string[] = []
        for (const b of r.data) { const n = b.name.trim(); if (n !== '' && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push(n) } }
        setNames(out)
      }).catch(() => undefined)
    } catch { /* no bridge */ }
    return () => { live = false }
  }, [])
  return names
}

/**
 * Phase 149 (design 1.5): "Select branch for transfer" replaces the party fields on a Stock transfer. A plain select (keyboard: arrows
 * choose, Enter / Tab carry on to the grid). The choice is stored in `party.name` of the bill (no party record is made for it).
 */
export function BranchPicker({ value, selectRef, onChange, onKeyDown, onFocus }: {
  value: string
  selectRef: (el: HTMLSelectElement | null) => void
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLSelectElement>) => void
  onFocus?: () => void
}): React.JSX.Element {
  const names = useBranchNames()
  const options = value !== '' && !names.some((n) => n.toLowerCase() === value.toLowerCase()) ? [value, ...names] : names
  return (
    <label className="q3-pbar__f q3-pbar__f--branch">
      <span className="q3-pbar__l">Select branch for transfer</span>
      <select
        ref={selectRef} className="q3-input q3-pbar__in" value={value} data-party-field="name" data-testid="branch-picker"
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus}
      >
        <option value="">Select branch…</option>
        {options.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )
}
