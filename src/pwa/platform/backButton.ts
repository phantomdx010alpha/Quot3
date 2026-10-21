/** Android system Back inside an installed app (Phase 180). Pure of React; the browser pieces are injected so tests can fake them.
 *  Scheme: one sentinel history entry sits above the app's first entry. A Back press consumes the sentinel and fires `popstate`;
 *  if the app can step back we do that and put the sentinel back, otherwise (Dashboard) we let the Back go through and the app closes.
 *  Real Android Back behaviour is a Standing gap until the owner tries it. */
export interface BackEnv {
  pushSentinel(): void
  /** Leave the app (a further `history.back()`). */
  exit(): void
  onPop(fn: () => void): () => void
}

export interface BackHandlers {
  /** True when the app handled the press (stepped back or blocked a leave); false at the Dashboard root. */
  handleBack(): boolean
}

export function installBackGuard(env: BackEnv, handlers: BackHandlers): () => void {
  env.pushSentinel()
  const off = env.onPop(() => {
    if (handlers.handleBack()) env.pushSentinel()
    else env.exit()
  })
  return off
}

export function browserBackEnv(): BackEnv {
  return {
    pushSentinel: () => window.history.pushState({ q3: 'sentinel' }, ''),
    exit: () => window.history.back(),
    onPop: (fn) => {
      window.addEventListener('popstate', fn)
      return () => window.removeEventListener('popstate', fn)
    }
  }
}
