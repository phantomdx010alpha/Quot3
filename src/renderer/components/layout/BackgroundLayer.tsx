import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isGridPage, sceneRunState } from '@shared/theme/scenes'
import { usePath } from '../../router/routerStore'
import { getEffectsPrefs, subscribeEffectsPrefs } from '../../theme/effects'
import { createSceneHost, type SceneHost } from '../../theme/scenes/sceneHost'
import { getSceneSnapshot, markSceneFailed, subscribeScene } from '../../theme/scenes/sceneState'

/** Phase 169: the 3D / shader background canvas. Behind the chrome (`pointer-events: none`, z-index below the page), never behind the bill grid. Renders nothing when the theme has no scene. */
export function BackgroundLayer(): React.JSX.Element | null {
  const sc = useSyncExternalStore(subscribeScene, getSceneSnapshot, getSceneSnapshot)
  const fx = useSyncExternalStore(subscribeEffectsPrefs, getEffectsPrefs, getEffectsPrefs)
  const path = usePath()
  const ref = useRef<HTMLCanvasElement>(null)
  const host = useRef<SceneHost | null>(null)
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.visibilityState === 'hidden')
  const [blurred, setBlurred] = useState(typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? !document.hasFocus() : false)
  const [reduce, setReduce] = useState(false)

  useEffect(() => {
    const onVis = (): void => setHidden(document.visibilityState === 'hidden')
    const onFocus = (): void => setBlurred(false)
    const onBlur = (): void => setBlurred(true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus); window.addEventListener('blur', onBlur)
    let mq: MediaQueryList | null = null
    const onMq = (e: MediaQueryListEvent): void => setReduce(e.matches)
    try { mq = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null; if (mq) { setReduce(mq.matches); mq.addEventListener?.('change', onMq) } } catch { /* unknown: stays false */ }
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); mq?.removeEventListener?.('change', onMq) }
  }, [])

  const wanted = sc.scene !== null
  const failed = sc.failedKey !== '' && sc.failedKey === sc.sceneKey
  const state = sceneRunState({ wanted, scenesEnabled: sc.scenesEnabled, effectsEnabled: fx.enabled, reduceMotion: reduce, failed, hidden, unfocusedPaused: fx.pauseUnfocused && blurred, gridPage: isGridPage(path) })

  // The canvas only exists while a scene is wanted; the host is created with it and disposed when it goes (theme change to a plain theme, failure, unmount).
  const mounted = wanted && !failed
  useEffect(() => {
    const canvas = ref.current
    if (!mounted || !canvas) return
    const h = createSceneHost(canvas, () => markSceneFailed())
    host.current = h
    return () => { h.dispose(); host.current = null }
  }, [mounted])
  useEffect(() => { host.current?.setRunState(state) }, [state, mounted])
  useEffect(() => { host.current?.setScene(sc.scene); host.current?.setRunState(state) }, [sc.sceneKey, mounted]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null
  return <canvas ref={ref} className="q3-bg" aria-hidden="true" data-grid={isGridPage(path) ? 'on' : undefined} />
}
