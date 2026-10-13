import { useEffect, useRef } from 'react'
import { ignoreEscRepeat } from '@shared/dirtyGuard'
import { matchShortcut, type ActionId, type ShortcutScope } from '@shared/shortcuts'

export type ActionHandlers = Partial<Record<ActionId, () => void>>

/**
 * One window-level keydown listener that resolves the event through the shared registry (`matchShortcut`)
 * and runs the handler registered for the matched action. Events already handled (`defaultPrevented`,
 * e.g. by a dialog or a grid cell) are ignored, so Esc inside an overlay never also navigates back.
 * Handlers are read through a ref, so changing them never re-subscribes.
 */
export function useHotkeys(scopes: readonly ShortcutScope[], handlers: ActionHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const scopeKey = scopes.join('|')

  useEffect(() => {
    const active = scopeKey === '' ? [] : (scopeKey.split('|') as ShortcutScope[])
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return
      if (ignoreEscRepeat(e)) { e.preventDefault(); return } // Phase 95: a held Esc must not re-open dialogs
      const def = matchShortcut(e, active)
      if (!def) return
      const run = handlersRef.current[def.action]
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scopeKey])
}
