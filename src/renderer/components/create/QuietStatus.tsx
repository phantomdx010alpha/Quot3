import { useEffect, useRef, useState } from 'react'
import { useSaveUiStore } from '../../stores/saveUiStore'

const QUIET_MS = 5000

/**
 * Phase 116 - routine confirmations (saved, copied, undo/redo notices) as quiet text in the bottom bar instead of a toast.
 * Shows only events that happen while it is mounted (a page switch never replays an old one) and fades after 5 s.
 */
export function QuietStatus(): React.JSX.Element {
  const quiet = useSaveUiStore((s) => s.quiet)
  const shownSeq = useRef(useSaveUiStore.getState().quiet?.seq ?? 0)
  const [text, setText] = useState('')
  useEffect(() => { useSaveUiStore.getState().addQuietHost(1); return () => useSaveUiStore.getState().addQuietHost(-1) }, [])
  useEffect(() => {
    if (!quiet || quiet.seq === shownSeq.current) return
    shownSeq.current = quiet.seq
    setText(quiet.message)
    const t = setTimeout(() => setText(''), QUIET_MS)
    return () => clearTimeout(t)
  }, [quiet])
  return <span className="q3-bbar__quiet" role="status" aria-live="polite">{text}</span>
}
