import { useEffect, useMemo } from 'react'
import { Tag } from '@phosphor-icons/react'
import { primaryKeys } from '@shared/shortcuts'
import { stripView, nextBillingMode } from '@shared/pricelist/billing'
import { tierForFormat } from '@shared/pricelist/settings'
import { IconButton } from '../ui'
import { usePriceStripStore, billingOn } from '../../stores/priceStripStore'
import { useBillStore } from '../../stores/billStore'
import { useAiPanelStore } from '../../stores/aiPanelStore'
import type { TableSide } from '../../stores/tableApi'

const NAME_CELL = '.q3-gc[data-col="name"] .q3-gc__text'
const RATE_CELL = '.q3-gc[data-col="rate"]'
const hit = (t: EventTarget | null, sel: string): HTMLElement | null => (t instanceof HTMLElement ? t.closest<HTMLElement>(sel) : null)
/** Which table and row a cell belongs to (Hybrid: the pane says which side). */
function whereOf(cell: HTMLElement): { side: TableSide; rowId: string } | null {
  const rowId = cell.closest<HTMLElement>('[data-row-id]')?.getAttribute('data-row-id')
  if (!rowId) return null
  const side: TableSide = cell.closest('.q3-hy-pane')?.getAttribute('data-side') === 'second' ? 'second' : 'primary'
  return { side, rowId }
}

/**
 * Phase 240 (M23) - follows the grid from the OUTSIDE (passive listeners, like the M22 panel): which item-name cell is active, what is
 * typed, whether that cell was EDITED in this visit, and whether the Rate cell was typed in. When the cursor leaves an edited item-name
 * cell, the store decides the fill. Nothing here calls focus(), moves the cursor, runs per keystroke work beyond a state write, or touches
 * the grid controller. Opening a saved bill, arrowing over cells, and pasted names never fill (no input event, or a paste flag).
 */
function useGridWatch(host: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = host.current
    if (!el) return
    const st = usePriceStripStore.getState
    let cur: { side: TableSide; rowId: string } | null = null
    let dirty = false
    let pasted = false
    const leave = (): void => { if (cur && dirty && !pasted) st().leaveName(cur.side, cur.rowId); cur = null; dirty = false; pasted = false }
    const onFocusIn = (e: Event): void => {
      const c = hit(e.target, NAME_CELL)
      if (!c) return
      const w = whereOf(c)
      if (!w) return
      if (!cur || cur.rowId !== w.rowId || cur.side !== w.side) { leave(); cur = w; dirty = false; pasted = false }
      void st().load()
      st().setCell(w, c.textContent ?? '')
    }
    const onInput = (e: Event): void => {
      const n = hit(e.target, NAME_CELL)
      if (n) { dirty = true; st().setTyped(n.textContent ?? ''); return }
      const r = hit(e.target, RATE_CELL)
      const w = r ? whereOf(r) : null
      if (w) st().rateTyped(w.side, w.rowId)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const r = hit(e.target, RATE_CELL)
      const w = r ? whereOf(r) : null
      if (w) st().rateTyped(w.side, w.rowId)
    }
    const onPaste = (e: Event): void => {
      if (hit(e.target, NAME_CELL)) pasted = true
      const r = hit(e.target, RATE_CELL)
      const w = r ? whereOf(r) : null
      if (w) st().rateTyped(w.side, w.rowId)
    }
    let pending: ReturnType<typeof setTimeout> | null = null
    const onFocusOut = (e: Event): void => {
      if (!hit(e.target, NAME_CELL)) return
      // The cell was left: decide now (focusin of the next name cell, if any, follows and starts a new visit).
      leave()
      if (pending !== null) clearTimeout(pending)
      pending = setTimeout(() => { pending = null; if (!hit(el.ownerDocument.activeElement, NAME_CELL)) st().setCell(null, '') }, 0)
    }
    el.addEventListener('focusin', onFocusIn, { passive: true })
    el.addEventListener('input', onInput, { passive: true })
    el.addEventListener('keydown', onKeyDown, { passive: true })
    el.addEventListener('paste', onPaste, { passive: true, capture: true })
    el.addEventListener('focusout', onFocusOut, { passive: true })
    return () => {
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('input', onInput)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('paste', onPaste, { capture: true })
      el.removeEventListener('focusout', onFocusOut)
      if (pending !== null) clearTimeout(pending)
      st().setCell(null, '')
    }
  }, [host])
}

