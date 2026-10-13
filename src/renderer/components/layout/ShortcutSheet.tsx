import { CONTEXT_KEY_HINTS, shortcutRows } from '@shared/shortcutList'
import { primaryKeys, type ActionGroup } from '@shared/shortcuts'
import { Button, Dialog, Kbd } from '../ui'

const GROUP_ORDER: ActionGroup[] = ['Navigate', 'Bill', 'Help', 'Developer']

/**
 * F1 / Ctrl+/ cheat-sheet. Lists EVERY registered action, generated from the registry: the ones with keys show their keys
 * (all of them), the ones without a key (Phase 67) show "Palette" and the keys that open the palette, so nothing is missing from the sheet.
 */
export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={onClose} footer={<Button variant="primary" onClick={onClose} data-autofocus>Close</Button>}>
      <div className="q3-sheet" tabIndex={0} role="region" aria-label="All keyboard shortcuts and palette actions">
        {GROUP_ORDER.map((group) => {
          const rows = shortcutRows().filter((r) => r.group === group)
          if (rows.length === 0) return null
          return (
            <section key={group} className="q3-sheet__group" aria-label={group}>
              <h3 className="q3-sheet__heading">{group}</h3>
              <dl className="q3-sheet__list">
                {rows.map((r) => (
                  <div key={r.action} className="q3-sheet__row" data-action={r.action}>
                    <dt>{r.label}</dt>
                    <dd>
                      {r.bindings.length === 0
                        ? <span className="q3-sheet__palette">Palette ({primaryKeys('palette.open') ?? 'Ctrl+K'})</span>
                        : r.bindings.map((b) => <Kbd key={`${b.scope}:${b.keys}`} keys={b.keys} />)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )
        })}
        <section className="q3-sheet__group" aria-label="Inside the grid, lists and dialogs">
          <h3 className="q3-sheet__heading">Inside the grid, lists and dialogs</h3>
          <dl className="q3-sheet__list">
            {CONTEXT_KEY_HINTS.map((h, i) => (
              <div key={i} className="q3-sheet__row" data-context-key="1">
                <dt>{h.where}: {h.does}</dt>
                <dd>{h.keys.map((k) => <Kbd key={k} keys={k} />)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  )
}
