import { useEffect } from 'react'
import { sidePickKey, sidePickTitle } from '@shared/hybrid/hybridOutput'
import { Button, Dialog } from '../ui'
import { cancelSidePick, chooseSide, useSidePickStore } from '../../stores/sidePick'

/**
 * Phase 152 - "GST side or non-GST side?" (keys: G, N, Esc). Mounted once in the app shell; opened by `withOutputSide` for every
 * output of a Hybrid bill. Only the chosen side is printed / saved / copied.
 */
export function HybridSidePickDialog(): React.JSX.Element {
  const open = useSidePickStore((s) => s.open)
  const purpose = useSidePickStore((s) => s.purpose)

  // Keys are taken at the window (capture) while the question is open, like the print dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return
      const k = sidePickKey(e)
      if (k === null) return
      e.preventDefault(); e.stopPropagation()
      if (k === 'cancel') cancelSidePick()
      else chooseSide(k)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <Dialog
      open={open}
      title={sidePickTitle(purpose)}
      onClose={cancelSidePick}
      footer={
        <>
          <Button onClick={cancelSidePick} shortcut="Esc">Cancel</Button>
          <Button variant="primary" onClick={() => { chooseSide('gst') }} shortcut="G" data-autofocus>GST side</Button>
          <Button variant="primary" onClick={() => { chooseSide('non_gst') }} shortcut="N">Non-GST side</Button>
        </>
      }
    >
      <p>This bill has a GST table and a non-GST table. Only the side you choose is output, laid out like a normal bill of that kind.</p>
      <p><kbd>G</kbd> GST side · <kbd>N</kbd> non-GST side · <kbd>Esc</kbd> cancel</p>
    </Dialog>
  )
}
