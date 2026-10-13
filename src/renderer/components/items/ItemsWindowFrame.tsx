import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { Kbd } from '../ui'

/** Phase 112 - one of the three Items windows: a titled, focusable region (tabIndex 0, roving focus is the page's job). */
export interface ItemsWindowFrameProps {
  title: string
  /** Key that jumps here (shown as a Kbd chip; empty = none). */
  hint: string
  active: boolean
  className?: string
  frameRef: Ref<HTMLDivElement>
  onFocus: () => void
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

export function ItemsWindowFrame(p: ItemsWindowFrameProps): React.JSX.Element {
  return (
    <section className={`${p.className ?? ''} q3-items__frame nm-inset nm-sm${p.active ? ' q3-items__frame--active' : ''}`} aria-label={p.title}>
      <h2 className="q3-items__title">
        <span>{p.title}</span>
        {p.hint !== '' && <Kbd keys={p.hint} />}
      </h2>
      <div ref={p.frameRef} className="q3-items__content" role="group" aria-label={`${p.title} window`} tabIndex={0} onFocus={p.onFocus} onKeyDown={p.onKeyDown}>
        {p.children}
      </div>
    </section>
  )
}
