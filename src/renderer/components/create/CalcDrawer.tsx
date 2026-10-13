import { useEffect, useRef, useState } from 'react'
import { Calculator, Percent, X } from '@phosphor-icons/react'
import { calcLine, commitExpression, groupCalcText, grandTotalOf, typedPercentInvalid } from '@shared/calc/calcPanel'
import { parsePercent, percentResults } from '@shared/calc/percentPresets'
import { primaryKeys } from '@shared/shortcuts'
import { useBillStore } from '../../stores/billStore'
import { useBehaviourStore } from '../../stores/behaviourStore'
import { useCalcPanelStore } from '../../stores/calcPanelStore'
import { useGridUiStore } from '../../stores/gridUiStore'

let loaded = false

/** Puts focus back where it was before the drawer opened (the grid cell, normally); falls back to the grid's own refocus. */
function restoreFocus(prev: HTMLElement | null): void {
  if (prev && prev.isConnected) { prev.focus(); return }
  useGridUiStore.getState().refocus?.()
}

function copyText(t: string): void {
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(t).catch(() => undefined)
}

/**
 * Phase 83 - the calculator drawer above the Create page's bottom bar (CALCULATOR_PANEL_RULES.md). Two modes: a one-line
 * Tally-style calculator and a % calculator for the bill's grand total. It is not part of the bill: it never writes into the grid,
 * is not undoable, never marks the bill dirty. The % mode subscribes to the grand total string only, so the grid is not re-rendered by it.
 */
export function CalcDrawer(): React.JSX.Element | null {
  const open = useCalcPanelStore((s) => s.open)
  const mode = useCalcPanelStore((s) => s.mode)
  const focusTick = useCalcPanelStore((s) => s.focusTick)
  const prev = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded) return
    loaded = true
    void useCalcPanelStore.getState().load()
  }, [])

  // Remember the focused element as the drawer opens, and give it back when it closes.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const a = document.activeElement
      prev.current = a instanceof HTMLElement && a !== document.body ? a : null
    }
    if (!open && wasOpen.current) restoreFocus(prev.current)
    wasOpen.current = open
  }, [open])

  // Opening or switching mode focuses the field.
  useEffect(() => {
    if (open) input.current?.focus()
  }, [open, mode, focusTick])

  if (!open) return null
  const close = (): void => useCalcPanelStore.getState().setOpen(false)
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    const s = useCalcPanelStore.getState()
    // Esc with text clears; Esc when empty closes.
    if (s.mode === 'calc' && s.expr !== '') { s.setExpr(''); return }
    if (s.mode === 'percent' && s.typedPercent !== '') { s.setTypedPercent(''); return }
    close()
  }
  const toggleKey = primaryKeys('calc.toggle')
  return (
    <div className="q3-calc" role="region" aria-label="Calculator" onKeyDown={onKeyDown}>
      <div className="q3-calc__modes" role="group" aria-label="Calculator mode">
        <button type="button" className="q3-calc__mode" aria-pressed={mode === 'calc'} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
          onClick={() => useCalcPanelStore.getState().setMode('calc')}><Calculator size={14} weight={mode === 'calc' ? 'bold' : 'light'} /> Calculator</button>
        <button type="button" className="q3-calc__mode" aria-pressed={mode === 'percent'} tabIndex={-1} onMouseDown={(e) => e.preventDefault()}
          onClick={() => useCalcPanelStore.getState().setMode('percent')}><Percent size={14} weight={mode === 'percent' ? 'bold' : 'light'} /> % of total</button>
      </div>
      {mode === 'calc' ? <ExprMode inputRef={input} /> : <PercentMode inputRef={input} />}
      <button type="button" className="q3-calc__close" tabIndex={-1} aria-label={`Close calculator${toggleKey ? ` (${toggleKey})` : ''}`} title={`Close${toggleKey ? ` (${toggleKey})` : ''}`}
        onMouseDown={(e) => e.preventDefault()} onClick={close}><X size={14} weight="bold" /></button>
    </div>
  )
}

function ExprMode({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  const expr = useCalcPanelStore((s) => s.expr)
  const line = calcLine(expr)
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const next = commitExpression(useCalcPanelStore.getState().expr)
    if (next !== null) useCalcPanelStore.getState().setExpr(next)
  }
  return (
    <>
      <input ref={inputRef} className="q3-input q3-calc__field" value={expr} spellCheck={false} autoComplete="off" inputMode="text"
        aria-label="Expression" aria-invalid={line.error} placeholder="e.g. 1250 + 18%" onKeyDown={onKey}
        onChange={(e) => useCalcPanelStore.getState().setExpr(e.target.value.slice(0, 200))} />
      <span className={`q3-calc__result${line.error ? ' q3-calc__result--error' : ''}`} role="status" aria-live="polite">
        {line.shown === '' ? '' : line.error ? line.shown : `= ${line.shown}`}
      </span>
    </>
  )
}

function PercentMode({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }): React.JSX.Element {
  const total = useBillStore((s) => grandTotalOf(s.view.footer))
  const presets = useBehaviourStore((s) => s.percentPresets)
  const typed = useCalcPanelStore((s) => s.typedPercent)
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const typedOk = typed.trim() !== '' ? parsePercent(typed) : null
  const active = typedOk ?? picked ?? presets[0] ?? null
  const res = total !== null && active !== null ? percentResults(total, active) : null
  const copy = (t: string): void => { copyText(t); setCopied(t); window.setTimeout(() => setCopied((c) => (c === t ? '' : c)), 1500) }
  const cell = (label: string, v: string): React.JSX.Element => (
    <button type="button" className="q3-calc__res" tabIndex={-1} title="Copy" onMouseDown={(e) => e.preventDefault()} onClick={() => copy(v)}>
      <span className="q3-calc__reslabel">{label}</span> {groupCalcText(v)}
    </button>
  )
  return (
    <>
      <span className="q3-calc__total">Total {total === null ? '-' : groupCalcText(total)}</span>
      <div className="q3-calc__chips" role="group" aria-label="Percent presets">
        {presets.map((p) => (
          <button key={p} type="button" className="q3-calc__chip" aria-pressed={typedOk === null && active === p} tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { setPicked(p); useCalcPanelStore.getState().setTypedPercent(''); inputRef.current?.focus() }}>{p}%</button>
        ))}
      </div>
      <input ref={inputRef} className="q3-input q3-calc__pct" value={typed} spellCheck={false} autoComplete="off"
        aria-label="Percent" aria-invalid={typedPercentInvalid(typed)} placeholder="%" onChange={(e) => useCalcPanelStore.getState().setTypedPercent(e.target.value.slice(0, 12))} />
      {res ? (
        <span className="q3-calc__results" role="status" aria-live="polite">
          {cell(`${active}% of`, res.of)}{cell('+', res.plus)}{cell('-', res.minus)}
          {copied !== '' && <span className="q3-calc__copied">Copied</span>}
        </span>
      ) : (
        <span className={`q3-calc__result${typedPercentInvalid(typed) ? ' q3-calc__result--error' : ''}`} role="status">
          {typedPercentInvalid(typed) ? 'Enter a percent above 0, up to 1000.' : total === null ? 'No total yet.' : ''}
        </span>
      )}
    </>
  )
}
