import type { ReactElement } from 'react'
import { builtLayoutIds, LAYOUT_BLURBS, LAYOUT_LABELS, type LayoutId } from './layoutRegistry'

/** Settings > Themes > Layout (Phase 189): lists only the BUILT layouts, applies at once, remembered. Uses the classic chip classes (no new CSS). */
export function LayoutPicker(props: { layout: LayoutId; onLayout: (l: LayoutId) => void }): ReactElement {
  const ids = builtLayoutIds()
  return (
    <section className="q3-set" aria-label="Layout">
      <h2 className="q3-h2">Layout</h2>
      <p className="q3-muted">Classic is today&rsquo;s screen. Changing the layout never changes your bills.</p>
      <div className="q3-chips" role="group" aria-label="Layout">
        {ids.map((id) => (
          <button key={id} type="button" className="q3-chip" aria-pressed={props.layout === id} onClick={() => props.onLayout(id)}>{LAYOUT_LABELS[id]}</button>
        ))}
      </div>
      <p className="q3-muted">{LAYOUT_BLURBS[props.layout]}</p>
    </section>
  )
}
