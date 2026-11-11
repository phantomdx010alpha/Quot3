import { useEffect, useRef } from 'react'
import { registerPageAdapter, recallPage, schedulePageSave, cancelPageSave, type PageAdapter } from '../stores/pageMemoryStore'

/**
 * Phase 219 (M21): a page registers its adapter, gets its remembered state applied once on mount, and saves (debounced) while the
 * owner scrolls or clicks inside `rootRef`. The final save on leave is done by the router BEFORE the page unmounts (DOM still there).
 */
export function usePageMemory(path: string, rootRef: React.RefObject<HTMLElement | null>, adapter: PageAdapter): void {
  const ref = useRef(adapter)
  ref.current = adapter
  useEffect(() => {
    const unregister = registerPageAdapter(path, { capture: () => ref.current.capture(), apply: (m) => ref.current.apply(m) })
    const mem = recallPage(path)
    // After the page's own mount effects (they start the data load, which sets status 'loading'), so apply waits for the fresh data.
    let live = true
    if (mem) queueMicrotask(() => { if (live) void Promise.resolve(ref.current.apply(mem)).catch(() => undefined) })
    const el = rootRef.current
    const on = (): void => schedulePageSave(path)
    el?.addEventListener('scroll', on, { capture: true, passive: true })
    el?.addEventListener('click', on, true)
    el?.addEventListener('keyup', on, true)
    return () => {
      el?.removeEventListener('scroll', on, true)
      el?.removeEventListener('click', on, true)
      el?.removeEventListener('keyup', on, true)
      live = false
      cancelPageSave(path)
      unregister()
    }
  }, [path, rootRef])
}
