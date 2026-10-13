import { useEffect, useRef, useState } from 'react'

/**
 * Phase 117 - the scroll position and height of the ONE element that really scrolls (the Items window's content div), kept in
 * state so a window can draw only the rows in view. Re-read on scroll, on resize and whenever `readAgain` changes (list length).
 * Returns `read` so a caller that moved `scrollTop` itself (scroll-to-selection) can refresh at once: jsdom fires no scroll event.
 */
export function useScrollView(getScroll: () => HTMLElement | null, readAgain: number): { top: number; h: number; read: () => void } {
  const [view, setView] = useState({ top: 0, h: 0 })
  const get = useRef(getScroll)
  get.current = getScroll
  const readRef = useRef<() => void>(() => undefined)
  readRef.current = (): void => {
    const el = get.current()
    if (!el) return
    setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight ? v : { top: el.scrollTop, h: el.clientHeight }))
  }
  const read = useRef(() => readRef.current()).current
  useEffect(() => {
    const el = get.current()
    if (!el) return
    read()
    el.addEventListener('scroll', read, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', read); ro?.disconnect() }
  }, [read])
  useEffect(() => { read() }, [readAgain, read])
  return { top: view.top, h: view.h, read }
}
