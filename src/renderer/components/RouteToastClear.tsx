import { useEffect } from 'react'
import { useOptionalToast } from './ui'
import { useRouter } from '../router/routerStore'

/** Phase 116 - every page change clears all toasts, so nothing from the previous page follows the owner around. Renders nothing. */
export function RouteToastClear(): null {
  const toast = useOptionalToast()
  const navCount = useRouter((s) => s.navCount)
  useEffect(() => { toast?.clear() }, [navCount, toast])
  return null
}