/** Subtle marker on auto-filled Rate cells (setting `markAutoFilled`): an attribute on the cell, styled by tokens in grid.css. */
function useMarkers(host: React.RefObject<HTMLElement | null>): void {
  const marked = usePriceStripStore((s) => s.marked)
  const on = usePriceStripStore((s) => s.settings.markAutoFilled)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const touched: HTMLElement[] = []
    if (on) {
      for (const k of marked) {
        const [side, rowId] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
        const pane = el.querySelector(`.q3-hy-pane[data-side="${side}"]`) ?? el
        const cell = pane.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rowId)}"] ${RATE_CELL}`)
        if (cell) { cell.setAttribute('data-autofilled', '1'); touched.push(cell) }
      }
    }
    return () => { for (const c of touched) c.removeAttribute('data-autofilled') }
  }, [host, marked, on])
}

/**
 * The compact one-line strip under the grid: the matched item and ALL its tiers, the tier of the current format highlighted; in Auto
 * mode also what was filled. Display only: never takes focus, never moves the cursor, never writes.
 */
export function PriceStrip({ gridHost }: { gridHost: React.RefObject<HTMLElement | null> }): React.JSX.Element | null {
  const billId = useBillStore((s) => s.billId)
  const formatId = useBillStore((s) => s.formatId)
  const settings = usePriceStripStore((s) => s.settings)
  const cellActive = usePriceStripStore((s) => s.cellActive)
  const side = usePriceStripStore((s) => s.cell?.side ?? 'primary')
  const secondFormat = useBillStore((s) => s.second?.formatId ?? null)
  const typed = usePriceStripStore((s) => s.typed)
  const match = usePriceStripStore((s) => s.match)
  const filled = usePriceStripStore((s) => s.filled)
  const data = usePriceStripStore((s) => s.data)
  const tiers = usePriceStripStore((s) => s.tiers)

  // Phase 254 (M24) [A]: the strip is hidden while the master AI switch is off. Only the DISPLAY is hidden; the Rate mode (Auto / Suggest / Off), its switch and the
  // Auto fill are the Price List's own settings and are untouched.
  const aiOn = useAiPanelStore((s) => s.enabled)
  useEffect(() => { void useAiPanelStore.getState().load() }, [])
  useEffect(() => { void usePriceStripStore.getState().load(true) }, [])
  useEffect(() => { usePriceStripStore.getState().reset() }, [billId])
  useGridWatch(gridHost)
  useMarkers(gridHost)

  const activeFormat = side === 'second' && secondFormat ? secondFormat : formatId
  const tierKey = tierForFormat(settings, activeFormat)
  const view = useMemo(
    () => stripView({ enabled: settings.enabled, mode: settings.mode, cellActive, hasData: data.index.length > 0, typed, match, tierKey, tiers, data, filled }),
    [settings.enabled, settings.mode, cellActive, data, typed, match, tierKey, tiers, filled]
  )
  if (!aiOn || view.kind === 'hidden') return null
  return (
    <div className="q3-pricestrip" role="region" aria-label="Price List match" aria-live="polite" onMouseDown={(e) => e.preventDefault()}>
      {view.kind === 'notice' ? (
        <span className="q3-pricestrip__note">{view.text}</span>
      ) : (
        <ul className="q3-pricestrip__list">
          {view.candidates.map((c) => (
            <li key={c.rowId} className="q3-pricestrip__row" data-best={c.best ? '1' : undefined}>
              <span className="q3-pricestrip__name">{c.name}</span>
              <span className="q3-pricestrip__tab">{c.tabName}</span>
              {c.tiers.map((t) => (
                <span key={t.key} className="q3-pricestrip__tier" data-current={t.key === view.tierKey ? '1' : undefined}>{t.label} {t.value}</span>
              ))}
              {c.best && view.filled !== null && <span className="q3-pricestrip__chip">Filled {view.filled}{view.tierLabel ? ` (${view.tierLabel})` : ''}</span>}
              {c.best && view.filled === null && !view.confident && <span className="q3-pricestrip__chip">Not sure</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The visible switch in the Create toolbar: cycles Auto -> Suggest -> Off. Never takes focus (the cell keeps its caret); the key does the same. */
export function PriceStripSwitch(): React.JSX.Element | null {
  const enabled = usePriceStripStore((s) => s.settings.enabled)
  const mode = usePriceStripStore((s) => s.settings.mode)
  const keys = primaryKeys('pricelist.billing.toggle')
  useEffect(() => { void usePriceStripStore.getState().load() }, [])
  if (!enabled) return null
  const text = mode === 'auto' ? 'Rate: Auto' : mode === 'suggest' ? 'Rate: Suggest' : 'Rate: Off'
  return (
    <IconButton icon={Tag} label="Price List rate: Auto / Suggest / Off" text={text} active={billingOn({ enabled, mode })} {...(keys ? { shortcut: keys } : {})} tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()} onClick={() => usePriceStripStore.getState().setMode(nextBillingMode(usePriceStripStore.getState().settings.mode))} />
  )
}
