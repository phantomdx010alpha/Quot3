import { useEffect, useMemo } from 'react'
import { Lightbulb } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { panelView } from '@shared/ai/aiPanel'
import { IconButton } from '../ui'
import { useAiPanelStore } from '../../stores/aiPanelStore'
import { useBillStore } from '../../stores/billStore'

/** The editable text span of an item-NAME cell (both grids in Hybrid), or null. */
const NAME_CELL = '.q3-gc[data-col="name"] .q3-gc__text'
function nameCellOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof HTMLElement ? t.closest<HTMLElement>(NAME_CELL) : null
}

/**
 * Phase 226 (M22) - follows the grid from the OUTSIDE: passive listeners on the grid host read which item-name cell is active and what is typed
 * in it; the grid controller, its keystroke path and its cursor are never touched. Nothing here calls focus().
 */
function useActiveNameCell(host: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = host.current
    if (!el) return
    const st = useAiPanelStore.getState
    const onFocusIn = (e: Event): void => { const c = nameCellOf(e.target); st().setCell(c !== null, c?.textContent ?? '') }
    const onInput = (e: Event): void => { const c = nameCellOf(e.target); if (c) st().setCell(true, c.textContent ?? '') }
    let pending: ReturnType<typeof setTimeout> | null = null
    const onFocusOut = (): void => {
      // Moving between cells fires focusout then focusin; only hide when focus really left the item-name cells.
      if (pending !== null) clearTimeout(pending)
      pending = setTimeout(() => { pending = null; if (!nameCellOf(el.ownerDocument.activeElement)) st().setCell(false, '') }, 0)
    }
    el.addEventListener('focusin', onFocusIn, { passive: true })
    el.addEventListener('input', onInput, { passive: true })
    el.addEventListener('focusout', onFocusOut, { passive: true })
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('input', onInput)
      el.removeEventListener('focusout', onFocusOut)
      if (pending !== null) clearTimeout(pending)
      st().setCell(false, '')
    }
  }, [host])
}

/**
 * The purchase-history strip under the grid: what THIS party bought before that looks like the typed text, with its format, last rate, last
 * quantity and date. Display only: it never takes focus, never moves the grid cursor, never writes a cell (the accept key is an
 * unbuilt extension point, `acceptableName` in shared/ai/aiPanel.ts) and hides itself when there is nothing to show.
 */
export function AiHistoryPanel({ gridHost }: { gridHost: React.RefObject<HTMLElement | null> }): React.JSX.Element | null {
  const billId = useBillStore((s) => s.billId)
  const partyName = useBillStore((s) => s.party.name)
  const partyId = useBillStore((s) => s.meta.partyId)
  const enabled = useAiPanelStore((s) => s.enabled)
  const billingPanel = useAiPanelStore((s) => s.billingPanel)
  const cellActive = useAiPanelStore((s) => s.cellActive)
  const status = useAiPanelStore((s) => s.status)
  const suggestions = useAiPanelStore((s) => s.rows)

  useEffect(() => { void useAiPanelStore.getState().load() }, [])
  // A different bill: forget the cell and the old rows first, then take the new party (no stale rows after a bill switch).
  useEffect(() => { useAiPanelStore.getState().reset() }, [billId])
  useEffect(() => { useAiPanelStore.getState().setParty(partyId, partyName) }, [billId, partyId, partyName])
  useActiveNameCell(gridHost)

  const view = useMemo(() => panelView({ enabled, billingPanel, partyName, cellActive }, status, suggestions), [enabled, billingPanel, partyName, cellActive, status, suggestions])
  // Phase 254 (M24): nothing at all while the master AI switch is off (the panel's own switch is irrelevant then).
  if (!enabled || view.kind === 'hidden') return null
  return (
    <div className="q3-aipanel" role="region" aria-label="This party's earlier items" aria-live="polite" onMouseDown={(e) => e.preventDefault()}>
      {view.kind === 'notice' ? (
        <span className="q3-aipanel__note">{view.text}</span>
      ) : (
        <ul className="q3-aipanel__list">
          {view.rows.map((r) => (
            <li key={r.key} className="q3-aipanel__row">
              <span className="q3-aipanel__name">{r.name}</span>
              <span className="q3-aipanel__pill" data-gst={r.gst ? '1' : undefined}>{r.format}</span>
              <span className="q3-aipanel__cell">Rate {r.rate}</span>
              <span className="q3-aipanel__cell">Qty {r.qty}</span>
              <span className="q3-aipanel__cell">{r.date}</span>
              <span className="q3-aipanel__cell">{r.times}</span>
              <span className="q3-aipanel__chip">{r.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The visible on / off switch in the Create toolbar. Never takes focus (the cell keeps its caret); the key does the same thing.
 *  Phase 254 (M24): drawn ONLY while the master AI switch (`ai.enabled`) is on; with AI off it renders nothing (supersedes the Phase 226 "always visible" note). */
export function AiPanelSwitch(): React.JSX.Element | null {
  const enabled = useAiPanelStore((s) => s.enabled)
  const billingPanel = useAiPanelStore((s) => s.billingPanel)
  const keys = primaryKeys('ai.billingPanel.toggle')
  useEffect(() => { void useAiPanelStore.getState().load() }, [])
  if (!enabled) return null
  return (
    <IconButton icon={Lightbulb} label="Purchase history for this party" text="History AI" active={billingPanel} {...(keys ? { shortcut: keys } : {})} tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()} onClick={() => useAiPanelStore.getState().toggle()} />
  )
}
