import type { Quot3Bridge } from '@shared/ipc'
import type { RendererReportKind } from '@shared/diagnostics'

type Api = Quot3Bridge['diagnostics']
const api = (): Api | undefined => (window as unknown as { quot3?: { diagnostics?: Api } }).quot3?.diagnostics

/** Sends one report to main (fire and forget; reporting an error must never raise another). */
export function reportRendererError(kind: RendererReportKind, error: unknown, extra?: string): void {
  try {
    const a = api()
    if (!a) return
    const e = error instanceof Error ? error : null
    const message = (e ? `${e.name}: ${e.message}` : typeof error === 'string' ? error : 'Unknown error').slice(0, 2000)
    const stack = [e?.stack ?? '', extra ?? ''].filter(Boolean).join('\n').slice(0, 20_000)
    void a.report({ kind, message, ...(stack ? { stack } : {}) }).catch(() => undefined)
  } catch { /* ignore */ }
}

/** Phase 61 - `window` error / unhandledrejection listeners. Returns a function that removes them. */
export function installErrorReporting(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onError = (ev: Event): void => {
    const e = ev as ErrorEvent
    reportRendererError('error', e.error ?? e.message ?? 'Script error')
  }
  const onRejection = (ev: Event): void => {
    reportRendererError('rejection', (ev as PromiseRejectionEvent).reason)
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
