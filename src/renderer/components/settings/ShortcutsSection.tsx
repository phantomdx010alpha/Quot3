import { useMemo, useState } from 'react'
import { searchShortcutRows, shortcutRows } from '@shared/shortcutList'
import { Input, Kbd } from '../ui'

/** Phase 49 - read-only, searchable list of every action and its keys. Rebinding is not offered (open question for the owner). */
export function ShortcutsSection(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const all = useMemo(() => shortcutRows(), [])
  const rows = useMemo(() => searchShortcutRows(all, query), [all, query])
  return (
    <div className="q3-set__shortcuts" aria-label="Keyboard shortcuts">
      <Input label="Search shortcuts" value={query} autoFocus placeholder="Type an action, a key or a page" onChange={(e) => setQuery(e.target.value)} hint={`${rows.length} of ${all.length} actions. Ctrl+K opens the command palette from anywhere.`} />
      {rows.length === 0 ? (
        <p className="q3-set__muted" role="status">No shortcut matches that.</p>
      ) : (
        <div className="q3-sc__scroll" tabIndex={0} role="region" aria-label="Shortcut list">
          <table className="q3-sc">
            <thead><tr><th scope="col">Action</th><th scope="col">Keys</th><th scope="col">Where</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action}>
                  <td>{r.label}</td>
                  <td>{r.bindings.length === 0 ? <span className="q3-set__muted">Palette only</span> : r.bindings.map((b) => <Kbd key={`${b.scope}:${b.keys}`} keys={b.keys} />)}</td>
                  <td className="q3-set__muted">{r.bindings.map((b) => b.scope).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
