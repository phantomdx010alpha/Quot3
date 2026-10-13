import { useEffect } from 'react'
import type { Quot3Bridge } from '@shared/ipc'
import { setLeaveGuard } from '../router/routerStore'
import { requestLeave } from '../stores/guardStore'

/**
 * Phase 28 — installs the unsaved-changes guard: leaving the Create page by navigation goes through `requestLeave`, and so
 * does closing the window (main holds the close and sends `app:before-quit`; we answer with `app:confirmQuit`).
 */
export function useDirtyGuard(): void {
  useEffect(() => {
    setLeaveGuard(requestLeave)
    return () => setLeaveGuard(null)
  }, [])
  useEffect(() => {
    const api = (window as unknown as { quot3?: Pick<Quot3Bridge, 'app' | 'on'> }).quot3
    if (!api?.on) return
    return api.on('app:before-quit', () => { requestLeave(() => { void api.app.confirmQuit() }) })
  }, [])
}
