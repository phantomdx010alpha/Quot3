import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle, Info, Warning, WarningOctagon, X } from '@phosphor-icons/react'
import { Icon } from './Icon'

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger'
interface ToastItem {
  id: number
  tone: ToastTone
  message: string
}

export interface ToastApi {
  /** Phase 116: an identical (tone + message) toast replaces the one on screen (timer restarts); at most `MAX_VISIBLE_TOASTS` show. */
  show(message: string, tone?: ToastTone, durationMs?: number): void
  /** Phase 116: remove every toast now (the app calls this on every page change). */
  clear(): void
}

/** Phase 116 [A]: never more than two toasts at once; the oldest goes first. */
export const MAX_VISIBLE_TOASTS = 2

/** Pure: the list after showing `incoming` (identical tone+message replaces in place, then the cap keeps the newest). */
export function addToast<T extends { tone: string; message: string }>(list: readonly T[], incoming: T, max: number = MAX_VISIBLE_TOASTS): T[] {
  const same = list.findIndex((t) => t.tone === incoming.tone && t.message === incoming.message)
  const next = same >= 0 ? list.map((t, i) => (i === same ? incoming : t)) : [...list, incoming]
  return next.slice(-max)
}

const ToastContext = createContext<ToastApi | null>(null)
const DEFAULT_DURATION_MS = 4000
const ICONS = { info: Info, ok: CheckCircle, warn: Warning, danger: WarningOctagon } as const

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const itemsRef = useRef<ToastItem[]>([])
  const commit = useCallback((next: ToastItem[]) => {
    for (const [id, tm] of timers.current) if (!next.some((t) => t.id === id)) { clearTimeout(tm); timers.current.delete(id) }
    itemsRef.current = next
    setItems(next)
  }, [])
  const dismiss = useCallback((id: number) => commit(itemsRef.current.filter((t) => t.id !== id)), [commit])
  useEffect(() => { const m = timers.current; return () => { for (const tm of m.values()) clearTimeout(tm); m.clear() } }, [])
  const api = useMemo<ToastApi>(
    () => ({
      show(message, tone = 'info', durationMs = DEFAULT_DURATION_MS) {
        const existing = itemsRef.current.find((t) => t.tone === tone && t.message === message)
        const id = existing ? existing.id : nextId.current++
        const prev = timers.current.get(id)
        if (prev) { clearTimeout(prev); timers.current.delete(id) }
        commit(addToast(itemsRef.current, { id, tone, message }))
        if (durationMs > 0) timers.current.set(id, setTimeout(() => dismiss(id), durationMs))
      },
      clear() { commit([]) }
    }),
    [commit, dismiss]
  )
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="q3-toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`q3-toast nm-raised ${t.tone === 'info' ? '' : `q3-toast--${t.tone}`}`}>
            <Icon icon={ICONS[t.tone]} weight="bold" />
            <span className="q3-toast__msg">{t.message}</span>
            <button type="button" className="q3-iconbtn" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              <Icon icon={X} size="sm" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Like `useToast` but returns null outside a `ToastProvider` (components that only announce, e.g. Phase 27's `SaveFlow`, must not crash in isolation). */
export function useOptionalToast(): ToastApi | null {
  return useContext(ToastContext)
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
