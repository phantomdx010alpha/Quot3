import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Button } from './Button'
import { dismissSnack, EMPTY_SNACK, showSnack, tickSnack, type Snack, type SnackState } from './snackbarModel'

export interface SnackbarApi {
  snack: Snack | null
  /** Shows a message (6 s). With `undo`, the snack has an Undo button; the newest callback wins when the same message repeats. */
  show: (message: string, undo?: () => void) => void
  dismiss: () => void
  /** Runs the Undo callback once and clears the snack. */
  undo: () => void
}

export function useSnackbar(nowMs: () => number = Date.now): SnackbarApi {
  const [state, setState] = useState<SnackState>(EMPTY_SNACK)
  const undoRef = useRef<(() => void) | null>(null)
  const nowRef = useRef(nowMs)
  nowRef.current = nowMs

  const show = useCallback((message: string, undo?: () => void): void => {
    undoRef.current = undo ?? null
    setState((s) => showSnack(s, { message, hasUndo: undo !== undefined }, nowRef.current()))
  }, [])
  const dismiss = useCallback((): void => { undoRef.current = null; setState((s) => dismissSnack(s)) }, [])
  const undo = useCallback((): void => {
    const fn = undoRef.current
    undoRef.current = null
    setState((s) => dismissSnack(s))
    fn?.()
  }, [])

  const cur = state.current
  useEffect(() => {
    if (!cur) return undefined
    const wait = Math.max(0, cur.expiresAt - nowRef.current())
    const t = setTimeout(() => {
      setState((s) => { const n = tickSnack(s, nowRef.current()); if (n !== s && n.current === null) undoRef.current = null; return n })
    }, wait)
    return () => clearTimeout(t)
  }, [cur])

  return { snack: cur, show, dismiss, undo }
}

/** Draws the one snack, if any. Place it once per layout, above the bottom navigation. */
export function SnackbarHost(props: { snack: SnackbarApi }): ReactElement | null {
  const s = props.snack.snack
  if (!s) return null
  return (
    <div className="q3x-snack" role="status" aria-live="polite">
      <span className="q3x-snack-text">{s.message}</span>
      {s.hasUndo ? <Button label="Undo" variant="text" onClick={props.snack.undo} /> : null}
    </div>
  )
}
