import { useEffect, useRef } from 'react'
import { useOptionalToast } from '../ui'
import { useSaveUiStore } from '../../stores/saveUiStore'

/**
 * Phase 27 — shows the outcome of every save as a toast (success names the PO number). Renders nothing; mounted once on
 * the Create page. The actual work lives in `stores/saveActions.ts` so Ctrl+S, the palette and later buttons share it.
 */
export function SaveFlow(): null {
  const toast = useOptionalToast()
  const last = useSaveUiStore((s) => s.last)
  // Phase 116: SaveFlow is mounted by Create, History and Customers. Seeding with the event that already exists stops every
  // page switch from replaying the previous page's last notice (that replay was the stacked toasts on Esc).
  const shown = useRef(useSaveUiStore.getState().last?.seq ?? 0)
  useEffect(() => {
    if (!last || last.seq === shown.current) return
    shown.current = last.seq
    // Routine confirmations go to the quiet status line when one is on screen; warnings and errors always toast.
    if (last.tone === 'ok' && useSaveUiStore.getState().quietHosts > 0) return
    toast?.show(last.message, last.tone)
  }, [last, toast])
  return null
}
